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

export async function buildAnalyticsReport({ days = 30 } = {}) {
  const { days: periodDays, from } = daysAgoDate(days);
  const events = await prisma.analyticsEvent.findMany({
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
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const sessions = new Map();
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
    if (e.event === 'calc_step' && e.step) {
      s.maxStep = Math.max(s.maxStep, e.step);
    }
    if (e.event === 'calc_pay_click') s.payClick = true;
    if (e.event === 'calc_checkout_ok') s.checkoutOk = true;
    if (e.toCountry) {
      const route = `${e.fromCity || 'HU'}→${e.toCountry}${e.toCity ? `/${e.toCity}` : ''}`;
      s.routes.set(route, (s.routes.get(route) || 0) + 1);
    }
    if (e.sizeKey) s.sizes.set(e.sizeKey, (s.sizes.get(e.sizeKey) || 0) + 1);
    if (e.pickupMode) s.pickupModes.set(e.pickupMode, (s.pickupModes.get(e.pickupMode) || 0) + 1);
    if (e.deliveryMode) s.deliveryModes.set(e.deliveryMode, (s.deliveryModes.get(e.deliveryMode) || 0) + 1);
    if (e.event === 'page_view' && e.page) s.pages.set(e.page, (s.pages.get(e.page) || 0) + 1);
  }

  const sessionList = [...sessions.values()];
  const totalSessions = sessionList.length;
  const funnel = [];
  for (let step = 1; step <= 9; step += 1) {
    const reached = sessionList.filter((s) => s.maxStep >= step).length;
    const prev = step === 1 ? totalSessions : funnel[step - 2].reached;
    const dropOff = prev > 0 ? Math.round(((prev - reached) / prev) * 1000) / 10 : 0;
    funnel.push({
      step,
      reached,
      pctOfSessions: totalSessions ? Math.round((reached / totalSessions) * 1000) / 10 : 0,
      dropOffPct: dropOff,
    });
  }

  const payClicks = sessionList.filter((s) => s.payClick).length;
  const checkouts = sessionList.filter((s) => s.checkoutOk).length;

  function topFromSessionMaps(key, limit = 8) {
    const agg = new Map();
    for (const s of sessionList) {
      for (const [k, v] of s[key].entries()) {
        agg.set(k, (agg.get(k) || 0) + v);
      }
    }
    return [...agg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  // Drop-off insight: first step with largest absolute drop from previous
  let worstDrop = { step: null, drop: 0 };
  for (let i = 1; i < funnel.length; i += 1) {
    const drop = funnel[i - 1].reached - funnel[i].reached;
    if (drop > worstDrop.drop) worstDrop = { step: funnel[i].step, drop };
  }

  const orders = await listAllOrders();
  const recentOrders = orders.filter((o) => {
    const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
    return t >= from.getTime();
  });
  const settings = await getSettings();
  const orderStats = {
    total: recentOrders.length,
    pendingPayment: recentOrders.filter((o) => o.status === 'pending_payment').length,
    paidOrSubmitted: recentOrders.filter((o) => (
      ['paid', 'submitted', 'waiting_from_you', 'delivered'].includes(o.status) || o.paidAt
    )).length,
    cancelled: recentOrders.filter((o) => o.status === 'cancelled').length,
    revenue: recentOrders
      .filter((o) => ['submitted', 'paid', 'waiting_from_you', 'delivered'].includes(o.status) || o.paidAt)
      .reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
    currency: settings.currency || 'HUF',
  };

  const insightParts = [];
  if (totalSessions === 0) {
    insightParts.push('Пока нет сессий калькулятора за выбранный период.');
  } else {
    insightParts.push(`Сессий калькулятора: ${totalSessions}.`);
    if (worstDrop.step && worstDrop.drop > 0) {
      insightParts.push(
        `Самый большой отвал — перед шагом ${worstDrop.step} (−${worstDrop.drop} сессий).`,
      );
    }
    const topRoute = topFromSessionMaps('routes', 1)[0];
    if (topRoute) {
      insightParts.push(`Чаще всего смотрят маршрут ${topRoute.name} (${topRoute.count}).`);
    }
    insightParts.push(`Кликов «Оплатить»: ${payClicks}, успешных checkout: ${checkouts}.`);
  }

  return {
    days: periodDays,
    from: from.toISOString(),
    sessions: totalSessions,
    funnel,
    payClicks,
    checkouts,
    topRoutes: topFromSessionMaps('routes'),
    topSizes: topFromSessionMaps('sizes'),
    topPickupModes: topFromSessionMaps('pickupModes'),
    topDeliveryModes: topFromSessionMaps('deliveryModes'),
    topPages: topFromSessionMaps('pages'),
    orders: orderStats,
    insight: insightParts.join(' '),
  };
}
