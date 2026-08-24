import { randomBytes, randomUUID } from 'node:crypto';
import { notifyOrderCreated, notifyOrderUpdated } from './order-notify.mjs';
import { prisma, mapOrder } from './db.mjs';

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function toDateOrNull(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

export function orderBelongsToUser(order, user) {
  if (!order || !user) return false;
  if (order.userId && order.userId === user.id) return true;
  const email = String(user.email || '').trim().toLowerCase();
  const phone = normalizePhone(user.phone);
  if (email && order.customerEmail === email) return true;
  const receiverEmail = String(order.payload?.receiver?.email || '').trim().toLowerCase();
  if (email && receiverEmail && receiverEmail === email) return true;
  if (phone) {
    const sender = normalizePhone(order.senderPhone);
    const receiver = normalizePhone(order.receiverPhone);
    if (sender && (sender.includes(phone) || phone.includes(sender))) return true;
    if (receiver && (receiver.includes(phone) || phone.includes(receiver))) return true;
  }
  return false;
}

export function newOrderNumber() {
  const t = Date.now().toString(36).toUpperCase();
  const r = randomBytes(3).toString('hex').toUpperCase();
  return `MD-B2C-${t}${r}`;
}

export function newPublicToken() {
  return randomBytes(20).toString('hex');
}

export function isMockNpOrder(order) {
  if (!order) return true;
  if (!order.npRef || String(order.npRef).startsWith('mock-')) return true;
  const provider = order.npSnapshot?.provider;
  if (provider === 'mock' || provider === 'mock-fallback' || provider === 'error') return true;
  const ttn = String(order.npTtn || '');
  if (ttn && /^NP[A-Z0-9]+$/i.test(ttn) && !ttn.startsWith('SH')) return true;
  return false;
}

export async function createOrder(data, options = {}) {
  const created = await prisma.order.create({
    data: {
      id: randomUUID(),
      orderNumber: data.orderNumber || newOrderNumber(),
      publicToken: data.publicToken || newPublicToken(),
      userId: data.userId || null,
      customerEmail: String(data.customerEmail || '').trim().toLowerCase(),
      senderPhone: String(data.senderPhone || '').trim(),
      receiverPhone: String(data.receiverPhone || '').trim(),
      status: data.status || 'pending_payment',
      amount: Number(data.amount) || 0,
      currency: data.currency || 'EUR',
      payload: data.payload ?? {},
      priceBreakdown: data.priceBreakdown ?? null,
      priceSource: data.priceSource ?? null,
      npRef: data.npRef ?? null,
      npTtn: data.npTtn ?? null,
      npSnapshot: data.npSnapshot ?? null,
      paymentMode: data.paymentMode || 'mock',
      stripeSessionId: data.stripeSessionId ?? null,
    },
  });

  const order = mapOrder(created);
  if (options.notify !== false) {
    try {
      await notifyOrderCreated(order);
      console.log(`[mail] order created email sent to ${order.customerEmail}`);
    } catch (err) {
      console.error('[mail] order created notify failed:', err);
    }
  }
  return order;
}

export async function findByPublicToken(publicToken) {
  if (!publicToken) return null;
  return mapOrder(await prisma.order.findUnique({ where: { publicToken } }));
}

export async function findById(id) {
  if (!id) return null;
  return mapOrder(await prisma.order.findUnique({ where: { id } }));
}

export function checkoutPayloadFingerprint(body) {
  const parcel = body?.parcel || {};
  const tariff = body?.tariff || {};
  const payer = String(tariff.payer || 'sender').toLowerCase();
  const promo = String(body?.promoCode || tariff?.promoCode || '').trim().toUpperCase();
  return JSON.stringify({
    to: body?.receiver?.country,
    from: body?.sender?.country || tariff.fromCountry,
    box: parcel.boxSize,
    w: parcel.weightKg,
    dims: [parcel.lengthCm, parcel.widthCm, parcel.heightCm],
    fragile: Boolean(parcel.fragile),
    insurance: Boolean(parcel.insurance),
    pickup: tariff.pickupDate,
    payer: payer === 'recipient' ? 'receiver' : payer,
    promo: promo || null,
  });
}

/** NP scheduledDeliveryDate from npSnapshot (create/get shipment). */
export function extractScheduledDeliveryDate(order) {
  const snap = order?.npSnapshot;
  if (!snap || typeof snap !== 'object') return null;
  const candidates = [
    snap.scheduledDeliveryDate,
    snap.response?.scheduledDeliveryDate,
    snap.raw?.scheduledDeliveryDate,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

/** Prevent duplicate checkouts when user double-clicks Pay. */
export async function findRecentPendingOrder(customerEmail, fingerprint, maxAgeMs = 5 * 60 * 1000) {
  const email = String(customerEmail || '').trim().toLowerCase();
  const since = new Date(Date.now() - maxAgeMs);
  const candidates = await prisma.order.findMany({
    where: {
      status: 'pending_payment',
      customerEmail: email,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  for (const row of candidates) {
    const order = mapOrder(row);
    if (checkoutPayloadFingerprint(order.payload) !== fingerprint) continue;
    return order;
  }
  return null;
}

export async function updateOrder(id, patch, options = {}) {
  const previous = await findById(id);
  if (!previous) return null;

  const data = {};
  const keys = [
    'orderNumber', 'publicToken', 'userId', 'customerEmail', 'senderPhone', 'receiverPhone',
    'status', 'amount', 'currency', 'payload', 'priceBreakdown', 'priceSource',
    'npRef', 'npTtn', 'npSnapshot', 'paymentMode', 'stripeSessionId',
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      data[key] = patch[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'paidAt')) {
    data.paidAt = toDateOrNull(patch.paidAt);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'cancelledAt')) {
    data.cancelledAt = toDateOrNull(patch.cancelledAt);
  }

  const updatedRow = await prisma.order.update({ where: { id }, data });
  const updated = mapOrder(updatedRow);

  if (options.notify !== false) {
    notifyOrderUpdated(previous, updated).catch((err) => {
      console.error('[mail] order update notify failed:', err);
    });
  }
  return updated;
}

export function publicOrder(order) {
  const p = order.payload || {};
  const tariff = p.tariff || {};
  const parcel = p.parcel || {};
  const sender = p.sender || {};
  const receiver = p.receiver || {};
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    publicToken: order.publicToken,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    npTtn: order.npTtn,
    npValid: !isMockNpOrder(order),
    fromCountry: tariff.fromCountry || sender.country || 'HU',
    toCountry: tariff.toCountry || receiver.country,
    parcelSize: parcel.boxSize,
    weightKg: parcel.weightKg,
    fragile: Boolean(parcel.fragile || tariff.fragile),
    insurance: Boolean(parcel.insurance || tariff.insurance),
    pickupDate: tariff.pickupDate,
    pickupTime: tariff.pickupTime,
    senderName: sender.name,
    senderLine: sender.line,
    senderPhone: sender.phone,
    receiverName: [receiver.firstName, receiver.lastName].filter(Boolean).join(' '),
    receiverLine: receiver.destinationLine,
    receiverPhone: receiver.phone,
    receiverEmail: receiver.email || null,
    payer: String(tariff.payer || 'sender').toLowerCase() === 'recipient'
      ? 'receiver'
      : (String(tariff.payer || 'sender').toLowerCase() || 'sender'),
    customerEmail: order.customerEmail,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    tracking: buildTrackingTimeline(order),
    pickupMode: tariff.pickupMode || tariff.pickupType || null,
    deliveryMode: tariff.deliveryMode || tariff.deliveryType || null,
    scheduledDeliveryDate: extractScheduledDeliveryDate(order),
  };
}

function buildTrackingTimeline(order) {
  const events = [
    { id: 'created', title: 'Заявка создана', at: order.createdAt, done: true },
  ];
  if (order.status === 'cancelled') {
    events.push({ id: 'cancelled', title: 'Заказ отменён', at: order.cancelledAt || order.updatedAt, done: true, current: true });
    return events;
  }
  if (order.status === 'pending_payment') {
    events.push({ id: 'payment', title: 'Ожидает оплаты', at: order.createdAt, done: false, current: true });
    return events;
  }

  events.push({ id: 'payment', title: 'Оплачено', at: order.paidAt || order.createdAt, done: true });

  if (order.status === 'waiting_from_you' || order.status === 'paid') {
    events.push({
      id: 'waiting',
      title: 'Жду от Вас посылку',
      at: order.paidAt || order.createdAt,
      done: false,
      current: true,
    });
    events.push({ id: 'pickup', title: 'Забор посылки', at: null, done: false });
    events.push({ id: 'transit', title: 'В пути', at: null, done: false });
    events.push({ id: 'delivery', title: 'Доставка получателю', at: null, done: false });
    return events;
  }

  if (order.status === 'submitted') {
    events.push({ id: 'waiting', title: 'Жду от Вас посылку', at: order.paidAt || order.createdAt, done: true });
    events.push({ id: 'pickup', title: 'Забор посылки', at: order.updatedAt || order.paidAt, done: true });
    events.push({ id: 'transit', title: 'В пути', at: order.updatedAt || order.paidAt, done: true, current: true });
    events.push({ id: 'delivery', title: 'Доставка получателю', at: null, done: false });
    return events;
  }

  if (order.status === 'delivered') {
    events.push({ id: 'waiting', title: 'Жду от Вас посылку', at: order.paidAt || order.createdAt, done: true });
    events.push({ id: 'pickup', title: 'Забор посылки', at: order.paidAt, done: true });
    events.push({ id: 'transit', title: 'В пути', at: order.paidAt, done: true });
    events.push({ id: 'delivery', title: 'Доставлено', at: order.updatedAt || order.paidAt, done: true, current: true });
    return events;
  }

  return events;
}

export async function findOrdersForUser(user) {
  const email = String(user.email || '').trim().toLowerCase();
  const phone = normalizePhone(user.phone);

  const rows = await prisma.order.findMany({
    where: {
      OR: [
        { userId: user.id },
        ...(email ? [{ customerEmail: email }] : []),
        ...(email ? [{ payload: { path: ['receiver', 'email'], equals: email } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  const filtered = rows
    .map(mapOrder)
    .filter((o) => orderBelongsToUser(o, user));

  return filtered.map(publicOrder);
}

export async function listAllOrders() {
  const rows = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(mapOrder);
}

export async function findByTtn(ttn) {
  const q = String(ttn || '').trim().toUpperCase();
  if (!q) return null;

  const byTtn = await prisma.order.findFirst({
    where: { npTtn: { equals: q, mode: 'insensitive' } },
  });
  if (byTtn) return mapOrder(byTtn);

  const byNumber = await prisma.order.findFirst({
    where: {
      OR: [
        { orderNumber: { equals: q, mode: 'insensitive' } },
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { publicToken: { equals: q, mode: 'insensitive' } },
      ],
    },
  });
  return mapOrder(byNumber);
}

export async function findByTrackQuery(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const upper = q.toUpperCase();

  const byId = await prisma.order.findUnique({ where: { id: q } }).catch(() => null);
  if (byId) return mapOrder(byId);

  const found = await prisma.order.findFirst({
    where: {
      OR: [
        { npTtn: { equals: upper, mode: 'insensitive' } },
        { orderNumber: { equals: upper, mode: 'insensitive' } },
        { orderNumber: { contains: upper, mode: 'insensitive' } },
      ],
    },
  });
  return mapOrder(found);
}
