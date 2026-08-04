import { prisma } from './db.mjs';
import { listAllOrders } from './orders.mjs';
import { getSettings } from './pricing-config.mjs';

const ALLOWED_EVENTS = new Set([
  'calc_step',
  'calc_pay_click',
  'calc_checkout_ok',
  'page_view',
]);

const rateBuckets = new Map();

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'unknown';
}

/** Simple in-memory rate limit: max N events per IP per minute. */
export function assertAnalyticsRateLimit(req, { maxPerMinute = 60 } = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.startedAt > 60_000) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > maxPerMinute) {
    const err = new Error('Too many analytics events');
    err.status = 429;
    throw err;
  }
}

function cleanStr(value, max = 64) {
  const s = String(value || '').trim();
  if (!s) return null;
  return s.slice(0, max);
}

export async function recordAnalyticsEvent(body) {
  const event = cleanStr(body?.event, 40);
  if (!event || !ALLOWED_EVENTS.has(event)) {
    const err = new Error('Unknown analytics event');
    err.status = 400;
    throw err;
  }
  const sessionId = cleanStr(body?.sessionId, 80);
  if (!sessionId || sessionId.length < 8) {
    const err = new Error('sessionId required');
    err.status = 400;
    throw err;
  }

  const stepRaw = body?.step;
  const step = stepRaw == null || stepRaw === ''
    ? null
    : Math.min(9, Math.max(1, Number(stepRaw) || 0)) || null;

  return prisma.analyticsEvent.create({
    data: {
      sessionId,
      event,
      step,
      toCountry: cleanStr(body?.toCountry, 8),
      fromCity: cleanStr(body?.fromCity, 80),
      toCity: cleanStr(body?.toCity, 80),
      sizeKey: cleanStr(body?.sizeKey, 24),
      pickupMode: cleanStr(body?.pickupMode, 24),
      deliveryMode: cleanStr(body?.deliveryMode, 24),
      locale: cleanStr(body?.locale, 8),
      page: cleanStr(body?.page, 40),
    },
  });
}

function daysAgoDate(days) {
  const d = Number(days) || 30;
  const safe = [7, 30, 90].includes(d) ? d : 30;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - safe);
  from.setUTCHours(0, 0, 0, 0);
  return { days: safe, from };
}

function bump(map, key, by = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + by);
}

function topMap(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function weekdayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][d.getDay()];
}

