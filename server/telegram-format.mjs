import { isTelegramAdmin } from './telegram-store.mjs';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const STATUS_LABELS = {
  pending_payment: 'Ожидает оплаты',
  paid: 'Оплачен',
  waiting_from_you: 'Ждём посылку от отправителя',
  submitted: 'В пути',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

const MODE_LABELS = {
  home: 'Курьер / на дом',
  address: 'Курьер / на дом',
  courier: 'Курьер',
  branch: 'Отделение',
  locker: 'Постамат',
  pudo: 'Пункт выдачи',
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtShortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function line(label, value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return `<b>${escapeHtml(label)}:</b> ${escapeHtml(v)}`;
}

function locationText(loc) {
  if (!loc || typeof loc !== 'object') return '';
  if (loc.kind === 'division' && loc.divisionId) {
    return `ID ${loc.divisionId}${loc.label ? ` · ${loc.label}` : ''}`;
  }
  const parts = loc.addressParts || loc;
  return [
    parts.street,
    parts.building,
    parts.city,
    parts.postCode || parts.postal,
  ].filter(Boolean).join(', ');
}

function payerLabel(raw) {
  const p = String(raw || 'sender').toLowerCase();
  if (p === 'receiver' || p === 'recipient') return 'Получатель';
  return 'Отправитель';
}

export function orderToCountry(order) {
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

export function formatHuRuOrderMessage(order, { event = 'paid' } = {}) {
  const body = order.payload || {};
  const tariff = body.tariff || {};
  const parcel = body.parcel || {};
  const sender = body.sender || {};
  const receiver = body.receiver || {};
  const pickupMode = tariff.pickupType || tariff.pickupMode || 'home';
  const deliveryMode = tariff.deliveryType || tariff.deliveryMode || 'branch';
  const amount = order.amount != null ? `${order.amount} ${order.currency || 'HUF'}` : '—';
  const title = event === 'created'
    ? '🆕 Новая заявка HU→RU (ожидает оплаты)'
    : event === 'paid'
      ? '✅ Оплаченный заказ HU→RU'
      : '📦 Заказ HU→RU';

  const lines = [
    `<b>${title}</b>`,
    line('Номер', order.orderNumber),
    line('Статус', STATUS_LABELS[order.status] || order.status),
    line('Создан', fmtDate(order.createdAt)),
    order.paidAt ? line('Оплачен', fmtDate(order.paidAt)) : null,
    line('Сумма', amount),
    order.priceSource ? line('Источник цены', order.priceSource) : null,
    '',
    '<b>Маршрут</b>',
    line('Откуда', `${tariff.fromCountry || sender.country || 'HU'} · ${tariff.pickupCity || sender.city || '—'}`),
    line('Куда', `${tariff.toCountry || receiver.country || 'RU'} · ${tariff.destCity || receiver.city || '—'}`),
    '',
    '<b>Забор (Венгрия)</b>',
    line('Способ', MODE_LABELS[String(pickupMode).toLowerCase()] || pickupMode),
    line('Дата', tariff.pickupDate),
    line('Время', tariff.pickupTime),
    line('Адрес', sender.line || locationText(tariff.pickupLocation)),
    line('Город', tariff.pickupCity || sender.city),
    line('Индекс', sender.postal || tariff.pickupPostal),
    '',
    '<b>Доставка (Россия)</b>',
    line('Способ', MODE_LABELS[String(deliveryMode).toLowerCase()] || deliveryMode),
    line('Адрес', receiver.destinationLine || locationText(tariff.deliveryLocation)),
    line('Город', tariff.destCity || receiver.city),
    line('Индекс', receiver.postal || tariff.destPostal),
    '',
    '<b>Отправитель</b>',
    line('ФИО', sender.name || [sender.firstName, sender.lastName].filter(Boolean).join(' ')),
    line('Email', sender.email || order.customerEmail),
    line('Телефон', sender.phone || order.senderPhone),
    '',
    '<b>Получатель</b>',
    line('ФИО', [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || receiver.name),
    line('Email', receiver.email),
    line('Телефон', receiver.phone || order.receiverPhone),
    '',
    '<b>Посылка</b>',
    line('Размер', parcel.boxSize),
    line('Вес', parcel.weightKg != null ? `${parcel.weightKg} kg` : null),
    (parcel.lengthCm && parcel.widthCm && parcel.heightCm)
      ? line('Габариты', `${parcel.lengthCm}×${parcel.widthCm}×${parcel.heightCm} cm`)
      : null,
    line('Содержимое', parcel.contents || body.contents),
    line('Описание', parcel.contentsNote || body.contentsNote || parcel.description),
    line('Хрупкое', parcel.fragile || tariff.fragile ? 'Да' : 'Нет'),
    line('Страховка', parcel.insurance || tariff.insurance ? 'Да' : 'Нет'),
    parcel.insuredValueEur != null ? line('Страховая сумма', `${parcel.insuredValueEur} EUR`) : null,
    parcel.declaredValue != null ? line('Объявленная ценность', `${parcel.declaredValue}`) : null,
    line('Кто платит', payerLabel(tariff.payer || tariff.payerType)),
  ];

  const promo = order.priceBreakdown?.promoCode;
  if (promo) lines.push(line('Промокод', promo));

  return lines.filter(Boolean).join('\n');
}

export function formatOrderListLabel(order) {
  return `${fmtShortDate(order.createdAt || order.paidAt)} · ${order.orderNumber}`;
}

export function formatTelegramProfile(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || '—';
  const lines = [
    '<b>👤 Мой профиль</b>',
    line('Имя', name),
    user.username ? line('Username', `@${user.username}`) : null,
    line('Chat ID', user.chatId),
    user.telegramUserId ? line('Telegram ID', user.telegramUserId) : null,
    line('В боте с', fmtDate(user.joinedAt)),
    line('Последняя активность', fmtDate(user.lastSeenAt)),
    line('Права', isTelegramAdmin(user.chatId) ? 'Администратор' : 'Оператор'),
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatTelegramUsersList(users, { viewerChatId } = {}) {
  if (!users.length) {
    return '<b>👥 Пользователи бота</b>\n\nПока никто не авторизован.';
  }
  const lines = [
    '<b>👥 Пользователи бота</b>',
    `Всего: ${users.length}`,
    '',
  ];
  for (const user of users) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || '—';
    const uname = user.username ? `@${user.username}` : 'без username';
    const marker = user.chatId === Number(viewerChatId) ? ' (вы)' : '';
    lines.push(
      `• ${escapeHtml(name)} ${escapeHtml(uname)}${marker}`,
      `  ID ${user.chatId} · с ${fmtShortDate(user.joinedAt)}`,
    );
  }
  return lines.join('\n');
}

export { fmtDate, fmtShortDate, STATUS_LABELS };
