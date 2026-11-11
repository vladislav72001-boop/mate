import {
  canHardDeleteOrder,
  deleteOrder,
  findById,
  listAllOrders,
  updateOrder,
} from './orders.mjs';
import {
  HU_RU_FOLDER_ORDER,
  HU_RU_FOLDERS,
  HU_RU_STAGE_ORDER,
  HU_RU_STAGES,
  buildHuRuStatusPatch,
  orderMatchesHuRuFolder,
  resolveHuRuFolderKey,
  resolveHuRuStageKey,
} from './hu-ru-status.mjs';
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
/** @type {Map<number, { type: string, orderId?: string, folderKey?: string }>} */
const awaitingInput = new Map();
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
  if (!callbackQueryId || callbackQueryId === 'noop') return;
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
    `• ${MAIN_MENU_BUTTONS.orders} — папки: ждём забор / в пути / архив`,
    `• ${MAIN_MENU_BUTTONS.profile} — ваш профиль`,
    `• ${MAIN_MENU_BUTTONS.users} — кто подключён к боту`,
    `• ${MAIN_MENU_BUTTONS.home} — вернуться сюда`,
    '',
    'В карточке заказа: этапы, трек СДЭК при «В пути», удаление без оплаты / отменённых.',
  ].join('\n');
}