function hourBucket(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

function orderMeta(order) {
  const p = order.payload || {};
  const tariff = p.tariff || {};
  const parcel = p.parcel || {};
  const sender = p.sender || {};
  const receiver = p.receiver || {};
  const pickupLoc = tariff.pickupLocation || p.pickupLocation || {};
  const deliveryLoc = tariff.deliveryLocation || p.deliveryLocation || {};
  const fromCountry = String(tariff.fromCountry || sender.country || 'HU').toUpperCase();
  const toCountry = String(tariff.toCountry || receiver.country || '').toUpperCase();
  const fromCity = String(
    tariff.fromCity
    || pickupLoc.addressParts?.city
    || pickupLoc.city
    || '',
  ).trim() || null;
  const toCity = String(
    tariff.toCity
    || deliveryLoc.addressParts?.city
    || deliveryLoc.city
    || '',
  ).trim() || null;
  const pickupMode = String(tariff.pickupMode || tariff.pickupType || '').toLowerCase() || null;
  const deliveryMode = String(tariff.deliveryMode || tariff.deliveryType || '').toLowerCase() || null;
  const sizeKey = String(parcel.boxSize || tariff.boxSize || '').toUpperCase() || null;
  const payerRaw = String(tariff.payer || 'sender').toLowerCase();
  const payer = payerRaw === 'recipient' || payerRaw === 'receiver' ? 'receiver' : 'sender';
  return {
    fromCountry,
    toCountry,
    fromCity,
    toCity,
    pickupMode,
    deliveryMode,
    sizeKey,
    payer,
    fragile: Boolean(parcel.fragile || tariff.fragile),
    insurance: Boolean(parcel.insurance || tariff.insurance),
    weightKg: Number(parcel.weightKg) || null,
  };
}

function buildDailySeries(from, days, orders) {
  const counts = new Map();
  const revenue = new Map();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(from);
    d.setUTCDate(from.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    counts.set(key, 0);
    revenue.set(key, 0);
  }
  for (const o of orders) {
    const key = dayKey(o.createdAt);
    if (!key || !counts.has(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (['submitted', 'paid', 'waiting_from_you', 'delivered'].includes(o.status) || o.paidAt) {
      revenue.set(key, (revenue.get(key) || 0) + (Number(o.amount) || 0));
    }
  }
  return [...counts.keys()].map((date) => ({
    date,
    orders: counts.get(date) || 0,
    revenue: Math.round(revenue.get(date) || 0),
  }));
}

const STATUS_ORDER = [
  'pending_payment', 'paid', 'waiting_from_you', 'submitted', 'delivered', 'cancelled',
];

/** Aggregate order breakdowns for a set of orders (period or single day). */
function aggregateOrderBreakdown(orders) {
  const statusCounts = new Map();
  const destCountries = new Map();
  const cityRoutes = new Map();
  const sizes = new Map();
  const pickupModes = new Map();
  const deliveryModes = new Map();
  const modePairs = new Map();
  const payers = new Map();
  const weekdays = new Map();
  const hours = new Map();
  const amounts = [];
  let withTtn = 0;
  let withUser = 0;
  let fragileCount = 0;
  let insuranceCount = 0;
  let paidLike = 0;
  let revenue = 0;
  let cancelled = 0;
  let pendingPayment = 0;

  for (const o of orders) {
    bump(statusCounts, o.status || 'unknown');
    const meta = orderMeta(o);
    if (meta.toCountry) bump(destCountries, meta.toCountry);
    if (meta.fromCity || meta.toCountry) {
      const route = `${meta.fromCity || meta.fromCountry || 'HU'} → ${meta.toCountry || '?'}${meta.toCity ? ` / ${meta.toCity}` : ''}`;
      bump(cityRoutes, route);
    }
    if (meta.sizeKey) bump(sizes, meta.sizeKey);
    if (meta.pickupMode) bump(pickupModes, meta.pickupMode);
    if (meta.deliveryMode) bump(deliveryModes, meta.deliveryMode);
    if (meta.pickupMode || meta.deliveryMode) {
      bump(modePairs, `${meta.pickupMode || '?'} → ${meta.deliveryMode || '?'}`);
    }
    bump(payers, meta.payer === 'receiver' ? 'Получатель' : 'Отправитель');
    const wd = weekdayLabel(o.createdAt);
    if (wd) bump(weekdays, wd);
    const hr = hourBucket(o.createdAt);
    if (hr) bump(hours, hr);

    const amount = Number(o.amount) || 0;
    if (amount > 0) amounts.push(amount);

    if (o.npTtn) withTtn += 1;
    if (o.userId) withUser += 1;
    if (meta.fragile) fragileCount += 1;
    if (meta.insurance) insuranceCount += 1;
    if (o.status === 'cancelled') cancelled += 1;
    if (o.status === 'pending_payment') pendingPayment += 1;
    if (['submitted', 'paid', 'waiting_from_you', 'delivered'].includes(o.status) || o.paidAt) {
      paidLike += 1;
      revenue += amount;
    }
  }

  const byStatus = STATUS_ORDER
    .filter((id) => statusCounts.has(id))
    .map((id) => ({
      name: id,
      count: statusCounts.get(id) || 0,
      pct: pct(statusCounts.get(id) || 0, orders.length),
    }));
  for (const [name, count] of statusCounts.entries()) {
    if (!STATUS_ORDER.includes(name)) {
      byStatus.push({ name, count, pct: pct(count, orders.length) });
    }
  }

  return {
    total: orders.length,
    pendingPayment,
    paidOrSubmitted: paidLike,
    cancelled,
    revenue: Math.round(revenue),
    withTtn,
    withUser,
    guests: orders.length - withUser,
    fragile: fragileCount,
    insurance: insuranceCount,
    conversionPct: pct(paidLike, orders.length),
    avgCheck: amounts.length
      ? Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length)
      : 0,
    medianCheck: Math.round(median(amounts)),
    minCheck: amounts.length ? Math.round(Math.min(...amounts)) : 0,
    maxCheck: amounts.length ? Math.round(Math.max(...amounts)) : 0,
    byStatus,
    topDestCountries: topMap(destCountries, 12),
    topCityRoutes: topMap(cityRoutes, 12),
    topOrderSizes: topMap(sizes, 10),
    topPickupModes: topMap(pickupModes, 8),
    topDeliveryModes: topMap(deliveryModes, 8),
    topModePairs: topMap(modePairs, 10),
    topPayers: topMap(payers, 4),
    byWeekday: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
      .filter((d) => weekdays.has(d))
      .map((name) => ({ name, count: weekdays.get(name) || 0 })),
    byHour: topMap(hours, 24).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function buildAnalyticsReport({ days = 30 } = {}) {
  const { days: periodDays, from } = daysAgoDate(days);
  const [events, allOrders, settings] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { createdAt: { gte: from } },
      select: {
        sessionId: true,
        event: true,
        step: true,
        toCountry: true,
        fromCity: true,
        toCity: true,
        sizeKey: true,
        pickupMode: true,
        deliveryMode: true,
        page: true,
        locale: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    listAllOrders(),
    getSettings(),
  ]);

  const currency = settings.currency || 'HUF';

  // ── Live calculator funnel (new events) ──────────────────────────
  const sessions = new Map();
  const eventLocales = new Map();
  const eventPages = new Map();
  let pageViews = 0;
  for (const e of events) {
    let s = sessions.get(e.sessionId);
    if (!s) {
      s = {
        maxStep: 0,
        payClick: false,
        checkoutOk: false,
        routes: new Map(),
        sizes: new Map(),
        pickupModes: new Map(),
        deliveryModes: new Map(),
        pages: new Map(),
      };
      sessions.set(e.sessionId, s);
    }
    if (e.event === 'calc_step' && e.step) s.maxStep = Math.max(s.maxStep, e.step);
    if (e.event === 'calc_pay_click') s.payClick = true;
    if (e.event === 'calc_checkout_ok') s.checkoutOk = true;
    if (e.toCountry) {
      const route = `${e.fromCity || 'HU'} → ${e.toCountry}${e.toCity ? ` / ${e.toCity}` : ''}`;
      bump(s.routes, route);
    }
    if (e.sizeKey) bump(s.sizes, e.sizeKey);
    if (e.pickupMode) bump(s.pickupModes, e.pickupMode);
    if (e.deliveryMode) bump(s.deliveryModes, e.deliveryMode);
    if (e.event === 'page_view' && e.page) {
      pageViews += 1;
      bump(s.pages, e.page);
      bump(eventPages, e.page);
    }
    if (e.locale) bump(eventLocales, e.locale);
  }

  const sessionList = [...sessions.values()];
  const totalSessions = sessionList.length;
  const funnel = [];
  for (let step = 1; step <= 9; step += 1) {
    const reached = sessionList.filter((s) => s.maxStep >= step).length;
    const prev = step === 1 ? Math.max(totalSessions, reached) : funnel[step - 2].reached;
    const dropOff = prev > 0 ? pct(prev - reached, prev) : 0;
    funnel.push({
      step,
      reached,
      pctOfSessions: pct(reached, totalSessions || 1),
      dropOffPct: dropOff,
    });
  }
  const payClicks = sessionList.filter((s) => s.payClick).length;
  const checkouts = sessionList.filter((s) => s.checkoutOk).length;

  function topFromSessionMaps(key, limit = 10) {
    const agg = new Map();
    for (const s of sessionList) {
      for (const [k, v] of s[key].entries()) bump(agg, k, v);
    }
    return topMap(agg, limit);
  }

  // ── Orders (historical gold) ─────────────────────────────────────
  const recentOrders = allOrders.filter((o) => {
    const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
    return t >= from.getTime();
  });

  const breakdown = aggregateOrderBreakdown(recentOrders);
  const daily = buildDailySeries(from, periodDays, recentOrders);
  const peakDay = [...daily].sort((a, b) => b.orders - a.orders)[0] || null;

  const ordersByDay = new Map();
  for (const o of recentOrders) {
    const key = dayKey(o.createdAt);
    if (!key) continue;
    if (!ordersByDay.has(key)) ordersByDay.set(key, []);
    ordersByDay.get(key).push(o);
  }
  const daySlices = {};
  for (const [date, list] of ordersByDay.entries()) {
    daySlices[date] = aggregateOrderBreakdown(list);
  }

  const unpaidStuck = breakdown.pendingPayment;
  const calcToCheckout = totalSessions ? pct(checkouts, totalSessions) : null;

  let worstDrop = { step: null, drop: 0 };
  for (let i = 1; i < funnel.length; i += 1) {
    const drop = funnel[i - 1].reached - funnel[i].reached;
    if (drop > worstDrop.drop) worstDrop = { step: funnel[i].step, drop };
  }

  const topOrderRoute = breakdown.topCityRoutes[0];
  const topDest = breakdown.topDestCountries[0];

  const insightParts = [];
  if (recentOrders.length) {
    insightParts.push(`За ${periodDays} дн. заказов: ${recentOrders.length}, оплаченных/в работе: ${breakdown.paidOrSubmitted} (${breakdown.conversionPct}%).`);
    insightParts.push(`Выручка ${breakdown.revenue.toLocaleString('ru-RU')} ${currency}, средний чек ~${breakdown.avgCheck.toLocaleString('ru-RU')} ${currency}.`);
    if (topDest) insightParts.push(`Топ страна назначения: ${topDest.name} (${topDest.count}).`);
    if (topOrderRoute) insightParts.push(`Частый маршрут: ${topOrderRoute.name}.`);
    if (unpaidStuck) insightParts.push(`Застряли на оплате: ${unpaidStuck}.`);
  } else {
    insightParts.push('За выбранный период заказов ещё нет.');
  }
  if (totalSessions === 0) {
    insightParts.push('Воронка калькулятора заполнится, когда посетители начнут проходить шаги на сайте.');
  } else {
    insightParts.push(`Сессий калькулятора: ${totalSessions}, checkout: ${checkouts}.`);
    if (worstDrop.step && worstDrop.drop > 0) {
      insightParts.push(`Сильный отвал перед шагом ${worstDrop.step} (−${worstDrop.drop}).`);
    }
  }

  return {
    days: periodDays,
    from: from.toISOString(),
    currency,
    insight: insightParts.join(' '),

    // Live site funnel
    sessions: totalSessions,
    pageViews,
    funnel,
    payClicks,
    checkouts,
    calcConversionPct: calcToCheckout,
    topCalcRoutes: topFromSessionMaps('routes'),
    topCalcSizes: topFromSessionMaps('sizes'),
    topCalcPickupModes: topFromSessionMaps('pickupModes'),
    topCalcDeliveryModes: topFromSessionMaps('deliveryModes'),
    topPages: topMap(eventPages, 10),
    topLocales: topMap(eventLocales, 8),

    // Back-compat aliases
    topRoutes: breakdown.topCityRoutes,
    topSizes: breakdown.topOrderSizes,
    topPickupModes: breakdown.topPickupModes,
    topDeliveryModes: breakdown.topDeliveryModes,

    // Orders deep dive
    orders: {
      total: breakdown.total,
      pendingPayment: breakdown.pendingPayment,
      paidOrSubmitted: breakdown.paidOrSubmitted,
      cancelled: breakdown.cancelled,
      revenue: breakdown.revenue,
      currency,
      withTtn: breakdown.withTtn,
      withUser: breakdown.withUser,
      guests: breakdown.guests,
      fragile: breakdown.fragile,
      insurance: breakdown.insurance,
      conversionPct: breakdown.conversionPct,
      avgCheck: breakdown.avgCheck,
      medianCheck: breakdown.medianCheck,
      minCheck: breakdown.minCheck,
      maxCheck: breakdown.maxCheck,
    },
    byStatus: breakdown.byStatus,
    topDestCountries: breakdown.topDestCountries,
    topCityRoutes: breakdown.topCityRoutes,
    topOrderSizes: breakdown.topOrderSizes,
    topModePairs: breakdown.topModePairs,
    topPayers: breakdown.topPayers,
    byWeekday: breakdown.byWeekday,
    byHour: breakdown.byHour,
    daily,
    peakDay,
    daySlices,
  };
}
