import {
  deleteApiAccount,
  getActiveAccountId,
  hasStoredApiKey,
  listApiAccounts,
  setActiveAccountId,
  storeApiKey,
  updateAccountLabel,
} from "./lib/secure-storage.js";
import { listAccountCharacters, validateApiKey } from "./lib/nexon-api.js";

const form = document.querySelector("#api-key-form");
const apiKeyInput = document.querySelector("#api-key");
const accountLabelInput = document.querySelector("#account-label");
const toggleKeyButton = document.querySelector("#toggle-key");
const status = document.querySelector("#status");
const settingsDescription = document.querySelector("#settings-description");
const characterSettings = document.querySelector("#character-settings");
const worldList = document.querySelector("#world-list");
const characterPicker = document.querySelector("#character-picker");
const selectedWorldTitle = document.querySelector("#selected-world-title");
const characterList = document.querySelector("#character-list");
const reloadButton = document.querySelector("#reload-characters");
const saveCharactersButton = document.querySelector("#save-characters");
const accountManager = document.querySelector("#account-manager");
const accountList = document.querySelector("#account-list");
const settingsTabs = [...document.querySelectorAll(".settings-tab")];


let characters = [];
let selectedOcids = new Set();
let activeWorld = null;
let activeAccountId = null;

const hasAccounts = await hasStoredApiKey();
if (hasAccounts) {
  activeAccountId = await getActiveAccountId();
  await loadCharacters();
  switchSettingsTab(characterSettings.hidden ? "account-manager" : "character-settings");
} else {
  settingsDescription.textContent = "먼저 넥슨 Open API 키를 등록하면 계정의 월드와 캐릭터를 선택할 수 있습니다.";
  switchSettingsTab("account-manager");
}
await renderAccountManager();

settingsTabs.forEach((tab) => tab.addEventListener("click", () => switchSettingsTab(tab.dataset.panel)));

function switchSettingsTab(panelId) {
  const panels = [characterSettings, accountManager];
  panels.forEach((panel) => { panel.hidden = panel.id !== panelId; });
  settingsTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === panelId));
}

toggleKeyButton.addEventListener("click", () => {
  const hidden = apiKeyInput.type === "password";
  apiKeyInput.type = hidden ? "text" : "password";
  toggleKeyButton.textContent = hidden ? "숨기기" : "보기";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return;
  status.textContent = "API 키를 확인하고 캐릭터를 불러오는 중입니다…";
  try {
    const listedCharacters = await validateApiKey(apiKey);
    if (!listedCharacters.length) throw new Error("캐릭터가 조회되지 않았습니다. API 키와 넥슨 계정을 확인하세요.");
    activeAccountId = await storeApiKey(apiKey, accountLabelInput.value);
    characters = listedCharacters;
    const { managedCharactersByAccount = {} } = await chrome.storage.local.get("managedCharactersByAccount");
    selectedOcids = new Set((managedCharactersByAccount[activeAccountId] || []).map((character) => character.ocid));
    apiKeyInput.value = "";
    accountLabelInput.value = "";
    activeWorld = sortedWorlds()[0]?.worldName || null;
    renderWorlds();
    renderCharacters();
    characterSettings.hidden = false;
    settingsDescription.textContent = "월드와 캐릭터를 선택해 스케줄러 관리 대상을 설정하세요.";
    status.textContent = `${characters.length}명의 캐릭터를 불러왔습니다. 관리할 캐릭터를 선택하세요.`;
    await renderAccountManager();
    switchSettingsTab("character-settings");
  } catch (error) {
    status.textContent = error.message;
  }
});

reloadButton.addEventListener("click", loadCharacters);

saveCharactersButton.addEventListener("click", async () => {
  const { managedCharactersByAccount = {} } = await chrome.storage.local.get("managedCharactersByAccount");
  managedCharactersByAccount[activeAccountId] = [...selectedOcids]
    .map((ocid) => characters.find((character) => character.ocid === ocid))
    .filter(Boolean)
    .map((character) => ({ ...character, accountId: activeAccountId }));
  await chrome.storage.local.set({ managedCharactersByAccount });
  try {
    await chrome.action.openPopup();
    window.close();
  } catch {
    status.textContent = "저장했습니다. Chrome 도구 모음에서 Maple Scheduler 아이콘을 눌러 스케줄러를 여세요.";
  }
});

