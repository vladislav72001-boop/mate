import { randomUUID } from 'node:crypto';
import { prisma, mapAddress } from './db.mjs';

export async function listAddresses(userId) {
  const rows = await prisma.address.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(mapAddress);
}

export async function createAddress(userId, body) {
  const isDefault = Boolean(body.isDefault);
  if (isDefault) {
    await prisma.address.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
  }

  const entry = await prisma.address.create({
    data: {
      id: randomUUID(),
      userId,
      label: String(body.label || 'Адрес').slice(0, 64),
      name: String(body.name || '').slice(0, 128),
      phone: String(body.phone || '').slice(0, 32),
      country: String(body.country || 'HU').slice(0, 2).toUpperCase(),
      city: String(body.city || '').slice(0, 64),
      street: String(body.street || '').slice(0, 128),
      postal: String(body.postal || '').slice(0, 16),
      isDefault,
    },
  });
  return mapAddress(entry);
}

export async function deleteAddress(userId, id) {
  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await prisma.address.delete({ where: { id } });
  return true;
}
