import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'telegram-subscribers.json');
const awaitingPassword = new Set();

function loadStore() {
  try {
    if (!existsSync(DATA_FILE)) return { chatIds: [] };
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return { chatIds: Array.isArray(parsed?.chatIds) ? parsed.chatIds : [] };
  } catch {
    return { chatIds: [] };
  }
}

function saveStore(data) {
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

export function getTelegramSubscriberChatIds() {
  return loadStore().chatIds;
}

function isAuthedChat(chatId) {
  return loadStore().chatIds.includes(chatId);
}

async function tgApi(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }
  return data;
}

async function sendMessage(token, chatId, text) {
  await tgApi(token, 'sendMessage', { chat_id: chatId, text });
}

async function handleUpdate(token, password, update) {
  const msg = update.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();

  if (text === '/start') {
    awaitingPassword.add(chatId);
    await sendMessage(
      token,
      chatId,
      'Добро пожаловать в MATE Delivery!\n\nВведите пароль для доступа к заказам с сайта.',
    );
    return;
  }

  if (isAuthedChat(chatId)) {
    if (text === '/stop') {
      const store = loadStore();
      store.chatIds = store.chatIds.filter((id) => id !== chatId);
      saveStore(store);
      awaitingPassword.delete(chatId);
      await sendMessage(token, chatId, 'Вы отписаны от уведомлений. Чтобы снова получать заказы — /start');
    }
    return;
  }

  if (!awaitingPassword.has(chatId)) {
    awaitingPassword.add(chatId);
    await sendMessage(token, chatId, 'Введите пароль для доступа к заказам с сайта.');
    return;
  }

  if (text === password) {
    awaitingPassword.delete(chatId);
    const store = loadStore();
    if (!store.chatIds.includes(chatId)) {
      store.chatIds.push(chatId);
      saveStore(store);
    }
    await sendMessage(
      token,
      chatId,
      'Вы успешно вошли. Вам будут отправляться заказы с сайта MATE Delivery.',
    );
    return;
  }

  await sendMessage(token, chatId, 'Неверный пароль. Попробуйте снова или отправьте /start.');
}

export function startTelegramBot() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }

  const password = String(process.env.TELEGRAM_BOT_PASSWORD || 'mate123delivery').trim();
  let offset = 0;
  let running = false;

  async function pollLoop() {
    if (running) return;
    running = true;
    while (true) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.ok) {
          console.error('[telegram] getUpdates:', data.description || 'unknown error');
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        for (const update of data.result || []) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(token, password, update);
          } catch (err) {
            console.error('[telegram] handle update:', err?.message || err);
          }
        }
      } catch (err) {
        console.error('[telegram] poll:', err?.message || err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  console.log('[telegram] bot started (long polling)');
  pollLoop().catch((err) => console.error('[telegram] loop stopped:', err?.message || err));
}
