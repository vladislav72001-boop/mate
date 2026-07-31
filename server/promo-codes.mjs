import { prisma } from './db.mjs';

export function normalizePromoCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function mapPromoCode(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: Number(row.value),
    active: Boolean(row.active),
    maxUses: row.maxUses == null ? null : Number(row.maxUses),
    usedCount: Number(row.usedCount) || 0,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    note: row.note || '',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

export async function listPromoCodes() {
  const rows = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(mapPromoCode);
}

export async function createPromoCode(input) {
  const code = normalizePromoCode(input.code);
  if (!code || code.length < 2 || code.length > 32) {
    throw new Error('Код: 2–32 символа');
  }
  const type = String(input.type || '').toLowerCase() === 'fixed' ? 'fixed' : 'percent';
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Укажите положительное значение скидки');
  }
  if (type === 'percent' && value > 100) {
    throw new Error('Процент скидки не больше 100');
  }

  let maxUses = null;
  if (input.maxUses != null && String(input.maxUses).trim() !== '') {
    maxUses = Math.floor(Number(input.maxUses));
    if (!Number.isFinite(maxUses) || maxUses < 1) {
      throw new Error('Лимит использований — целое число ≥ 1 или пусто');
    }
  }

  let expiresAt = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) throw new Error('Некорректная дата окончания');
    expiresAt = d;
  }

  try {
    const row = await prisma.promoCode.create({
      data: {
        code,
        type,
        value,
        active: input.active !== false,
        maxUses,
        expiresAt,
        note: String(input.note || '').slice(0, 200),
      },
    });
    return mapPromoCode(row);
  } catch (err) {
    if (String(err?.code) === 'P2002') {
      throw new Error('Такой промокод уже существует');
    }
    throw err;
  }
}

export async function deletePromoCode(id) {
  await prisma.promoCode.delete({ where: { id: String(id) } });
  return true;
}

export async function setPromoCodeActive(id, active) {
  const row = await prisma.promoCode.update({
    where: { id: String(id) },
    data: { active: Boolean(active) },
  });
  return mapPromoCode(row);
}

/**
 * Validate promo for checkout. Does not consume uses.
 * @returns {{ ok: true, promo } | { ok: false, error: string }}
 */
export async function resolvePromoDiscount(rawCode) {
  const code = normalizePromoCode(rawCode);
  if (!code) return { ok: false, error: 'Введите промокод' };

  const row = await prisma.promoCode.findUnique({ where: { code } });
  if (!row || !row.active) {
    return { ok: false, error: 'Промокод не найден или неактивен' };
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return { ok: false, error: 'Срок действия промокода истёк' };
  }
  if (row.maxUses != null && Number(row.usedCount) >= Number(row.maxUses)) {
    return { ok: false, error: 'Промокод уже использован максимальное число раз' };
  }

  return {
    ok: true,
    promo: {
      id: row.id,
      code: row.code,
      type: row.type === 'fixed' ? 'fixed' : 'percent',
      value: Number(row.value),
    },
  };
}

/** Increment usedCount after successful payment (idempotent per order via breakdown). */
export async function consumePromoCode(promoId) {
  if (!promoId) return;
  try {
    await prisma.promoCode.update({
      where: { id: String(promoId) },
      data: { usedCount: { increment: 1 } },
    });
  } catch (err) {
    console.error('[promo] consume failed:', err?.message || err);
  }
}
