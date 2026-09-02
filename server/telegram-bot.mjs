import { findById, listAllOrders } from './orders.mjs';
import {
  findTelegramUser,
  getTelegramSubscriberChatIds,
  isTelegramAdmin,
  isTelegramAuthed,
  listTelegramUsers,
  removeTelegramUser,
  touchTelegramUser,
  upsertTelegramUser,
} from './telegram-store.mjs';
import {
  formatHuRuOrderMessage,
  formatOrderListLabel,
  formatTelegramProfile,
  formatTelegramUsersList,
  isHuRuOrder,
} from './telegram-format.mjs';

const awaitingPassword = new Set();
const ORDERS_PAGE_SIZE = 8;

export { getTelegramSubscriberChatIds };

export const MAIN_MENU_BUTTONS = {
  orders: '📦 Заказы',
  profile: '👤 Мой профиль',
  users: '👥 Пользователи',
  home: '🏠 Главное меню',
};

function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: MAIN_MENU_BUTTONS.orders }, { text: MAIN_MENU_BUTTONS.profile }],
      [{ text: MAIN_MENU_BUTTONS.users }],
      [{ text: MAIN_MENU_BUTTONS.home }],
    ],
    resize_keyboard: true,
  };
}

function backToMenuInline() {
  return {
    inline_keyboard: [[{ text: '← Главное меню', callback_data: 'menu:home' }]],
  };
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

export async function sendTelegramMessage(token, chatId, text, options = {}) {
  return tgApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options,
  });
}

async function answerCallback(token, callbackQueryId, text) {
  await tgApi(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text || '',
    show_alert: false,
  });
}

function welcomeText() {
  return [
    '<b>MATE Delivery — HU→RU</b>',
    '',
    'Вы авторизованы. Заказы с сайта приходят сюда автоматически.',
    '',
    'Меню:',
    `• ${MAIN_MENU_BUTTONS.orders} — список заявок`,
    `• ${MAIN_MENU_BUTTONS.profile} — ваш профиль`,
    `• ${MAIN_MENU_BUTTONS.users} — кто подключён к боту`,
    `• ${MAIN_MENU_BUTTONS.home} — вернуться сюда`,
  ].join('\n');
}

async function sendMainMenu(token, chatId) {
  await sendTelegramMessage(token, chatId, welcomeText(), {
    reply_markup: mainMenuKeyboard(),
  });
}

async function listHuRuOrders() {
  const orders = await listAllOrders();
  return orders.filter(isHuRuOrder);
}