function orderStatusKeyboard(order) {
  const current = resolveHuRuStageKey(order);
  const folderKey = resolveHuRuFolderKey(order);
  const rows = [];
  const stageKeys = [...HU_RU_STAGE_ORDER, 'cancel'];
  for (let i = 0; i < stageKeys.length; i += 2) {
    const chunk = stageKeys.slice(i, i + 2).map((key) => {
      const stage = HU_RU_STAGES[key];
      const mark = key === current ? ' ✓' : '';
      return {
        text: `${stage.button}${mark}`,
        callback_data: `st:${order.id}:${key}`,
      };
    });
    rows.push(chunk);
  }
  rows.push([{
    text: order.npTtn ? `📋 Трек СДЭК: ${String(order.npTtn).slice(0, 18)}` : '📋 Указать трек СДЭК',
    callback_data: `trkask:${order.id}`,
  }]);
  if (canHardDeleteOrder(order)) {
    rows.push([{ text: '🗑 Удалить заказ', callback_data: `del:${order.id}` }]);
  }
  rows.push([{ text: '← К папке', callback_data: `folder:${folderKey}:0` }]);
  rows.push([{ text: '📂 Все папки', callback_data: 'menu:orders' }]);
  rows.push([{ text: '← Главное меню', callback_data: 'menu:home' }]);
  return { inline_keyboard: rows };
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

function countByFolder(orders) {
  const counts = Object.create(null);
  for (const key of HU_RU_FOLDER_ORDER) counts[key] = 0;
  for (const order of orders) {
    const key = resolveHuRuFolderKey(order);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Root: folders with counts (ждём / в пути / без оплаты / архив). */
async function sendOrdersMenu(token, chatId) {
  const orders = await listHuRuOrders();
  if (!orders.length) {
    await sendTelegramMessage(token, chatId, '<b>📦 Заказы</b>\n\nПока нет заявок HU→RU.', {
      reply_markup: backToMenuInline(),
    });
    return;
  }

  const counts = countByFolder(orders);
  const rows = HU_RU_FOLDER_ORDER.map((key) => {
    const folder = HU_RU_FOLDERS[key];
    const n = counts[key] || 0;
    return [{
      text: `${folder.title} (${n})`,
      callback_data: `folder:${key}:0`,
    }];
  });
  rows.push([{ text: '← Главное меню', callback_data: 'menu:home' }]);

  const active = (counts.wait || 0) + (counts.transit || 0) + (counts.unpaid || 0);
  await sendTelegramMessage(
    token,
    chatId,
    [
      '<b>📦 Заказы HU→RU</b>',
      '',
      `Активных: <b>${active}</b> · в архиве: <b>${counts.archive || 0}</b> · всего: ${orders.length}`,
      '',
      'Выберите папку:',
      '📥 не забрали · ✈️ в пути · 🗄 доставлен / отменён',
    ].join('\n'),
    { reply_markup: { inline_keyboard: rows } },
  );
}

async function sendFolderOrders(token, chatId, folderKey, page = 0) {
  const folder = HU_RU_FOLDERS[folderKey];
  if (!folder) {
    await sendOrdersMenu(token, chatId);
    return;
  }

  const orders = (await listHuRuOrders()).filter((o) => orderMatchesHuRuFolder(o, folderKey));
  if (!orders.length) {
    await sendTelegramMessage(
      token,
      chatId,
      `<b>${folder.title}</b>\n\nВ этой папке пока пусто.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📂 Все папки', callback_data: 'menu:orders' }],
            [{ text: '← Главное меню', callback_data: 'menu:home' }],
          ],
        },
      },
    );
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
  if (safePage > 0) nav.push({ text: '← Раньше', callback_data: `folder:${folderKey}:${safePage - 1}` });
  if (safePage < totalPages - 1) nav.push({ text: 'Дальше →', callback_data: `folder:${folderKey}:${safePage + 1}` });
  if (nav.length) rows.push(nav);
  if (folderKey === 'unpaid') {
    rows.push([{ text: '🗑 Удалить все без оплаты', callback_data: 'delall:unpaid' }]);
  }
  if (folderKey === 'archive') {
    rows.push([{ text: '🗑 Удалить все отменённые', callback_data: 'delall:cancelled' }]);
  }
  rows.push([{ text: '📂 Все папки', callback_data: 'menu:orders' }]);
  rows.push([{ text: '← Главное меню', callback_data: 'menu:home' }]);

  await sendTelegramMessage(
    token,
    chatId,
    `<b>${folder.title}</b>\nСтраница ${safePage + 1}/${totalPages} · заказов: ${orders.length}`,
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
  const event = order.status === 'pending_payment' ? 'created' : 'status';
  const unpaid = order.status === 'pending_payment';
  const folderKey = resolveHuRuFolderKey(order);
  await sendTelegramMessage(token, chatId, formatHuRuOrderMessage(order, { event }), {
    reply_markup: unpaid
      ? {
        inline_keyboard: [
          [{ text: '🗑 Удалить заказ', callback_data: `del:${order.id}` }],
          [{ text: '← К папке', callback_data: `folder:${folderKey}:0` }],
          [{ text: '📂 Все папки', callback_data: 'menu:orders' }],
          [{ text: '← Главное меню', callback_data: 'menu:home' }],
        ],
      }
      : orderStatusKeyboard(order),
  });
}

function normalizeCdekTrack(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

async function askCdekTrack(token, chatId, order, { afterTransit = false } = {}) {
  awaitingInput.set(Number(chatId), {
    type: 'cdek_track',
    orderId: order.id,
    afterTransit: Boolean(afterTransit),
  });
  const hint = afterTransit
    ? 'Статус станет «В пути». Пришлите трек-номер СДЭК одним сообщением.'
    : 'Пришлите трек-номер СДЭК одним сообщением — клиент увидит его в кабинете.';
  await sendTelegramMessage(
    token,
    chatId,
    [
      `<b>Трек СДЭК</b> для ${escapeHtml(order.orderNumber)}`,
      '',
      hint,
      order.npTtn ? `Сейчас: <code>${escapeHtml(order.npTtn)}</code>` : null,
      '',
      'Или нажмите «Пропустить».',
    ].filter(Boolean).join('\n'),
    {
      reply_markup: {
        inline_keyboard: [
          afterTransit
            ? [{ text: 'Пропустить (без трека)', callback_data: `trskip:${order.id}` }]
            : [{ text: 'Отмена', callback_data: `order:${order.id}` }],
          [{ text: '← К заказу', callback_data: `order:${order.id}` }],
        ],
      },
    },
  );
}

async function saveCdekTrack(order, track, { actorChatId } = {}) {
  const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
    ? { ...order.npSnapshot }
    : {};
  return updateOrder(order.id, {
    npTtn: track,
    npRef: order.npRef && !String(order.npRef).startsWith('mock-')
      ? order.npRef
      : `cdek-${track}`,
    npSnapshot: {
      ...snap,
      provider: snap.provider || 'hu-ru',
      manualFulfillment: true,
      carrier: 'cdek',
      cdekTrack: track,
      cdekTrackUpdatedAt: new Date().toISOString(),
      cdekTrackUpdatedBy: actorChatId != null ? Number(actorChatId) : null,
    },
  }, { notify: false });
}

async function applyHuRuStage(
  token,
  chatId,
  orderId,
  stageKey,
  callbackQueryId,
  { confirmed = false, skipTrackPrompt = false, track = null } = {},
) {
  const order = await findById(orderId);
  if (!order || !isHuRuOrder(order)) {
    await answerCallback(token, callbackQueryId, 'Заказ не найден');
    return;
  }
  if (order.status === 'pending_payment') {
    await answerCallback(token, callbackQueryId, 'Сначала нужна оплата');
    return;
  }

  const current = resolveHuRuStageKey(order);
  if (current === stageKey && track == null) {
    await answerCallback(token, callbackQueryId, 'Уже этот статус');
    await sendOrderDetails(token, chatId, orderId);
    return;
  }

  if (stageKey === 'cancel' && !confirmed) {
    await answerCallback(token, callbackQueryId, 'Подтвердите отмену');
    await sendTelegramMessage(
      token,
      chatId,
      `<b>Отменить заказ ${escapeHtml(order.orderNumber)}?</b>\nСтатус у клиента станет «Отменён».`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Да, отменить', callback_data: `stc:${order.id}:yes` },
              { text: 'Нет', callback_data: `order:${order.id}` },
            ],
          ],
        },
      },
    );
    return;
  }

  // «В пути» after sorting — ask for CDEK track so clients see it.
  if (stageKey === 'transit' && !skipTrackPrompt && track == null) {
    await answerCallback(token, callbackQueryId, 'Укажите трек СДЭК');
    await askCdekTrack(token, chatId, order, { afterTransit: true });
    return;
  }

  const built = buildHuRuStatusPatch(order, stageKey, { actorChatId: chatId });
  if (built.error) {
    await answerCallback(token, callbackQueryId, built.error);
    return;
  }

  if (track) {
    const normalized = normalizeCdekTrack(track);
    built.patch.npTtn = normalized;
    built.patch.npRef = order.npRef && !String(order.npRef).startsWith('mock-')
      ? order.npRef
      : `cdek-${normalized}`;
    built.patch.npSnapshot = {
      ...built.patch.npSnapshot,
      carrier: 'cdek',
      cdekTrack: normalized,
      cdekTrackUpdatedAt: new Date().toISOString(),
      cdekTrackUpdatedBy: Number(chatId),
    };
  }

  const updated = await updateOrder(order.id, built.patch);
  await answerCallback(token, callbackQueryId, built.stage.label);
  const trackLine = updated?.npTtn
    ? `\nТрек СДЭК: <code>${escapeHtml(updated.npTtn)}</code>`
    : '';
  await sendTelegramMessage(
    token,
    chatId,
    `✅ Статус обновлён: <b>${escapeHtml(built.stage.label)}</b>${trackLine}\nКлиент увидит это в личном кабинете.`,
  );
  await sendOrderDetails(token, chatId, updated?.id || orderId);
}

async function confirmDeleteOrder(token, chatId, orderId, callbackQueryId) {
  const order = await findById(orderId);
  if (!order || !isHuRuOrder(order)) {
    await answerCallback(token, callbackQueryId, 'Заказ не найден');
    return;
  }
  if (!canHardDeleteOrder(order)) {
    await answerCallback(token, callbackQueryId, 'Можно удалять только без оплаты / отменённые');
    return;
  }
  await answerCallback(token, callbackQueryId, 'Подтвердите удаление');
  await sendTelegramMessage(
    token,
    chatId,
    `<b>Удалить ${escapeHtml(order.orderNumber)}?</b>\nЗаказ исчезнет из бота и базы. Это необратимо.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Да, удалить', callback_data: `delc:${order.id}:yes` },
            { text: 'Нет', callback_data: `order:${order.id}` },
          ],
        ],
      },
    },
  );
}

