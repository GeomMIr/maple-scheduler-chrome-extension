import { getApiKey } from "./secure-storage.js";

const BASE_URL = "https://open.api.nexon.com/maplestory/v1";

async function request(path, params = {}, accountId, directApiKey) {
  const apiKey = directApiKey || await getApiKey(accountId);
  if (!apiKey) throw new Error("API 키가 등록되지 않았습니다.");

  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    headers: { "x-nxopen-api-key": apiKey },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `넥슨 API 요청에 실패했습니다. (${response.status})`);
  }
  return body;
}

function extractCharacters(payload) {
  const found = [];
  const visit = (value, inheritedWorld = "") => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inheritedWorld));
      return;
    }
    if (!value || typeof value !== "object") return;

    const worldName = value.world_name || inheritedWorld;
    if (value.ocid && value.character_name) {
      found.push({
        ocid: value.ocid,
        character_name: value.character_name,
        world_name: worldName || "알 수 없는 월드",
        character_level: value.character_level,
        character_class: value.character_class,
      });
    }
    Object.values(value).forEach((item) => visit(item, worldName));
  };
  visit(payload);

  return [...new Map(found.map((character) => [character.ocid, character])).values()]
    .sort((a, b) => a.world_name.localeCompare(b.world_name, "ko") || a.character_name.localeCompare(b.character_name, "ko"));
}

export async function listAccountCharacters(accountId) {
  return extractCharacters(await request("/character/list", {}, accountId));
}

export async function validateApiKey(apiKey) {
  return extractCharacters(await request("/character/list", {}, undefined, apiKey));
}

export async function getScheduler(character) {
  return request("/scheduler/character-state", { ocid: character.ocid }, character.accountId);
}

export function isRegistered(item) {
  return item?.registration_flag === true || item?.registration_flag === "true";
}

export function registeredSchedulerItems(scheduler) {
  return [
    ["일일", scheduler.daily_contents || []],
    ["주간", scheduler.weekly_contents || []],
    ["보스", scheduler.boss_contents || []],
  ].map(([category, items]) => ({
    category,
    items: items.filter(isRegistered),
  })).filter((group) => group.items.length > 0);
}
