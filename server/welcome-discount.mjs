import { findOrdersForUser } from './orders.mjs';
import { findById, markWelcomeDiscountUsed as storeMarkUsed } from './store.mjs';
import { isCountedShipment } from './loyalty.mjs';

export const WELCOME_DISCOUNT_PERCENT = 35;

export async function isWelcomeDiscountEligible(user) {
  if (!user || user.type !== 'client') return false;
  if (user.welcomeDiscountUsed === true) return false;

  const orders = await findOrdersForUser(user);
  const hasCompleted = orders.some((o) => isCountedShipment(o));
  return !hasCompleted;
}

export async function resolveWelcomeDiscountPercent(userId) {
  if (!userId) return 0;
  const user = await findById(userId);
  if (!(await isWelcomeDiscountEligible(user))) return 0;
  return WELCOME_DISCOUNT_PERCENT;
}

export async function getWelcomeDiscountStatus(user) {
  const eligible = await isWelcomeDiscountEligible(user);
  return {
    available: eligible,
    percent: eligible ? WELCOME_DISCOUNT_PERCENT : 0,
  };
}

export async function consumeWelcomeDiscount(userId) {
  if (!userId) return false;
  const user = await findById(userId);
  if (!(await isWelcomeDiscountEligible(user))) return false;
  return storeMarkUsed(userId);
}