async function executeDeleteOrder(token, chatId, orderId, callbackQueryId) {
  const order = await findById(orderId);
  if (!order || !isHuRuOrder(order)) {
    await answerCallback(token, callbackQueryId, 'Заказ не найден');
    return;
  }
  if (!canHardDeleteOrder(order)) {
    await answerCallback(token, callbackQueryId, 'Удаление запрещено');
    return;
  }
  const folderKey = resolveHuRuFolderKey(order);
  const ok = await deleteOrder(order.id);
  await answerCallback(token, callbackQueryId, ok ? 'Удалено' : 'Ошибка');
  if (ok) {
    await sendTelegramMessage(token, chatId, `🗑 Заказ <b>${escapeHtml(order.orderNumber)}</b> удалён.`);
    await sendFolderOrders(token, chatId, folderKey, 0);
  }
}

async function executeDeleteAll(token, chatId, kind, callbackQueryId, { confirmed = false } = {}) {
  if (!confirmed) {
    await answerCallback(token, callbackQueryId, 'Подтвердите очистку');
    const label = kind === 'unpaid' ? 'все заказы без оплаты' : 'все отменённые заказы';
    await sendTelegramMessage(
      token,
      chatId,
      `<b>Удалить ${label}?</b>\nНеобратимо.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Да, удалить', callback_data: `delallc:${kind}:yes` },
              { text: 'Нет', callback_data: kind === 'unpaid' ? 'folder:unpaid:0' : 'folder:archive:0' },
            ],
          ],
        },
      },
    );
    return;
  }

  const orders = await listHuRuOrders();
  const targets = orders.filter((o) => (
    kind === 'unpaid'
      ? o.status === 'pending_payment'
      : o.status === 'cancelled'
  ));
  let deleted = 0;
  for (const order of targets) {
    if (await deleteOrder(order.id)) deleted += 1;
  }
  await answerCallback(token, callbackQueryId, `Удалено: ${deleted}`);
  await sendTelegramMessage(token, chatId, `🗑 Удалено заказов: <b>${deleted}</b>.`);
  await sendFolderOrders(token, chatId, kind === 'unpaid' ? 'unpaid' : 'archive', 0);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

async function handlePendingInput(token, chatId, text, from) {
  const pending = awaitingInput.get(Number(chatId));
  if (!pending) return false;
  touchTelegramUser(chatId, from);

  if (pending.type === 'cdek_track') {
    if (text === '/cancel' || text === MAIN_MENU_BUTTONS.home || text === MAIN_MENU_BUTTONS.orders) {
      awaitingInput.delete(Number(chatId));
      if (text === MAIN_MENU_BUTTONS.orders || text === '/orders') await sendOrdersMenu(token, chatId);
      else if (text === MAIN_MENU_BUTTONS.home || text === '/menu') await sendMainMenu(token, chatId);
      else await sendOrderDetails(token, chatId, pending.orderId);
      return true;
    }
    const track = normalizeCdekTrack(text);
    if (track.length < 6 || track.length > 40) {
      await sendTelegramMessage(
        token,
        chatId,
        'Трек слишком короткий или длинный. Пришлите номер СДЭК ещё раз (или /cancel).',
      );
      return true;
    }
    awaitingInput.delete(Number(chatId));
    if (pending.afterTransit) {
      await applyHuRuStage(token, chatId, pending.orderId, 'transit', 'noop', {
        skipTrackPrompt: true,
        track,
      });
      return true;
    }
    const order = await findById(pending.orderId);
    if (!order || !isHuRuOrder(order)) {
      await sendTelegramMessage(token, chatId, 'Заказ не найден.');
      return true;
    }
    const updated = await saveCdekTrack(order, track, { actorChatId: chatId });
    await sendTelegramMessage(
      token,
      chatId,
      `✅ Трек СДЭК сохранён: <code>${escapeHtml(track)}</code>\nКлиент увидит его в кабинете.`,
    );
    await sendOrderDetails(token, chatId, updated?.id || pending.orderId);
    return true;
  }
  return false;
}

async function handleMenuText(token, chatId, text, from) {
  if (await handlePendingInput(token, chatId, text, from)) return;

  touchTelegramUser(chatId, from);

  if (text === MAIN_MENU_BUTTONS.home || text === '/menu') {
    awaitingInput.delete(Number(chatId));
    await sendMainMenu(token, chatId);
    return;
  }
  if (text === MAIN_MENU_BUTTONS.orders || text === '/orders') {
    awaitingInput.delete(Number(chatId));
    await sendOrdersMenu(token, chatId);
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

  if (data.startsWith('st:')) {
    const rest = data.slice('st:'.length);
    const sep = rest.lastIndexOf(':');
    if (sep <= 0) {
      await answerCallback(token, callback.id, 'Некорректная команда');
      return;
    }
    const orderId = rest.slice(0, sep);
    const stageKey = rest.slice(sep + 1);
    await applyHuRuStage(token, chatId, orderId, stageKey, callback.id);
    return;
  }
  if (data.startsWith('stc:') && data.endsWith(':yes')) {
    const orderId = data.slice('stc:'.length, -':yes'.length);
    await applyHuRuStage(token, chatId, orderId, 'cancel', callback.id, { confirmed: true });
    return;
  }
  if (data.startsWith('trkask:')) {
    const orderId = data.slice('trkask:'.length);
    const order = await findById(orderId);
    if (!order || !isHuRuOrder(order)) {
      await answerCallback(token, callback.id, 'Заказ не найден');
      return;
    }
    await answerCallback(token, callback.id, 'Жду трек');
    await askCdekTrack(token, chatId, order, { afterTransit: false });
    return;
  }
  if (data.startsWith('trskip:')) {
    const orderId = data.slice('trskip:'.length);
    awaitingInput.delete(Number(chatId));
    await applyHuRuStage(token, chatId, orderId, 'transit', callback.id, { skipTrackPrompt: true });
    return;
  }
  if (data.startsWith('del:') && !data.startsWith('delc:') && !data.startsWith('delall')) {
    await confirmDeleteOrder(token, chatId, data.slice('del:'.length), callback.id);
    return;
  }
  if (data.startsWith('delc:') && data.endsWith(':yes')) {
    const orderId = data.slice('delc:'.length, -':yes'.length);
    await executeDeleteOrder(token, chatId, orderId, callback.id);
    return;
  }
  if (data === 'delall:unpaid' || data === 'delall:cancelled') {
    await executeDeleteAll(token, chatId, data.slice('delall:'.length), callback.id);
    return;
  }
  if (data.startsWith('delallc:') && data.endsWith(':yes')) {
    const kind = data.slice('delallc:'.length, -':yes'.length);
    await executeDeleteAll(token, chatId, kind, callback.id, { confirmed: true });
    return;
  }

  awaitingInput.delete(Number(chatId));
  await answerCallback(token, callback.id);

  if (data === 'menu:home') {
    await sendMainMenu(token, chatId);
    return;
  }
  if (data === 'menu:orders:0' || data === 'menu:orders') {
    await sendOrdersMenu(token, chatId);
    return;
  }
  if (data.startsWith('folder:')) {
    const parts = data.split(':');
    const folderKey = parts[1] || 'wait';
    const page = Number(parts[2]) || 0;
    await sendFolderOrders(token, chatId, folderKey, page);
    return;
  }
  // Legacy pagination from older messages → open folders root.
  if (data.startsWith('orders:')) {
    await sendOrdersMenu(token, chatId);
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
