import { hasStoredApiKey } from "./lib/secure-storage.js";
import { getScheduler, isRegistered } from "./lib/nexon-api.js";

const message = document.querySelector("#popup-message");
const settingsButton = document.querySelector("#open-settings");
const schedulerList = document.querySelector("#scheduler-list");
const accountTabs = document.querySelector("#account-tabs");
const worldTabs = document.querySelector("#world-tabs");
let activeAccountId = null;
let activeWorldName = null;
let accountData = [];

settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

if (!(await hasStoredApiKey())) {
  message.textContent = "스케줄러를 보려면 본인의 넥슨 Open API 키를 먼저 등록하세요.";
} else {
  const [{ managedCharactersByAccount = {} }, { apiAccounts = [] }] = await Promise.all([
    chrome.storage.local.get("managedCharactersByAccount"),
    chrome.storage.local.get("apiAccounts"),
  ]);
  const accountsById = new Map(apiAccounts.map((account) => [account.id, account]));
  const entries = Object.entries(managedCharactersByAccount)
    .map(([accountId, characters]) => ({ accountId, characters, account: accountsById.get(accountId) }))
    .filter(({ characters, account }) => characters.length && account);

  if (!entries.length) {
    message.textContent = "설정에서 관리할 캐릭터를 선택하세요.";
  } else {
    message.textContent = "스케줄러를 불러오는 중…";
    accountData = await Promise.all(entries.map(loadAccountData));
    activeAccountId = accountData[0]?.accountId || null;
    activeWorldName = worldsForActiveAccount()[0] || null;
    renderTabs();
    renderSchedule();
  }
}

async function loadAccountData({ accountId, account, characters }) {
  const results = await Promise.allSettled(characters.map(async (character) => ({
    character,
    scheduler: await getScheduler(character),
  })));
  return {
    accountId,
    label: account.label,
    characters: results.map((result, index) => result.status === "fulfilled"
      ? result.value
      : { character: characters[index], error: result.reason?.message || "조회 실패" }),
  };
}

function currentAccount() {
  return accountData.find((account) => account.accountId === activeAccountId);
}

function worldsForActiveAccount() {
  return [...new Set((currentAccount()?.characters || []).map(({ character }) => character.world_name))]
    .sort((a, b) => a.localeCompare(b, "ko"));
}

