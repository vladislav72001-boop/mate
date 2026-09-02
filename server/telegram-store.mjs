import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'telegram-subscribers.json');

function defaultStore() {
  return { users: [] };
}

function normalizeStore(raw) {
  if (!raw || typeof raw !== 'object') return defaultStore();
  if (Array.isArray(raw.users)) {
    return {
      users: raw.users
        .filter((u) => u?.chatId != null)
        .map(normalizeUser),
    };
  }
  if (Array.isArray(raw.chatIds)) {
    return {
      users: raw.chatIds.map((chatId) => normalizeUser({
        chatId,
        joinedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      })),
    };
  }
  return defaultStore();
}

function normalizeUser(user) {
  return {
    chatId: Number(user.chatId),
    telegramUserId: user.telegramUserId != null ? Number(user.telegramUserId) : null,
    username: String(user.username || '').trim() || null,
    firstName: String(user.firstName || '').trim() || null,
    lastName: String(user.lastName || '').trim() || null,
    joinedAt: user.joinedAt || new Date().toISOString(),
    lastSeenAt: user.lastSeenAt || user.joinedAt || new Date().toISOString(),
  };
}

export function loadTelegramStore() {
  try {
    if (!existsSync(DATA_FILE)) return defaultStore();
    return normalizeStore(JSON.parse(readFileSync(DATA_FILE, 'utf8')));
  } catch {
    return defaultStore();
  }
}

export function saveTelegramStore(store) {
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

export function getTelegramSubscriberChatIds() {
  return loadTelegramStore().users.map((u) => u.chatId);
}

export function findTelegramUser(chatId) {
  return loadTelegramStore().users.find((u) => u.chatId === Number(chatId)) || null;
}

export function listTelegramUsers() {
  return [...loadTelegramStore().users].sort(
    (a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime(),
  );
}

export function isTelegramAuthed(chatId) {
  return Boolean(findTelegramUser(chatId));
}

export function upsertTelegramUser(from, chatId) {
  const store = loadTelegramStore();
  const id = Number(chatId);
  const now = new Date().toISOString();
  const next = normalizeUser({
    chatId: id,
    telegramUserId: from?.id ?? null,
    username: from?.username ?? null,
    firstName: from?.first_name ?? null,
    lastName: from?.last_name ?? null,
    joinedAt: now,
    lastSeenAt: now,
  });
  const idx = store.users.findIndex((u) => u.chatId === id);
  if (idx >= 0) {
    store.users[idx] = {
      ...store.users[idx],
      ...next,
      joinedAt: store.users[idx].joinedAt || now,
      lastSeenAt: now,
    };
  } else {
    store.users.push(next);
  }
  saveTelegramStore(store);
  return store.users.find((u) => u.chatId === id);
}

export function removeTelegramUser(chatId) {
  const store = loadTelegramStore();
  const id = Number(chatId);
  const before = store.users.length;
  store.users = store.users.filter((u) => u.chatId !== id);
  if (store.users.length !== before) {
    saveTelegramStore(store);
    return true;
  }
  return false;
}

export function touchTelegramUser(chatId, from) {
  if (!isTelegramAuthed(chatId)) return null;
  return upsertTelegramUser(from, chatId);
}

export function isTelegramAdmin(chatId) {
  const raw = String(process.env.TELEGRAM_ADMIN_CHAT_IDS || '').trim();
  if (!raw) return true;
  const ids = raw.split(/[,\s;]+/).map((v) => Number(v.trim())).filter(Boolean);
  return ids.includes(Number(chatId));
}
