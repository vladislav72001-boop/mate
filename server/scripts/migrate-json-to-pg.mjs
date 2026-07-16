import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../load-env.mjs';
import { prisma, disconnectDb } from '../db.mjs';
import { ensurePricingDefaults } from '../pricing-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');

async function readJson(name, fallback) {
  try {
    const raw = await readFile(path.join(dataDir, name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log('[migrate] importing JSON → PostgreSQL…');
  await prisma.$connect();

  const usersData = await readJson('users.json', { users: [] });
  const ordersData = await readJson('orders.json', { orders: [] });
  const addressesData = await readJson('addresses.json', { addresses: [] });
  const settingsData = await readJson('settings.json', null);
  const pricingData = await readJson('pricing.json', null);

  let usersOk = 0;
  for (const u of usersData.users || []) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        name: u.name,
        email: String(u.email || '').toLowerCase(),
        login: u.login || null,
        phone: u.phone || '',
        passwordHash: u.passwordHash,
        type: u.type || 'client',
        welcomeDiscountUsed: Boolean(u.welcomeDiscountUsed),
        welcomeDiscountUsedAt: toDate(u.welcomeDiscountUsedAt),
        createdAt: toDate(u.createdAt) || new Date(),
      },
      update: {
        name: u.name,
        email: String(u.email || '').toLowerCase(),
        login: u.login || null,
        phone: u.phone || '',
        passwordHash: u.passwordHash,
        type: u.type || 'client',
        welcomeDiscountUsed: Boolean(u.welcomeDiscountUsed),
        welcomeDiscountUsedAt: toDate(u.welcomeDiscountUsedAt),
      },
    });
    usersOk += 1;
  }
  console.log(`[migrate] users: ${usersOk}`);

  let ordersOk = 0;
  for (const o of ordersData.orders || []) {
    const userExists = o.userId
      ? Boolean(await prisma.user.findUnique({ where: { id: o.userId }, select: { id: true } }))
      : false;

    await prisma.order.upsert({
      where: { id: o.id },
      create: {
        id: o.id,
        orderNumber: o.orderNumber,
        publicToken: o.publicToken,
        userId: userExists ? o.userId : null,
        customerEmail: String(o.customerEmail || '').toLowerCase(),
        senderPhone: o.senderPhone || '',
        receiverPhone: o.receiverPhone || '',
        status: o.status || 'pending_payment',
        amount: Number(o.amount) || 0,
        currency: o.currency || 'EUR',
        payload: o.payload ?? {},
        priceBreakdown: o.priceBreakdown ?? null,
        priceSource: o.priceSource ?? null,
        npRef: o.npRef ?? null,
        npTtn: o.npTtn ?? null,
        npSnapshot: o.npSnapshot ?? null,
        paymentMode: o.paymentMode || 'mock',
        stripeSessionId: o.stripeSessionId ?? null,
        createdAt: toDate(o.createdAt) || new Date(),
        updatedAt: toDate(o.updatedAt) || new Date(),
        paidAt: toDate(o.paidAt),
        cancelledAt: toDate(o.cancelledAt),
      },
      update: {
        orderNumber: o.orderNumber,
        publicToken: o.publicToken,
        userId: userExists ? o.userId : null,
        customerEmail: String(o.customerEmail || '').toLowerCase(),
        senderPhone: o.senderPhone || '',
        receiverPhone: o.receiverPhone || '',
        status: o.status || 'pending_payment',
        amount: Number(o.amount) || 0,
        currency: o.currency || 'EUR',
        payload: o.payload ?? {},
        priceBreakdown: o.priceBreakdown ?? null,
        priceSource: o.priceSource ?? null,
        npRef: o.npRef ?? null,
        npTtn: o.npTtn ?? null,
        npSnapshot: o.npSnapshot ?? null,
        paymentMode: o.paymentMode || 'mock',
        stripeSessionId: o.stripeSessionId ?? null,
        paidAt: toDate(o.paidAt),
        cancelledAt: toDate(o.cancelledAt),
      },
    });
    ordersOk += 1;
  }
  console.log(`[migrate] orders: ${ordersOk}`);

  let addressesOk = 0;
  for (const a of addressesData.addresses || []) {
    const userExists = Boolean(
      await prisma.user.findUnique({ where: { id: a.userId }, select: { id: true } }),
    );
    if (!userExists) continue;
    await prisma.address.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        userId: a.userId,
        label: a.label || 'Адрес',
        name: a.name || '',
        phone: a.phone || '',
        country: a.country || 'HU',
        city: a.city || '',
        street: a.street || '',
        postal: a.postal || '',
        isDefault: Boolean(a.isDefault),
        createdAt: toDate(a.createdAt) || new Date(),
      },
      update: {
        label: a.label || 'Адрес',
        name: a.name || '',
        phone: a.phone || '',
        country: a.country || 'HU',
        city: a.city || '',
        street: a.street || '',
        postal: a.postal || '',
        isDefault: Boolean(a.isDefault),
      },
    });
    addressesOk += 1;
  }
  console.log(`[migrate] addresses: ${addressesOk}`);

  await ensurePricingDefaults();

  if (settingsData) {
    await prisma.appSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        vatEnabled: settingsData.vatEnabled ?? true,
        vatPercent: settingsData.vatPercent ?? 27,
        roundingEnabled: settingsData.roundingEnabled ?? true,
        roundingStep: settingsData.roundingStep ?? 10,
        currency: settingsData.currency || 'HUF',
        fxFromEur: settingsData.fxFromEur || { EUR: 1, HUF: 400, PLN: 4.3 },
        fragileFeeEur: settingsData.fragileFeeEur ?? 1.98,
        insurancePercent: settingsData.insurancePercent ?? 1,
      },
      update: {
        vatEnabled: settingsData.vatEnabled ?? true,
        vatPercent: settingsData.vatPercent ?? 27,
        roundingEnabled: settingsData.roundingEnabled ?? true,
        roundingStep: settingsData.roundingStep ?? 10,
        currency: settingsData.currency || 'HUF',
        fxFromEur: settingsData.fxFromEur || { EUR: 1, HUF: 400, PLN: 4.3 },
        fragileFeeEur: settingsData.fragileFeeEur ?? 1.98,
        insurancePercent: settingsData.insurancePercent ?? 1,
      },
    });
    console.log('[migrate] settings: ok');
  }

  if (pricingData) {
    await prisma.pricingConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        version: pricingData.version || 1,
        destinations: pricingData.destinations || [],
        weightRows: pricingData.weightRows || [],
        costPrices: pricingData.costPrices || {},
        weightMarkups: pricingData.weightMarkups || [],
        tiers: pricingData.tiers || [],
      },
      update: {
        version: pricingData.version || 1,
        destinations: pricingData.destinations || [],
        weightRows: pricingData.weightRows || [],
        costPrices: pricingData.costPrices || {},
        weightMarkups: pricingData.weightMarkups || [],
        tiers: pricingData.tiers || [],
      },
    });
    console.log('[migrate] pricing: ok');
  }

  console.log('[migrate] done');
}

main()
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
