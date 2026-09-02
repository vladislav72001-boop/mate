import { getTelegramSubscriberChatIds } from './telegram-bot.mjs';
import { updateOrder } from './orders.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function orderToCountry(order) {
  return String(
    order?.toCountry
    || order?.payload?.tariff?.toCountry
    || order?.payload?.receiver?.country
    || '',
  ).toUpperCase();
}

export function isHuRuOrder(order) {
  return orderToCountry(order) === 'RU';
}

function formatHuRuOrderMessage(order) {
  const body = order.payload || {};
  const tariff = body.tariff || {};
  const parcel = body.parcel || {};
  const sender = body.sender || {};
  const receiver = body.receiver || {};
  const pickup = tariff.pickupType || tariff.pickupMode || 'home';
  const delivery = tariff.deliveryType || tariff.deliveryMode || 'branch';
  const amount = order.amount != null ? `${order.amount} ${order.currency || 'HUF'}` : '—';

  const lines = [
    '<b>Новый заказ HU→RU</b>',
    `№ ${escapeHtml(order.orderNumber)}`,
    `Сумма: ${escapeHtml(amount)}`,
    '',
    `<b>Отправитель</b>`,
    `${escapeHtml(sender.firstName || '')} ${escapeHtml(sender.lastName || '')}`.trim(),
    escapeHtml(sender.email || order.customerEmail || ''),
    escapeHtml(sender.phone || ''),
    `${escapeHtml(tariff.pickupCity || sender.city || '')}, ${escapeHtml(sender.street || '')}`.trim(),
    `Забор: ${escapeHtml(String(pickup))}${tariff.pickupDate ? ` · ${escapeHtml(tariff.pickupDate)}` : ''}`,
    '',
    `<b>Получатель</b>`,
    `${escapeHtml(receiver.firstName || '')} ${escapeHtml(receiver.lastName || '')}`.trim(),
    escapeHtml(receiver.email || ''),
    escapeHtml(receiver.phone || ''),
    `${escapeHtml(tariff.destCity || receiver.city || '')}, ${escapeHtml(receiver.street || '')}`.trim(),
    `Доставка: ${escapeHtml(String(delivery))}`,
    '',
    `<b>Посылка</b>`,
    `${escapeHtml(parcel.boxSize || '—')} · ${escapeHtml(String(parcel.weightKg || '—'))} kg`,
  ];

  if (parcel.lengthCm && parcel.widthCm && parcel.heightCm) {
    lines.push(`${parcel.lengthCm}×${parcel.widthCm}×${parcel.heightCm} cm`);
  }
  if (body.contents || body.contentsNote) {
    lines.push(`Содержимое: ${escapeHtml(body.contentsNote || body.contents || '')}`);
  }

  return lines.filter(Boolean).join('\n');
}

export async function notifyTelegramHuRuOrder(order) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !isHuRuOrder(order)) return false;

  const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
    ? order.npSnapshot
    : {};
  if (snap.telegramNotifiedAt) return false;

  const chatIds = getTelegramSubscriberChatIds();
  if (!chatIds.length) {
    console.warn('[telegram] HU→RU order but no subscribed chats:', order.orderNumber);
    return false;
  }

  const text = formatHuRuOrderMessage(order);
  const results = await Promise.allSettled(
    chatIds.map((chatId) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
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
      telegramNotifiedAt: new Date().toISOString(),
    },
  }, { notify: false });

  console.log('[telegram] notified HU→RU order', order.orderNumber, '→', chatIds.length, 'chat(s)');
  return true;
}
