import { randomUUID } from 'node:crypto';
import { prisma, mapUser } from './db.mjs';

export function normalizeLogin(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function loginFromEmail(email) {
  return normalizeLogin(String(email || '').split('@')[0]);
}

export function getUserLogin(user) {
  const explicit = normalizeLogin(user?.login);
  if (explicit) return explicit;
  return loginFromEmail(user?.email);
}

/** @deprecated prefer listUsers / find* — kept for admin routes compatibility */
export async function readUsers() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  return { users: users.map(mapUser) };
}

/** @deprecated prefer updateUser / deleteUser */
export async function writeUsers(data) {
  const incoming = Array.isArray(data?.users) ? data.users : [];
  const existing = await prisma.user.findMany({ select: { id: true } });
  const keep = new Set(incoming.map((u) => u.id).filter(Boolean));

  for (const row of existing) {
    if (!keep.has(row.id)) {
      await prisma.user.delete({ where: { id: row.id } }).catch(() => {});
    }
  }

  for (const u of incoming) {
    const id = u.id || randomUUID();
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        name: u.name,
        email: String(u.email || '').toLowerCase(),
        login: u.login || null,
        phone: u.phone || '',
        passwordHash: u.passwordHash,
        type: u.type || 'client',
        welcomeDiscountUsed: Boolean(u.welcomeDiscountUsed),
        welcomeDiscountUsedAt: u.welcomeDiscountUsedAt ? new Date(u.welcomeDiscountUsedAt) : null,
        createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
      },
      update: {
        name: u.name,
        email: String(u.email || '').toLowerCase(),
        login: u.login || null,
        phone: u.phone || '',
        passwordHash: u.passwordHash,
        type: u.type || 'client',
        welcomeDiscountUsed: Boolean(u.welcomeDiscountUsed),
        welcomeDiscountUsedAt: u.welcomeDiscountUsedAt ? new Date(u.welcomeDiscountUsedAt) : null,
      },
    });
  }
}

export async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  return users.map(mapUser);
}

export async function countUsersByType(type) {
  return prisma.user.count({ where: { type } });
}

export async function findById(id) {
  if (!id) return null;
  return mapUser(await prisma.user.findUnique({ where: { id } }));
}

export async function findByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return mapUser(await prisma.user.findUnique({ where: { email: normalized } }));
}

export async function findByGoogleId(googleId) {
  const id = String(googleId || '').trim();
  if (!id) return null;
  return mapUser(await prisma.user.findUnique({ where: { googleId: id } }));
}

/** Login by email, explicit login, email local-part, or exact name. */
export async function findByIdentifier(raw) {
  const value = normalizeLogin(raw);
  if (!value) return null;

  if (value === 'admin') {
    return findByEmail('admin@matedelivery.com');
  }

  const byEmail = await findByEmail(value);
  if (byEmail) return byEmail;

  const users = await prisma.user.findMany();
  const mapped = users.map(mapUser);

  const byLogin = mapped.find((u) => normalizeLogin(u.login) === value);
  if (byLogin) return byLogin;

  const byLocal = mapped.filter((u) => loginFromEmail(u.email) === value);
  if (byLocal.length === 1) return byLocal[0];

  const byName = mapped.find((u) => normalizeLogin(u.name) === value);
  if (byName) return byName;

  return null;
}

export async function createUser({
  name,
  email,
  phone,
  passwordHash,
  type = 'client',
  login,
  googleId,
  authProvider = 'local',
}) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedLogin = normalizeLogin(login) || loginFromEmail(normalizedEmail);

  if (normalizedLogin) {
    const existing = await prisma.user.findMany();
    const loginTaken = existing.some((u) => getUserLogin(mapUser(u)) === normalizedLogin);
    if (loginTaken) {
      const err = new Error('LOGIN_TAKEN');
      err.code = 'LOGIN_TAKEN';
      throw err;
    }
  }

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      login: normalizedLogin || null,
      phone: phone.trim(),
      passwordHash,
      googleId: googleId || null,
      authProvider: authProvider || 'local',
      type,
      welcomeDiscountUsed: false,
    },
  });
  return mapUser(user);
}

export async function updateUser(id, patch) {
  const data = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.email !== undefined) data.email = String(patch.email).toLowerCase();
  if (patch.login !== undefined) data.login = patch.login || null;
  if (patch.phone !== undefined) data.phone = patch.phone;
  if (patch.passwordHash !== undefined) data.passwordHash = patch.passwordHash;
  if (patch.googleId !== undefined) data.googleId = patch.googleId || null;
  if (patch.authProvider !== undefined) data.authProvider = patch.authProvider;
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.welcomeDiscountUsed !== undefined) data.welcomeDiscountUsed = Boolean(patch.welcomeDiscountUsed);
  if (patch.welcomeDiscountUsedAt !== undefined) {
    data.welcomeDiscountUsedAt = patch.welcomeDiscountUsedAt
      ? new Date(patch.welcomeDiscountUsedAt)
      : null;
  }

  try {
    return mapUser(await prisma.user.update({ where: { id }, data }));
  } catch {
    return null;
  }
}

export async function deleteUser(id) {
  try {
    return mapUser(await prisma.user.delete({ where: { id } }));
  } catch {
    return null;
  }
}

export function publicUser(user) {
  const phone = String(user.phone || '').trim();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    login: getUserLogin(user),
    phone,
    type: user.type,
    createdAt: user.createdAt,
    authProvider: user.authProvider || 'local',
    needsPhone: phone.length < 6,
    welcomeDiscountAvailable: user.type === 'client' && user.welcomeDiscountUsed !== true,
  };
}

export async function markWelcomeDiscountUsed(userId) {
  const user = await findById(userId);
  if (!user) return false;
  if (user.welcomeDiscountUsed) return false;
  await updateUser(userId, {
    welcomeDiscountUsed: true,
    welcomeDiscountUsedAt: new Date().toISOString(),
  });
  return true;
}

export async function isEmailTaken(email, exceptUserId = null) {
  const normalized = String(email || '').trim().toLowerCase();
  const found = await prisma.user.findUnique({ where: { email: normalized } });
  if (!found) return false;
  return found.id !== exceptUserId;
}

export async function isLoginTaken(login, exceptUserId = null) {
  const normalized = normalizeLogin(login);
  if (!normalized) return false;
  const users = await listUsers();
  return users.some((u) => u.id !== exceptUserId && getUserLogin(u) === normalized);
}