function makeTab(label, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schedule-tab";
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderTabs() {
  const current = currentAccount();
  accountTabs.hidden = accountData.length <= 1;
  accountTabs.replaceChildren(...(accountData.length > 1 ? accountData.map((account) => makeTab(
    account.label,
    account.accountId === activeAccountId,
    () => {
      activeAccountId = account.accountId;
      activeWorldName = worldsForActiveAccount()[0] || null;
      renderTabs();
      renderSchedule();
    },
  )) : []));

  const worlds = worldsForActiveAccount();
  worldTabs.hidden = worlds.length <= 1;
  worldTabs.replaceChildren(...(worlds.length > 1 ? worlds.map((worldName) => {
    const count = current.characters.filter(({ character }) => character.world_name === worldName).length;
    return makeTab(`${worldName} · ${count}`, worldName === activeWorldName, () => {
      activeWorldName = worldName;
      renderTabs();
      renderSchedule();
    });
  }) : []));
}

function isComplete(item, category) {
  if (category === "일일 퀘스트" && String(item.quest_state) === "2") return true;
  if (item.complete_flag === true || item.complete_flag === "true") return true;
  if (Number(item.max_count) > 0) return Number(item.now_count) >= Number(item.max_count);
  // Score based content such as Guild Underwater Tunnel has no max_count;
  // a positive score means it was completed.
  return item.type !== "quest" && Number(item.now_count) > 0;
}

function schedulerSections(scheduler) {
  const daily = (scheduler.daily_contents || []).filter(isRegistered);
  const weekly = (scheduler.weekly_contents || []).filter(isRegistered);
  const bosses = (scheduler.boss_contents || []).filter(isRegistered);
  const allContents = [...daily, ...weekly];
  const monsterPark = allContents
    .filter((item) => item.content_name?.includes("몬스터파크"))
    .sort((a, b) => Number(b.now_count || 0) - Number(a.now_count || 0))[0];
  const dailyQuests = daily.filter((item) => item.type === "quest");
  const guild = weekly.filter((item) => item.content_name?.includes("[길드]"));
  const isMonthlyBoss = (boss) => {
    const cycle = String(boss.cycle || "").toLowerCase();
    return cycle.includes("monthly") || cycle.includes("month") || cycle.includes("월간") || boss.content_name?.includes("검은 마법사");
  };
  const isDailyBoss = (boss) => {
    const cycle = String(boss.cycle || "").toLowerCase();
    return cycle.includes("bossdaily") || cycle.includes("daily") || cycle.includes("일일");
  };

  return {
    monsterPark,
    dailyQuests,
    bosses: bosses.filter((boss) => !isMonthlyBoss(boss) && !isDailyBoss(boss)),
    monthlyBosses: bosses.filter(isMonthlyBoss),
    guild,
  };
}

function isHighlightWindow(category, now = new Date()) {
  if (category === "일일 퀘스트" || category === "몬스터파크") return now.getHours() >= 22;
  if (category === "보스" || category === "길드") return now.getDay() === 3;
  if (category === "월간 보스") {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() >= lastDay - 3;
  }
  return false;
}

function sectionCard(title, items, { category = title, collapsible = false, progressOverride = null, now = new Date() } = {}) {
  if (!items.length) return null;
  const complete = items.filter((item) => isComplete(item, category));
  const incomplete = items.filter((item) => !isComplete(item, category));
  const highlightIncomplete = incomplete.length > 0 && isHighlightWindow(category, now);
  const card = document.createElement("section");
  card.className = "schedule-section";
  if (highlightIncomplete) card.classList.add("deadline-active");
  const heading = document.createElement(collapsible ? "button" : "div");
  heading.className = "schedule-section-heading";
  const titleNode = document.createElement("strong");
  const progress = document.createElement("span");
  titleNode.textContent = title;
  progress.textContent = progressOverride || `${complete.length}/${items.length} 완료`;
  heading.append(titleNode, progress);
  if (collapsible) {
    heading.type = "button";
    heading.setAttribute("aria-expanded", "false");
    card.classList.add("collapsible-section");
  }
  card.append(heading);

  const incompleteList = document.createElement("ul");
  incompleteList.className = "schedule-items";
  for (const item of incomplete) incompleteList.append(makeItem(item, category, false, highlightIncomplete));
  card.append(incompleteList);

  if (complete.length) {
    const completedList = document.createElement("ul");
    completedList.className = "schedule-items completed-items";
    completedList.hidden = true;
    for (const item of complete) completedList.append(makeItem(item, category, true));
    card.append(completedList);
    if (collapsible) {
      heading.addEventListener("click", () => {
        const expanded = heading.getAttribute("aria-expanded") === "true";
        heading.setAttribute("aria-expanded", String(!expanded));
        completedList.hidden = expanded;
        card.classList.toggle("expanded", !expanded);
      });
    } else {
      completedList.hidden = false;
    }
  }
  return card;
}

function makeItem(item, category, complete, highlightIncomplete = false) {
  const row = document.createElement("li");
  row.className = "schedule-item";
  if (complete) row.classList.add("complete");
  else if (highlightIncomplete) row.classList.add("deadline-incomplete");
  const name = document.createElement("span");
  const count = document.createElement("small");
  name.textContent = item.content_name || "이름 없는 콘텐츠";
  if (category === "일일 퀘스트") {
    count.textContent = complete ? "완료" : (item.quest_state === "1" ? "진행 중" : "미완료");
  } else if (item.max_count && Number(item.max_count) > 0) {
    count.textContent = `${item.now_count || 0}/${item.max_count}`;
  } else if (item.type !== "quest" && Number(item.now_count) > 0) {
    count.textContent = `${Number(item.now_count).toLocaleString("ko-KR")}점`;
  } else {
    count.textContent = complete ? "완료" : "미완료";
  }
  row.append(name, count);
  return row;
}

function renderSchedule() {
  const account = currentAccount();
  const worldCharacters = (account?.characters || []).filter(({ character }) => character.world_name === activeWorldName);
  schedulerList.replaceChildren();
  if (!worldCharacters.length) {
    message.textContent = "선택한 계정과 월드에 등록된 캐릭터가 없습니다.";
    return;
  }

  const parkCandidates = worldCharacters
    .filter((entry) => entry.scheduler)
    .map((entry) => schedulerSections(entry.scheduler).monsterPark)
    .filter(Boolean);
  const monsterPark = parkCandidates.sort((a, b) => Number(b.now_count || 0) - Number(a.now_count || 0))[0];
  if (monsterPark) {
    const count = Math.min(14, Math.max(0, Number(monsterPark.now_count) || 0));
    const parkCard = document.createElement("section");
    parkCard.className = "schedule-section monster-park-section";
    if (count < 14 && isHighlightWindow("몬스터파크")) parkCard.classList.add("deadline-active");
    const heading = document.createElement("strong");
    const progress = document.createElement("span");
    heading.textContent = "몬스터파크";
    progress.textContent = `${count}/14`;
    parkCard.append(heading, progress);
    schedulerList.append(parkCard);
  }

  for (const [index, entry] of worldCharacters.entries()) {
    const characterCard = document.createElement("section");
    characterCard.className = "character-schedule-card";
    const characterHeading = document.createElement("h2");
    const characterName = document.createElement("span");
    const characterLevel = document.createElement("small");
    characterName.textContent = `${index + 1}. ${entry.character.character_name}`;
    characterLevel.textContent = entry.character.character_level ? `Lv.${entry.character.character_level}` : "";
    characterHeading.append(characterName, characterLevel);
    characterCard.append(characterHeading);

    if (entry.error) {
      const error = document.createElement("p");
      error.className = "schedule-error";
      error.textContent = entry.error;
      characterCard.append(error);
      schedulerList.append(characterCard);
      continue;
    }

    const sections = schedulerSections(entry.scheduler);
    const groups = [
      { title: "일일 퀘스트", items: sections.dailyQuests, collapsible: true },
      { title: "보스", items: sections.bosses, collapsible: true },
      { title: "월간 보스", items: sections.monthlyBosses, collapsible: false },
      { title: "길드", items: sections.guild, collapsible: false },
    ];
    for (const group of groups) {
      const section = sectionCard(group.title, group.items, { category: group.title, collapsible: group.collapsible });
      if (section) characterCard.append(section);
    }
    if (!characterCard.querySelector(".schedule-section")) {
      const empty = document.createElement("p");
      empty.className = "character-empty";
      empty.textContent = "표시할 등록 콘텐츠가 없습니다.";
      characterCard.append(empty);
    }
    schedulerList.append(characterCard);
  }
  message.textContent = "";
}
