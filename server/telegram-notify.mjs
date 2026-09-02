import { updateOrder } from './orders.mjs';
import { getTelegramSubscriberChatIds, sendTelegramMessage } from './telegram-bot.mjs';
import { formatHuRuOrderMessage, isHuRuOrder } from './telegram-format.mjs';

export { isHuRuOrder } from './telegram-format.mjs';

function notifyDedupKey(event) {
  return event === 'created' ? 'telegramCreatedNotifiedAt' : 'telegramNotifiedAt';
}

export async function notifyTelegramHuRuOrder(order, { event = 'paid' } = {}) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !isHuRuOrder(order)) return false;

  const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
    ? order.npSnapshot
    : {};
  const dedupField = notifyDedupKey(event);
  if (snap[dedupField]) return false;

  const chatIds = getTelegramSubscriberChatIds();
  if (!chatIds.length) {
    console.warn('[telegram] HU→RU order but no subscribed chats:', order.orderNumber);
    return false;
  }

  const text = formatHuRuOrderMessage(order, { event });
  const replyMarkup = {
    inline_keyboard: [
      [{ text: '📦 Открыть заказ', callback_data: `order:${order.id}` }],
      [{ text: '📋 Список заказов', callback_data: 'menu:orders:0' }],
    ],
  };

  const results = await Promise.allSettled(
    chatIds.map((chatId) => sendTelegramMessage(token, chatId, text, {
      reply_markup: replyMarkup,
    })),
  );

  const ok = results.some((r) => r.status === 'fulfilled');
  if (!ok) {
    console.error('[telegram] notify failed for', order.orderNumber);
    return false;
  }

  await updateOrder(order.id, {
    npSnapshot: {
      ...snap,
      [dedupField]: new Date().toISOString(),
    },
  }, { notify: false });

  console.log('[telegram] notified HU→RU order', order.orderNumber, event, '→', chatIds.length, 'chat(s)');
  return true;
}
