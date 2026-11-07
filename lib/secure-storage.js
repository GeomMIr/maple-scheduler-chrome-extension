const ACCOUNTS_KEY = "apiAccounts";
const ACTIVE_ACCOUNT_KEY = "activeApiAccountId";

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function importEncryptionKey(secret) {
  return crypto.subtle.importKey("raw", base64ToBytes(secret), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function getAccounts() {
  const { [ACCOUNTS_KEY]: accounts = [] } = await chrome.storage.local.get(ACCOUNTS_KEY);
  return accounts;
}

export async function listApiAccounts() {
  return (await getAccounts()).map(({ id, label, addedAt }) => ({ id, label, addedAt }));
}

export async function getActiveAccountId() {
  const { [ACTIVE_ACCOUNT_KEY]: accountId } = await chrome.storage.local.get(ACTIVE_ACCOUNT_KEY);
  return accountId;
}

export async function setActiveAccountId(accountId) {
  await chrome.storage.local.set({ [ACTIVE_ACCOUNT_KEY]: accountId });
}

export async function storeApiKey(apiKey, label = "") {
  const accounts = await getAccounts();
  for (const account of accounts) {
    if (await getApiKey(account.id) === apiKey.trim()) {
      await setActiveAccountId(account.id);
      return account.id;
    }
  }
  const id = crypto.randomUUID();
  const secret = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(apiKey.trim()));
  const account = { id, label: label.trim() || `계정 ${accounts.length + 1}`, addedAt: new Date().toISOString(), ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv), secret };
  await chrome.storage.local.set({ [ACCOUNTS_KEY]: [...accounts, account], [ACTIVE_ACCOUNT_KEY]: id });
  return id;
}

export async function getApiKey(accountId) {
  const selectedAccountId = accountId ?? await getActiveAccountId();
  const account = (await getAccounts()).find((item) => item.id === selectedAccountId);
  if (!account) return null;
  const key = await importEncryptionKey(account.secret);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(account.iv) }, key, base64ToBytes(account.ciphertext));
  return new TextDecoder().decode(decrypted);
}

export async function hasStoredApiKey() {
  return (await getAccounts()).length > 0;
}

export async function updateAccountLabel(accountId, label) {
  const accounts = await getAccounts();
  await chrome.storage.local.set({
    [ACCOUNTS_KEY]: accounts.map((account) => account.id === accountId ? { ...account, label: label.trim() || account.label } : account),
  });
}

export async function deleteApiAccount(accountId) {
  const accounts = await getAccounts();
  const remaining = accounts.filter((account) => account.id !== accountId);
  const activeId = await getActiveAccountId();
  const update = { [ACCOUNTS_KEY]: remaining };
  if (activeId === accountId) update[ACTIVE_ACCOUNT_KEY] = remaining[0]?.id || null;
  await chrome.storage.local.set(update);
  const { managedCharactersByAccount = {} } = await chrome.storage.local.get("managedCharactersByAccount");
  delete managedCharactersByAccount[accountId];
  await chrome.storage.local.set({ managedCharactersByAccount });
}
