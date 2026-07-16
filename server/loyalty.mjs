import { getPricing, tierForShipments } from './pricing-config.mjs';
import { findOrdersForUser } from './orders.mjs';
import { findById } from './store.mjs';

const COUNTED_STATUSES = new Set(['paid', 'submitted']);

/** Calendar month [start, end) in local time */
export function calendarMonthBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

export function isCountedShipment(order) {
  const status = String(order?.status || '');
  return COUNTED_STATUSES.has(status);
}

export function countShipmentsInRange(orders, start, end) {
  const from = start.getTime();
  const to = end.getTime();
  return (orders || []).filter((o) => {
    if (!isCountedShipment(o)) return false;
    const t = new Date(o.createdAt).getTime();
    return Number.isFinite(t) && t >= from && t < to;
  }).length;
}

export function countCalendarMonthShipments(orders, date = new Date()) {
  const { start, end } = calendarMonthBounds(date);
  return countShipmentsInRange(orders, start, end);
}

export function buildLoyaltyStatus(orders, tiers, date = new Date()) {
  const list = [...(tiers || [])].sort(
    (a, b) => (Number(a.minShipments) || 0) - (Number(b.minShipments) || 0),
  );
  const monthlyShipments = countCalendarMonthShipments(orders, date);
  const tier = tierForShipments(list, monthlyShipments);
  const idx = list.findIndex((t) => t.id === tier.id);
  const nextTier = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  let remainingToNext = null;
  let progressPercent = 100;
  if (nextTier) {
    const target = Number(nextTier.minShipments) || 0;
    remainingToNext = Math.max(0, target - monthlyShipments);
    progressPercent = target > 0
      ? Math.min(100, Math.round((monthlyShipments / target) * 100))
      : 100;
  }

  const { start, end } = calendarMonthBounds(date);
  const monthLabel = start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  return {
    monthlyShipments,
    tier: {
      id: tier.id,
      label: tier.label || tier.id,
      minShipments: tier.minShipments,
      maxShipments: tier.maxShipments ?? null,
      discountPercent: tier.discountPercent,
    },
    nextTier: nextTier
      ? {
          id: nextTier.id,
          label: nextTier.label || nextTier.id,
          minShipments: nextTier.minShipments,
          maxShipments: nextTier.maxShipments ?? null,
          discountPercent: nextTier.discountPercent,
        }
      : null,
    remainingToNext,
    progressPercent,
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      label: monthLabel,
      resetsAt: end.toISOString(),
    },
    tiers: list.map((t) => ({
      id: t.id,
      label: t.label || t.id,
      minShipments: t.minShipments,
      maxShipments: t.maxShipments ?? null,
      discountPercent: t.discountPercent,
    })),
  };
}

export async function getLoyaltyForUser(user) {
  const [orders, pricing] = await Promise.all([
    findOrdersForUser(user),
    getPricing(),
  ]);
  return buildLoyaltyStatus(orders, pricing.tiers);
}

/** Monthly shipment count used for Mate matrix discount (calendar month). */
export async function resolveUserMonthlyShipments(userId) {
  if (!userId) return 1;
  try {
    const user = await findById(userId);
    if (!user) return 1;
    const orders = await findOrdersForUser(user);
    const count = countCalendarMonthShipments(orders);
    return Math.max(1, count);
  } catch {
    return 1;
  }
}