async function loadCharacters() {
  status.textContent = "캐릭터 목록을 불러오는 중입니다…";
  try {
    activeAccountId ||= await getActiveAccountId();
    const { managedCharactersByAccount = {} } = await chrome.storage.local.get("managedCharactersByAccount");
    selectedOcids = new Set((managedCharactersByAccount[activeAccountId] || []).map((character) => character.ocid));
    characters = await listAccountCharacters(activeAccountId);
    if (!characters.length) throw new Error("조회된 캐릭터가 없습니다. API 키와 넥슨 계정을 확인하세요.");
    activeWorld = sortedWorlds()[0]?.worldName || null;
    renderWorlds();
    renderCharacters();
    characterSettings.hidden = false;
    status.textContent = `${characters.length}명의 캐릭터를 불러왔습니다. 관리할 캐릭터를 선택하세요.`;
  } catch (error) {
    characterSettings.hidden = true;
    status.textContent = error.message;
  }
}

function sortedWorlds() {
  const map = characters.reduce((worlds, character) => {
    const members = worlds.get(character.world_name) || [];
    members.push(character);
    worlds.set(character.world_name, members);
    return worlds;
  }, new Map());
  return [...map.entries()]
    .map(([worldName, members]) => ({ worldName, members }))
    .sort((a, b) => b.members.length - a.members.length || a.worldName.localeCompare(b.worldName, "ko"));
}

function renderWorlds() {
  worldList.replaceChildren(...sortedWorlds().map(({ worldName, members }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "world-card";
    button.classList.toggle("active", activeWorld === worldName);
    button.setAttribute("aria-pressed", String(activeWorld === worldName));
    const name = document.createElement("strong");
    const count = document.createElement("span");
    name.textContent = worldName;
    count.textContent = `${members.length}명`;
    button.append(name, count);
    button.addEventListener("click", () => {
      activeWorld = worldName;
      renderWorlds();
      renderCharacters();
    });
    return button;
  }));
}

function renderCharacters() {
  const world = sortedWorlds().find(({ worldName }) => worldName === activeWorld);
  if (!world) return;
  selectedWorldTitle.textContent = `${world.worldName} 캐릭터`;
  const sorted = [...world.members].sort((a, b) =>
    (Number(b.character_level) || 0) - (Number(a.character_level) || 0)
    || a.character_name.localeCompare(b.character_name, "ko"),
  );
  characterList.replaceChildren(...sorted.map((character) => {
    const selected = selectedOcids.has(character.ocid);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-card";
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    const name = document.createElement("strong");
    const detail = document.createElement("span");
    const selectedOrder = selected ? [...selectedOcids].indexOf(character.ocid) + 1 : null;
    name.textContent = selected ? `${selectedOrder}. ${character.character_name}` : character.character_name;
    detail.textContent = [character.character_class, character.character_level ? `Lv.${character.character_level}` : ""].filter(Boolean).join(" · ");
    button.append(name, detail);
    button.addEventListener("click", () => {
      selected ? selectedOcids.delete(character.ocid) : selectedOcids.add(character.ocid);
      renderCharacters();
    });
    return button;
  }));
  characterPicker.hidden = false;
}

async function renderAccountManager() {
  const accounts = await listApiAccounts();
  accountList.replaceChildren(...accounts.map((account) => {
    const row = document.createElement("div");
    row.className = "account-row";
    const labelInput = document.createElement("input");
    labelInput.className = "account-label-input";
    labelInput.value = account.label;
    labelInput.setAttribute("aria-label", `${account.label} 계정 이름`);
    const select = document.createElement("button");
    select.type = "button";
    select.className = "account-select";
    const isActive = account.id === activeAccountId;
    select.textContent = isActive ? "사용 중" : "사용";
    select.classList.toggle("active", isActive);
    select.addEventListener("click", async () => {
      activeAccountId = account.id;
      await setActiveAccountId(account.id);
      await loadCharacters();
      await renderAccountManager();
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary account-edit";
    edit.textContent = "수정";
    edit.addEventListener("click", async () => {
      await updateAccountLabel(account.id, labelInput.value);
      await renderAccountManager();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "삭제";
    remove.addEventListener("click", async () => {
      await deleteApiAccount(account.id);
      activeAccountId = await getActiveAccountId();
      if (activeAccountId) await loadCharacters();
      else {
        characters = [];
        characterSettings.hidden = true;
        status.textContent = "등록된 API 계정이 없습니다.";
      }
      await renderAccountManager();
    });
    row.append(labelInput, select, edit, remove);
    return row;
  }));
}

