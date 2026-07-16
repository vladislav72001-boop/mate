import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  getSettings,
  saveSettings,
  getPricing,
  savePricing,
  calculateMatePrice,
  DELIVERY_MODES,
  DESTINATIONS,
  WEIGHT_ROWS,
} from './pricing-config.mjs';
import {
  listUsers,
  findById,
  findByEmail,
  createUser,
  publicUser,
  updateUser,
  deleteUser,
  countUsersByType,
  isEmailTaken,
  isLoginTaken,
  normalizeLogin,
  loginFromEmail,
} from './store.mjs';
import {
  listAllOrders,
  findById as findOrderById,
  updateOrder,
  publicOrder,
} from './orders.mjs';
import { resolveCheckoutAmount } from './shipping.mjs';
import { sendPasswordChangedEmail, sendProfileUpdatedEmail } from './mail.mjs';

const ALLOWED_STATUSES = ['pending_payment', 'paid', 'submitted', 'cancelled'];

async function orderPriceBreakdown(order) {
  if (order.priceBreakdown?.log?.length) {
    return {
      breakdown: order.priceBreakdown,
      priceSource: order.priceSource || order.priceBreakdown.source || null,
      recomputed: false,
    };
  }
  if (!order.payload) {
    return { breakdown: null, priceSource: order.priceSource || null, recomputed: false };
  }
  try {
    const pricing = await resolveCheckoutAmount(order.payload);
    return {
      breakdown: pricing.breakdown || null,
      priceSource: pricing.priceSource || null,
      recomputed: true,
    };
  } catch {
    return { breakdown: null, priceSource: order.priceSource || null, recomputed: false };
  }
}

