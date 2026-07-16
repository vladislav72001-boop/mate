import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__matePrisma
  ?? new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__matePrisma = prisma;
}

export function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    login: row.login || undefined,
    phone: row.phone,
    passwordHash: row.passwordHash,
    type: row.type,
    createdAt: toIso(row.createdAt),
    welcomeDiscountUsed: Boolean(row.welcomeDiscountUsed),
    welcomeDiscountUsedAt: toIso(row.welcomeDiscountUsedAt),
  };
}

export function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    publicToken: row.publicToken,
    userId: row.userId ?? null,
    customerEmail: row.customerEmail,
    senderPhone: row.senderPhone || '',
    receiverPhone: row.receiverPhone || '',
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    payload: row.payload ?? {},
    priceBreakdown: row.priceBreakdown ?? null,
    priceSource: row.priceSource ?? null,
    npRef: row.npRef ?? null,
    npTtn: row.npTtn ?? null,
    npSnapshot: row.npSnapshot ?? null,
    paymentMode: row.paymentMode || 'mock',
    stripeSessionId: row.stripeSessionId ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    paidAt: toIso(row.paidAt),
    cancelledAt: toIso(row.cancelledAt),
  };
}

export function mapAddress(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    name: row.name,
    phone: row.phone,
    country: row.country,
    city: row.city,
    street: row.street,
    postal: row.postal,
    isDefault: Boolean(row.isDefault),
    createdAt: toIso(row.createdAt),
  };
}

export async function disconnectDb() {
  await prisma.$disconnect();
}