async function sendOrdersMenu(token, chatId, page = 0) {
  const orders = await listHuRuOrders();
  if (!orders.length) {
    await sendTelegramMessage(token, chatId, '<b>📦 Заказы</b>\n\nПока нет заявок HU→RU.', {
      reply_markup: backToMenuInline(),
    });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(orders.length / ORDERS_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = orders.slice(safePage * ORDERS_PAGE_SIZE, (safePage + 1) * ORDERS_PAGE_SIZE);
  const rows = slice.map((order) => ([{
    text: formatOrderListLabel(order),
    callback_data: `order:${order.id}`,
  }]));

  const nav = [];
  if (safePage > 0) nav.push({ text: '← Раньше', callback_data: `orders:${safePage - 1}` });
  if (safePage < totalPages - 1) nav.push({ text: 'Дальше →', callback_data: `orders:${safePage + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '← Главное меню', callback_data: 'menu:home' }]);

  await sendTelegramMessage(
    token,
    chatId,
    `<b>📦 Заказы HU→RU</b>\nСтраница ${safePage + 1}/${totalPages} · всего ${orders.length}`,
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function sendOrderDetails(token, chatId, orderId) {
  const order = await findById(orderId);
  if (!order || !isHuRuOrder(order)) {
    await sendTelegramMessage(token, chatId, 'Заказ не найден.', {
      reply_markup: backToMenuInline(),
    });
    return;
  }
  const event = order.status === 'pending_payment' ? 'created' : 'paid';
  await sendTelegramMessage(token, chatId, formatHuRuOrderMessage(order, { event }), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '← К списку заказов', callback_data: 'menu:orders:0' }],
        [{ text: '← Главное меню', callback_data: 'menu:home' }],
      ],
    },
  });
}

async function sendProfile(token, chatId) {
  const user = findTelegramUser(chatId);
  if (!user) {
    await sendTelegramMessage(token, chatId, 'Профиль не найден. Отправьте /start');
    return;
  }
  await sendTelegramMessage(token, chatId, formatTelegramProfile(user), {
    reply_markup: backToMenuInline(),
  });
}

async function sendUsersMenu(token, chatId) {
  const users = listTelegramUsers();
  const rows = users.map((user) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
      || user.username
      || String(user.chatId);
    const canRemove = isTelegramAdmin(chatId) && user.chatId !== Number(chatId);
    if (canRemove) {
      return [{
        text: `🗑 ${name}`,
        callback_data: `users:remove:${user.chatId}`,
      }];
    }
    return [{
      text: `👤 ${name}`,
      callback_data: `users:view:${user.chatId}`,
    }];
  });
  rows.push([{ text: '← Главное меню', callback_data: 'menu:home' }]);

  await sendTelegramMessage(
    token,
    chatId,
    formatTelegramUsersList(users, { viewerChatId: chatId }),
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function handleMenuText(token, chatId, text, from) {
  touchTelegramUser(chatId, from);

  if (text === MAIN_MENU_BUTTONS.home || text === '/menu') {
    await sendMainMenu(token, chatId);
    return;
  }
  if (text === MAIN_MENU_BUTTONS.orders || text === '/orders') {
    await sendOrdersMenu(token, chatId, 0);
    return;
  }
  if (text === MAIN_MENU_BUTTONS.profile || text === '/profile') {
    await sendProfile(token, chatId);
    return;
  }
  if (text === MAIN_MENU_BUTTONS.users || text === '/users') {
    await sendUsersMenu(token, chatId);
    return;
  }

  await sendTelegramMessage(
    token,
    chatId,
    'Используйте кнопки меню или /menu',
    { reply_markup: mainMenuKeyboard() },
  );
}

async function handleCallback(token, callback) {
  const chatId = callback.message?.chat?.id;
  const data = String(callback.data || '');
  if (!chatId) return;

  if (!isTelegramAuthed(chatId)) {
    await answerCallback(token, callback.id, 'Сначала войдите через /start');
    return;
  }

  touchTelegramUser(chatId, callback.from);
  await answerCallback(token, callback.id);

  if (data === 'menu:home') {
    await sendMainMenu(token, chatId);
    return;
  }
  if (data === 'menu:orders:0' || data === 'menu:orders') {
    await sendOrdersMenu(token, chatId, 0);
    return;
  }
  if (data.startsWith('orders:')) {
    const page = Number(data.slice('orders:'.length)) || 0;
    await sendOrdersMenu(token, chatId, page);
    return;
  }
  if (data.startsWith('order:')) {
    await sendOrderDetails(token, chatId, data.slice('order:'.length));
    return;
  }
  if (data.startsWith('users:view:')) {
    const user = findTelegramUser(Number(data.slice('users:view:'.length)));
    if (!user) {
      await sendTelegramMessage(token, chatId, 'Пользователь не найден.', {
        reply_markup: backToMenuInline(),
      });
      return;
    }
    await sendTelegramMessage(token, chatId, formatTelegramProfile(user), {
      reply_markup: backToMenuInline(),
    });
    return;
  }
  if (data.startsWith('users:remove:')) {
    const targetId = Number(data.slice('users:remove:'.length));
    if (!isTelegramAdmin(chatId)) {
      await sendTelegramMessage(token, chatId, 'Недостаточно прав для удаления пользователей.');
      return;
    }
    if (targetId === Number(chatId)) {
      await sendTelegramMessage(token, chatId, 'Нельзя удалить самого себя.');
      return;
    }
    removeTelegramUser(targetId);
    await sendTelegramMessage(token, chatId, `Пользователь ${targetId} удалён из бота.`);
    await sendUsersMenu(token, chatId);
  }
}

async function handleMessage(token, password, msg) {
  const chatId = msg.chat?.id;
  const text = String(msg.text || '').trim();
  const from = msg.from;
  if (!chatId) return;

  if (text === '/start') {
    awaitingPassword.add(chatId);
    await sendTelegramMessage(
      token,
      chatId,
      'Добро пожаловать в MATE Delivery!\n\nВведите пароль для доступа к заказам с сайта.',
    );
    return;
  }

  if (text === '/stop') {
    if (isTelegramAuthed(chatId)) {
      removeTelegramUser(chatId);
    }
    awaitingPassword.delete(chatId);
    await sendTelegramMessage(
      token,
      chatId,
      'Вы вышли из бота. Чтобы снова получать заказы — /start',
      { reply_markup: { remove_keyboard: true } },
    );
    return;
  }

  if (isTelegramAuthed(chatId)) {
    await handleMenuText(token, chatId, text, from);
    return;
  }

  if (!awaitingPassword.has(chatId)) {
    awaitingPassword.add(chatId);
    await sendTelegramMessage(token, chatId, 'Введите пароль для доступа к заказам с сайта.');
    return;
  }

  if (text === password) {
    awaitingPassword.delete(chatId);
    upsertTelegramUser(from, chatId);
    await sendTelegramMessage(
      token,
      chatId,
      'Вы успешно вошли. Вам будут отправляться заказы с сайта MATE Delivery.',
    );
    await sendMainMenu(token, chatId);
    return;
  }

  await sendTelegramMessage(token, chatId, 'Неверный пароль. Попробуйте снова или отправьте /start.');
}

async function handleUpdate(token, password, update) {
  if (update.callback_query) {
    await handleCallback(token, update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(token, password, update.message);
  }
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

  console.log('[telegram] bot started (long polling + menu)');
  pollLoop().catch((err) => console.error('[telegram] loop stopped:', err?.message || err));
}