export function createAdminRouter({ authMiddleware, requireAdmin }) {
  const router = Router();

  router.use(authMiddleware);
  router.use(requireAdmin);

  router.get('/dashboard', async (_req, res) => {
    try {
      const [orders, usersAll] = await Promise.all([listAllOrders(), listUsers()]);
      const users = usersAll.filter((u) => u.type !== 'admin');

      const stats = {
        totalOrders: orders.length,
        pendingPayment: orders.filter((o) => o.status === 'pending_payment').length,
        submitted: orders.filter((o) => o.status === 'submitted').length,
        paid: orders.filter((o) => o.status === 'paid' || o.paidAt).length,
        cancelled: orders.filter((o) => o.status === 'cancelled').length,
        users: users.length,
        revenue: orders
          .filter((o) => o.status === 'submitted' || o.status === 'paid' || o.paidAt)
          .reduce((s, o) => s + (Number(o.amount) || 0), 0),
        currency: (await getSettings()).currency,
      };

      const recentOrders = orders.slice(0, 8).map(publicOrder);
      const recentUsers = users
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8)
        .map(publicUser);

      res.json({ stats, recentOrders, recentUsers });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить дашборд' });
    }
  });

  router.get('/orders', async (req, res) => {
    try {
      let orders = await listAllOrders();
      const status = String(req.query.status || '').trim();
      const q = String(req.query.q || '').trim().toLowerCase();
      if (status && status !== 'all') {
        orders = orders.filter((o) => o.status === status);
      }
      if (q) {
        orders = orders.filter((o) => {
          const hay = [
            o.orderNumber,
            o.npTtn,
            o.customerEmail,
            o.senderPhone,
            o.receiverPhone,
            o.payload?.sender?.name,
            o.payload?.receiver?.firstName,
            o.payload?.receiver?.lastName,
          ].join(' ').toLowerCase();
          return hay.includes(q);
        });
      }
      res.json({ orders: orders.map(publicOrder) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить заказы' });
    }
  });

  router.get('/orders/:id', async (req, res) => {
    try {
      const order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      const priced = await orderPriceBreakdown(order);
      const tariff = order.payload?.tariff || {};
      res.json({
        order: {
          ...publicOrder(order),
          payload: order.payload,
          paymentMode: order.paymentMode,
          stripeSessionId: order.stripeSessionId || null,
          npRef: order.npRef,
          npSnapshot: order.npSnapshot,
          userId: order.userId,
          updatedAt: order.updatedAt,
          deliveryMode: tariff.deliveryMode || tariff.deliveryType || priced.breakdown?.deliveryMode || null,
          priceBreakdown: priced.breakdown,
          priceSource: priced.priceSource,
          priceRecomputed: priced.recomputed,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить заказ' });
    }
  });

  router.patch('/orders/:id', async (req, res) => {
    try {
      const order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });

      const patch = {};
      if (req.body.status) {
        if (!ALLOWED_STATUSES.includes(req.body.status)) {
          return res.status(400).json({ error: 'Недопустимый статус' });
        }
        patch.status = req.body.status;
        if (req.body.status === 'cancelled') patch.cancelledAt = new Date().toISOString();
        if (req.body.status === 'submitted' || req.body.status === 'paid') {
          patch.paidAt = order.paidAt || new Date().toISOString();
          patch.cancelledAt = null;
        }
        if (req.body.status === 'pending_payment') {
          patch.paidAt = null;
          patch.cancelledAt = null;
        }
      }
      if (req.body.amount != null && Number.isFinite(Number(req.body.amount))) {
        patch.amount = Number(req.body.amount);
      }
      if (req.body.currency) patch.currency = String(req.body.currency).toUpperCase();
      if (req.body.npTtn !== undefined) patch.npTtn = req.body.npTtn || null;

      const updated = await updateOrder(order.id, patch);
      res.json({ order: publicOrder(updated) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось обновить заказ' });
    }
  });

  router.get('/users', async (_req, res) => {
    try {
      const [usersRaw, orders] = await Promise.all([listUsers(), listAllOrders()]);
      const users = usersRaw
        .map((u) => {
          const userOrders = orders.filter((o) => {
            if (o.userId === u.id) return true;
            if (o.customerEmail === u.email) return true;
            return false;
          });
          const now = new Date();
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
          const monthly = userOrders.filter((o) => {
            if (o.status === 'cancelled' || o.status === 'pending_payment') return false;
            const t = new Date(o.createdAt).getTime();
            return t >= monthStart && t < monthEnd;
          }).length;
          return {
            ...publicUser(u),
            ordersCount: userOrders.length,
            monthlyShipments: monthly,
            lastOrderAt: userOrders[0]?.createdAt || null,
          };
        })
        .sort((a, b) => {
          if (a.type === 'admin' && b.type !== 'admin') return -1;
          if (b.type === 'admin' && a.type !== 'admin') return 1;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
      res.json({ users });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить пользователей' });
    }
  });

  router.post('/users', async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const phone = String(req.body?.phone || '').trim();
      const password = String(req.body?.password || '');
      const type = String(req.body?.type || 'client').trim().toLowerCase();
      const login = normalizeLogin(req.body?.login) || loginFromEmail(email);

      if (name.length < 2) return res.status(400).json({ error: 'Укажите ФИО (минимум 2 символа)' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
      if (phone.length < 6) return res.status(400).json({ error: 'Укажите телефон' });
      if (password.length < 8) return res.status(400).json({ error: 'Пароль не короче 8 символов' });
      if (type !== 'client' && type !== 'admin') {
        return res.status(400).json({ error: 'Тип: client или admin' });
      }
      if (!login || login.length < 2) {
        return res.status(400).json({ error: 'Укажите логин (минимум 2 символа)' });
      }

      const existing = await findByEmail(email);
      if (existing) return res.status(409).json({ error: 'Email уже занят' });

      const passwordHash = await bcrypt.hash(password, 10);
      let user;
      try {
        user = await createUser({ name, email, phone, passwordHash, type, login });
      } catch (err) {
        if (err?.code === 'LOGIN_TAKEN') {
          return res.status(409).json({ error: 'Такой логин уже занят' });
        }
        throw err;
      }
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось создать пользователя' });
    }
  });

  router.get('/users/:id', async (req, res) => {
    try {
      const user = await findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      const orders = (await listAllOrders()).filter((o) => o.userId === user.id || o.customerEmail === user.email);
      res.json({
        user: publicUser(user),
        orders: orders.map(publicOrder),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить пользователя' });
    }
  });

  router.patch('/users/:id', async (req, res) => {
    try {
      const current = await findById(req.params.id);
      if (!current) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }

      const name = String(req.body?.name ?? current.name).trim();
      const email = String(req.body?.email ?? current.email).trim().toLowerCase();
      const phone = String(req.body?.phone ?? current.phone).trim();
      const password = String(req.body?.password || '');
      const login = req.body?.login != null
        ? (normalizeLogin(req.body.login) || loginFromEmail(email))
        : (normalizeLogin(current.login) || loginFromEmail(email));
      let type = current.type || 'client';
      if (req.body?.type != null) {
        type = String(req.body.type).trim().toLowerCase();
        if (type !== 'client' && type !== 'admin') {
          return res.status(400).json({ error: 'Тип: client или admin' });
        }
      }

      if (name.length < 2) return res.status(400).json({ error: 'Укажите ФИО (минимум 2 символа)' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
      if (phone.length < 6) return res.status(400).json({ error: 'Укажите телефон' });
      if (!login || login.length < 2) return res.status(400).json({ error: 'Укажите логин (минимум 2 символа)' });

      if (await isEmailTaken(email, current.id)) {
        return res.status(409).json({ error: 'Email уже занят' });
      }
      if (await isLoginTaken(login, current.id)) {
        return res.status(409).json({ error: 'Такой логин уже занят' });
      }

      if (current.type === 'admin' && type !== 'admin') {
        const adminCount = await countUsersByType('admin');
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Нельзя снять права у последнего админа' });
        }
      }

      const patch = { name, email, phone, login, type };
      if (password) {
        if (password.length < 8) return res.status(400).json({ error: 'Пароль не короче 8 символов' });
        patch.passwordHash = await bcrypt.hash(password, 10);
      }

      const saved = await updateUser(current.id, patch);
      const updated = publicUser(saved);
      const profileChanged = name !== current.name || phone !== current.phone || email !== current.email;
      if (password) {
        sendPasswordChangedEmail(updated).catch((err) => {
          console.error('[mail] admin password changed notify failed:', err);
        });
      } else if (profileChanged) {
        sendProfileUpdatedEmail(updated).catch((err) => {
          console.error('[mail] admin profile updated notify failed:', err);
        });
      }
      res.json({ user: updated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось обновить пользователя' });
    }
  });

  router.delete('/users/:id', async (req, res) => {
    try {
      const target = await findById(req.params.id);
      if (!target) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      if (target.type === 'admin') {
        const adminCount = await countUsersByType('admin');
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Нельзя удалить последнего админа' });
        }
      }
      const removed = await deleteUser(target.id);
      res.json({ ok: true, user: publicUser(removed) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось удалить пользователя' });
    }
  });

  router.get('/settings', async (_req, res) => {
    try {
      res.json({ settings: await getSettings() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить настройки' });
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      if (typeof body.vatEnabled === 'boolean') patch.vatEnabled = body.vatEnabled;
      if (body.vatPercent != null) patch.vatPercent = Math.max(0, Math.min(100, Number(body.vatPercent)));
      if (typeof body.roundingEnabled === 'boolean') patch.roundingEnabled = body.roundingEnabled;
      if (body.roundingStep != null) {
        const step = Number(body.roundingStep);
        if (![10, 100, 1000].includes(step)) {
          return res.status(400).json({ error: 'Округление: 10, 100 или 1000' });
        }
        patch.roundingStep = step;
      }
      if (body.currency) patch.currency = String(body.currency).toUpperCase();
      if (body.fxFromEur && typeof body.fxFromEur === 'object') patch.fxFromEur = body.fxFromEur;
      if (body.fragileFeeEur != null) patch.fragileFeeEur = Number(body.fragileFeeEur);
      if (body.insurancePercent != null) patch.insurancePercent = Number(body.insurancePercent);

      const settings = await saveSettings(patch);
      res.json({ settings });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось сохранить настройки' });
    }
  });

  router.get('/pricing', async (_req, res) => {
    try {
      const pricing = await getPricing();
      res.json({
        pricing,
        meta: { modes: DELIVERY_MODES, destinations: DESTINATIONS, weightRows: WEIGHT_ROWS },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить прайс' });
    }
  });

  router.put('/pricing', async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      if (body.costPrices) patch.costPrices = body.costPrices;
      if (body.weightMarkups) patch.weightMarkups = body.weightMarkups;
      if (body.tiers) patch.tiers = body.tiers;
      const pricing = await savePricing(patch);
      res.json({ pricing });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось сохранить прайс' });
    }
  });

  router.patch('/pricing/cell', async (req, res) => {
    try {
      const { mode, weightKey, dest, value } = req.body || {};
      if (!DELIVERY_MODES.includes(mode)) return res.status(400).json({ error: 'Неверный способ доставки' });
      if (!DESTINATIONS.includes(dest)) return res.status(400).json({ error: 'Неверное направление' });
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) return res.status(400).json({ error: 'Неверная цена' });

      const pricing = await getPricing();
      if (!pricing.costPrices[mode]) pricing.costPrices[mode] = {};
      if (!pricing.costPrices[mode][weightKey]) pricing.costPrices[mode][weightKey] = {};
      pricing.costPrices[mode][weightKey][dest] = Math.round(num);
      const saved = await savePricing({ costPrices: pricing.costPrices });
      res.json({ pricing: saved });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось обновить ячейку' });
    }
  });

  router.post('/pricing/preview', async (req, res) => {
    try {
      const result = await calculateMatePrice({
        toCountry: req.body.toCountry || 'DE',
        weightKg: req.body.weightKg ?? 2,
        deliveryMode: req.body.deliveryMode || 'locker',
        monthlyShipments: req.body.monthlyShipments ?? 1,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось рассчитать' });
    }
  });

  return router;
}

export async function ensureAdminUser({ createUser, findByEmail }) {
  const email = 'admin@matedelivery.com';
  const existing = await findByEmail(email);
  const password = 'vsunr1se';
  const passwordHash = await bcrypt.hash(password, 10);

  if (existing) {
    await updateUser(existing.id, {
      type: 'admin',
      name: existing.name || 'Admin',
      login: existing.login || 'admin',
      phone: existing.phone || '+36 000 000 000',
      passwordHash,
    });
    return;
  }

  await createUser({
    name: 'Admin',
    email,
    login: 'admin',
    phone: '+36 000 000 000',
    passwordHash,
    type: 'admin',
  });
  console.log('[admin] seeded admin@matedelivery.com / vsunr1se (login: admin)');
}
