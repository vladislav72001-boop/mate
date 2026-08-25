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
import { buildAnalyticsReport } from './analytics.mjs';
import { resolveCheckoutAmount, syncOrderStatusFromNovaPost } from './shipping.mjs';
import {
  createCourierPickupForShipment,
  hasFinalizedCourierPickup,
  orderNeedsCourierPickup,
} from './novapost/pickup.mjs';
import { createInternationalShipment, deleteInternationalShipment } from './novapost/shipment.mjs';
import { sendPasswordChangedEmail, sendProfileUpdatedEmail, sendOrderStatusEmail, sendOrderTrackingEmail, sendArrivedAtPointEmail } from './mail.mjs';
import { localeFromRequest } from './mail-i18n.mjs';

const ALLOWED_STATUSES = [
  'pending_payment',
  'paid',
  'waiting_from_you',
  'submitted',
  'delivered',
  'cancelled',
];

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

      // Keep dashboard "recent orders" in sync with Nova Post (same as /orders list).
      const recentRaw = orders.slice(0, 8);
      const syncable = recentRaw.filter((o) => o.npRef && !String(o.npRef).startsWith('mock-')
        && ['waiting_from_you', 'submitted', 'paid'].includes(o.status));
      const syncedById = new Map();
      await Promise.all(
        syncable.map(async (o) => {
          const full = await findOrderById(o.id);
          if (!full) return;
          const updated = await syncOrderStatusFromNovaPost(full);
          syncedById.set(o.id, publicOrder(updated));
        }),
      );
      const recentOrders = recentRaw.map((o) => syncedById.get(o.id) || publicOrder(o));

      // Recompute status counts after sync so cards match the list below.
      const statusById = new Map(recentOrders.map((o) => [o.id, o.status]));
      const ordersForStats = orders.map((o) => (
        statusById.has(o.id) ? { ...o, status: statusById.get(o.id) } : o
      ));

      const stats = {
        totalOrders: ordersForStats.length,
        pendingPayment: ordersForStats.filter((o) => o.status === 'pending_payment').length,
        waitingFromYou: ordersForStats.filter((o) => o.status === 'waiting_from_you').length,
        submitted: ordersForStats.filter((o) => o.status === 'submitted').length,
        delivered: ordersForStats.filter((o) => o.status === 'delivered').length,
        paid: ordersForStats.filter((o) => o.status === 'paid' || o.paidAt).length,
        cancelled: ordersForStats.filter((o) => o.status === 'cancelled').length,
        users: users.length,
        revenue: ordersForStats
          .filter((o) => ['submitted', 'paid', 'waiting_from_you', 'delivered'].includes(o.status) || o.paidAt)
          .reduce((s, o) => s + (Number(o.amount) || 0), 0),
        currency: (await getSettings()).currency,
      };

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

  router.get('/analytics', async (req, res) => {
    try {
      const days = Number(req.query.days) || 30;
      const report = await buildAnalyticsReport({ days });
      res.json(report);
    } catch (err) {
      console.error('[admin] analytics:', err);
      res.status(500).json({ error: 'Не удалось загрузить аналитику' });
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
      // Refresh NP statuses for active shipments so admin labels stay accurate.
      const syncable = orders.filter((o) => o.npRef && !String(o.npRef).startsWith('mock-')
        && ['waiting_from_you', 'submitted', 'paid'].includes(o.status));
      const syncedById = new Map();
      await Promise.all(
        syncable.slice(0, 40).map(async (o) => {
          const full = await findOrderById(o.id);
          if (!full) return;
          const updated = await syncOrderStatusFromNovaPost(full);
          syncedById.set(o.id, publicOrder(updated));
        }),
      );
      res.json({
        orders: orders.map((o) => syncedById.get(o.id) || publicOrder(o)),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Не удалось загрузить заказы' });
    }
  });

  router.get('/orders/:id', async (req, res) => {
    try {
      let order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (order.npRef && !String(order.npRef).startsWith('mock-')) {
        order = await syncOrderStatusFromNovaPost(order);
      }
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
        if (
          req.body.status === 'submitted'
          || req.body.status === 'paid'
          || req.body.status === 'waiting_from_you'
          || req.body.status === 'delivered'
        ) {
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

      // Admin cancel must also remove the live Nova Post shipment (ReadyToShip etc.).
      if (patch.status === 'cancelled' && order.npRef && !String(order.npRef).startsWith('mock-')) {
        try {
          await deleteInternationalShipment(order.npRef);
          patch.npRef = null;
          patch.npTtn = null;
          const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
            ? { ...order.npSnapshot }
            : {};
          patch.npSnapshot = {
            ...snap,
            cancelledInNovaPostAt: new Date().toISOString(),
            cancelledNpRef: order.npRef,
            cancelledNpTtn: order.npTtn || null,
          };
        } catch (npErr) {
          console.error('[admin] NP cancel failed:', npErr?.message || npErr);
          return res.status(502).json({
            error: 'Не удалось отменить отправление в Nova Post. Заказ в Mate не изменён — попробуйте ещё раз.',
          });
        }
      }

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
        sendPasswordChangedEmail(updated, { locale: localeFromRequest(req) }).catch((err) => {
          console.error('[mail] admin password changed notify failed:', err);
        });
      } else if (profileChanged) {
        sendProfileUpdatedEmail(updated, { locale: localeFromRequest(req) }).catch((err) => {
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

  router.post('/orders/:id/retry-np', async (req, res) => {
    try {
      const order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (!order.paidAt && order.status === 'pending_payment') {
        return res.status(400).json({ error: 'Заказ ещё не оплачен' });
      }
      if (order.npRef && order.npTtn && !String(order.npRef).startsWith('mock-')) {
        return res.json({ ok: true, already: true, order: publicOrder(order) });
      }

      const body = order.payload || {};
      const shipment = await createInternationalShipment(body, order.orderNumber);
      if (!shipment.npRef) {
        return res.status(502).json({ error: 'Nova Post не вернул id отправления' });
      }

      let snapshot = { ...shipment.snapshot };
      if (orderNeedsCourierPickup(body)) {
        try {
          const pickup = await createCourierPickupForShipment(
            { ...body, clientOrder: order.orderNumber },
            shipment,
          );
          snapshot = { ...snapshot, pickup, pickupError: null };
        } catch (pickupErr) {
          const msg = pickupErr instanceof Error ? pickupErr.message : String(pickupErr);
          const failed = await updateOrder(order.id, {
            status: 'paid',
            npRef: shipment.npRef,
            npTtn: shipment.npTtn,
            npSnapshot: { ...snapshot, pickupError: { error: msg, at: new Date().toISOString() } },
          });
          return res.status(502).json({ error: msg, code: 'NP_PICKUP_FAILED', order: publicOrder(failed) });
        }
      }

      const previousStatus = order.status;
      const updated = await updateOrder(order.id, {
        status: 'waiting_from_you',
        npRef: shipment.npRef,
        npTtn: shipment.npTtn,
        npSnapshot: snapshot,
        paidAt: order.paidAt || new Date().toISOString(),
      });
      // Trigger drop-off instructions if we were stuck on paid after NP failure.
      if (previousStatus !== 'waiting_from_you' && updated) {
        await sendOrderStatusEmail(updated, previousStatus).catch((err) => {
          console.error('[admin] retry-np waiting mail failed:', err?.message || err);
        });
      }
      res.json({ ok: true, order: publicOrder(updated), npTtn: shipment.npTtn });
    } catch (err) {
      console.error('[admin] retry-np:', err);
      res.status(502).json({ error: err?.message || 'Не удалось создать отправление в Nova Post' });
    }
  });

  router.post('/orders/:id/resend-tracking', async (req, res) => {
    try {
      const order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (!order.npTtn) {
        return res.status(400).json({ error: 'У заказа ещё нет ТТН Nova Post' });
      }
      const result = await sendOrderTrackingEmail(order);
      res.json({
        ok: true,
        orderNumber: order.orderNumber,
        npTtn: order.npTtn,
        skipped: Boolean(result?.skipped),
        messageId: result?.messageId || null,
      });
    } catch (err) {
      console.error('[admin] resend tracking:', err);
      res.status(500).json({ error: err?.message || 'Не удалось отправить письмо' });
    }
  });

  router.post('/orders/:id/resend-arrived', async (req, res) => {
    try {
      const order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      const mode = String(
        order.payload?.tariff?.deliveryMode || order.payload?.tariff?.deliveryType || '',
      ).toLowerCase();
      if (!['locker', 'pudo', 'branch'].includes(mode)) {
        return res.status(400).json({ error: 'Письмо доступно только для доставки в постамат / PUDO / филиал' });
      }
      const result = await sendArrivedAtPointEmail(order);
      const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
        ? { ...order.npSnapshot }
        : {};
      await updateOrder(order.id, {
        npSnapshot: {
          ...snap,
          arrivedAtPointMailSentAt: new Date().toISOString(),
          arrivedAtPointNpStatus: snap.arrivedAtPointNpStatus || 'manual_resend',
        },
      }, { notify: false });
      res.json({
        ok: true,
        orderNumber: order.orderNumber,
        npTtn: order.npTtn,
        skipped: Boolean(result?.skipped),
        messageId: result?.messageId || null,
      });
    } catch (err) {
      console.error('[admin] resend arrived:', err);
      res.status(500).json({ error: err?.message || 'Не удалось отправить письмо' });
    }
  });

  router.post('/orders/:id/resend-waiting', async (req, res) => {
    try {
      const order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      const result = await sendOrderStatusEmail(
        { ...order, status: 'waiting_from_you' },
        order.status === 'waiting_from_you' ? 'paid' : order.status,
      );
      res.json({
        ok: true,
        orderNumber: order.orderNumber,
        skipped: Boolean(result?.skipped),
        messageId: result?.messageId || null,
      });
    } catch (err) {
      console.error('[admin] resend waiting:', err);
      res.status(500).json({ error: err?.message || 'Не удалось отправить письмо' });
    }
  });

  /** Create / finalize Nova Post courier pickup for home/address orders missing it. */
  router.post('/orders/:id/ensure-courier-pickup', async (req, res) => {
    try {
      const order = await findOrderById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (!orderNeedsCourierPickup(order)) {
        return res.status(400).json({ error: 'Заказ не с адресным забором курьером' });
      }
      if (!order.npRef || !order.npTtn || String(order.npRef).startsWith('mock-')) {
        return res.status(400).json({ error: 'Сначала нужно создать shipment (TTN) в Nova Post' });
      }
      if (hasFinalizedCourierPickup(order) && !req.body?.force) {
        return res.json({
          ok: true,
          already: true,
          pickup: order.npSnapshot?.pickup || null,
          order: publicOrder(order),
        });
      }

      const pickup = await createCourierPickupForShipment(
        { ...(order.payload || {}), clientOrder: order.orderNumber },
        { npRef: order.npRef, npTtn: order.npTtn },
      );
      const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
        ? { ...order.npSnapshot }
        : {};
      const updated = await updateOrder(order.id, {
        status: order.status === 'paid' ? 'waiting_from_you' : order.status,
        npSnapshot: { ...snap, pickup, pickupError: null },
      });
      res.json({
        ok: true,
        pickup,
        order: publicOrder(updated),
      });
    } catch (err) {
      console.error('[admin] ensure-courier-pickup:', err);
      res.status(502).json({ error: err?.message || 'Не удалось создать пикап в Nova Post' });
    }
  });

  /** Send the 3 waiting_from_you mockup emails (courier / branch / locker) to a mailbox. */
  router.post('/mail/preview-waiting', async (req, res) => {
    try {
      const to = String(req.body?.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({ error: 'Укажите корректный email' });
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const pickupDate = tomorrow.toISOString().slice(0, 10);
      const basePayload = {
        sender: {
          name: 'Bohdan Rushchak',
          phone: '+36 20 445 2212',
          country: 'HU',
          line: 'Budapest, Váci út 50, 1134',
        },
        receiver: {
          firstName: 'Bohdan',
          lastName: 'Pashchak',
          country: 'SK',
          destinationLine: 'Bratislava, Farského 12',
          phone: '+421 905 111 222',
        },
        parcel: {
          boxSize: 'S',
          weightKg: 5,
          declaredValue: 100,
          description: 'Одежда',
        },
        cardLast4: '2729',
      };
      const baseOrder = {
        orderNumber: 'MD-B2C-PREVIEW',
        publicToken: 'preview-token',
        customerEmail: to,
        amount: 4040,
        currency: 'HUF',
        status: 'waiting_from_you',
        npTtn: 'SHHU0465193482',
      };

      const locales = req.body?.allLocales
        ? ['ru', 'en', 'hu', 'uk']
        : [String(req.body?.locale || 'ru').toLowerCase().slice(0, 2)].map((v) => (
          v === 'ua' ? 'uk' : ['ru', 'en', 'hu', 'uk'].includes(v) ? v : 'ru'
        ));

      const samples = [
        {
          id: 'preview-courier',
          payload: {
            ...basePayload,
            tariff: {
              fromCountry: 'HU',
              toCountry: 'SK',
              pickupType: 'home',
              pickupMode: 'address',
              deliveryType: 'locker',
              pickupDate,
              pickupTime: '10:00-11:30',
              pickupLocation: {
                kind: 'address',
                countryCode: 'HU',
                addressParts: {
                  city: 'Budapest',
                  street: 'Váci út',
                  building: '50',
                  postCode: '1134',
                },
              },
            },
          },
        },
        {
          id: 'preview-branch',
          payload: {
            ...basePayload,
            tariff: {
              fromCountry: 'HU',
              toCountry: 'SK',
              pickupType: 'branch',
              pickupMode: 'branch',
              deliveryType: 'locker',
              pickupDate,
              pickupTime: '10:00-11:30',
              pickupLocation: {
                kind: 'division',
                countryCode: 'HU',
                divisionId: 12,
                provider: 'Отделение MATE №12 · Petržalka',
                address: 'Bratislava, Farského 85108',
                phone: '+421 2 445 15 12',
                name: 'Отделение MATE №12',
              },
            },
          },
        },
        {
          id: 'preview-locker',
          payload: {
            ...basePayload,
            lockerCode: '418273',
            tariff: {
              fromCountry: 'HU',
              toCountry: 'SK',
              pickupType: 'locker',
              pickupMode: 'locker',
              deliveryType: 'locker',
              pickupDate,
              pickupTime: '10:00-11:30',
              pickupLocation: {
                kind: 'division',
                countryCode: 'SK',
                divisionId: 357025,
                provider: 'Постамат SPS №357025',
                address: 'Bratislava-Petržalka, Panónska 35/12a',
                name: 'Постамат SPS №357025',
              },
            },
          },
        },
      ];

      const results = [];
      for (const locale of locales) {
        for (const sample of samples) {
          const result = await sendOrderStatusEmail({
            ...baseOrder,
            id: `${sample.id}-${locale}`,
            payload: { ...sample.payload, locale },
          }, 'paid');
          results.push({
            id: `${sample.id}-${locale}`,
            locale,
            skipped: Boolean(result?.skipped),
            messageId: result?.messageId || null,
            provider: result?.provider || null,
            preview: result?.preview || null,
          });
        }
      }

      res.json({ ok: true, to, locales, results });
    } catch (err) {
      console.error('[admin] preview-waiting mail:', err);
      res.status(500).json({ error: err?.message || 'Не удалось отправить превью писем' });
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

  router.get('/promos', async (_req, res) => {
    try {
      const { listPromoCodes } = await import('./promo-codes.mjs');
      res.json({ promos: await listPromoCodes() });
    } catch (err) {
      console.error('[admin] list promos:', err);
      res.status(500).json({ error: err?.message || 'Не удалось загрузить промокоды' });
    }
  });

  router.post('/promos', async (req, res) => {
    try {
      const { createPromoCode } = await import('./promo-codes.mjs');
      const promo = await createPromoCode(req.body || {});
      res.status(201).json({ promo });
    } catch (err) {
      console.error('[admin] create promo:', err);
      res.status(400).json({ error: err?.message || 'Не удалось создать промокод' });
    }
  });

  router.patch('/promos/:id', async (req, res) => {
    try {
      const { setPromoCodeActive } = await import('./promo-codes.mjs');
      if (typeof req.body?.active !== 'boolean') {
        return res.status(400).json({ error: 'Укажите active: true/false' });
      }
      const promo = await setPromoCodeActive(req.params.id, req.body.active);
      res.json({ promo });
    } catch (err) {
      console.error('[admin] patch promo:', err);
      res.status(400).json({ error: err?.message || 'Не удалось обновить промокод' });
    }
  });

  router.delete('/promos/:id', async (req, res) => {
    try {
      const { deletePromoCode } = await import('./promo-codes.mjs');
      await deletePromoCode(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      console.error('[admin] delete promo:', err);
      res.status(400).json({ error: err?.message || 'Не удалось удалить промокод' });
    }
  });

  // Ops: verify NP create with contract/TIN without touching real orders. Deletes shipment after success.
  router.post('/novapost/probe-shipment', async (req, res) => {
    try {
      const {
        getNovaPostJwt,
        novaPostFetchJson,
        novaPostAuthHeader,
      } = await import('./novapost/client.mjs');

      const payerType = String(req.body?.payerType || 'Sender').trim() || 'Sender';
      const contractRaw = req.body?.payerContractNumber;
      const contract = contractRaw === null || contractRaw === ''
        ? null
        : String(contractRaw || process.env.NOVAPOST_PAYER_CONTRACT_NUMBER || '').trim() || null;
      const tinRaw = String(req.body?.companyTin ?? process.env.NOVAPOST_COMPANY_TIN ?? '32834374243');
      const tin = tinRaw.replace(/\D/g, '') || null;
      const withTin = req.body?.withTin !== false && Boolean(contract || req.body?.withTin) && Boolean(tin);
      const companyName = String(req.body?.companyName || '').trim() || null;
      const keep = Boolean(req.body?.keep);
      const clientOrder = String(req.body?.clientOrder || `MD-PROBE-${Date.now().toString(36).toUpperCase()}`).slice(0, 50);
      const note = String(req.body?.note || (keep ? `Mate B2C ${clientOrder}` : 'Mate admin NP probe')).slice(0, 255);

      const senderBody = req.body?.sender && typeof req.body.sender === 'object' ? req.body.sender : null;
      const recipientBody = req.body?.recipient && typeof req.body.recipient === 'object' ? req.body.recipient : null;
      const parcelBody = req.body?.parcel && typeof req.body.parcel === 'object' ? req.body.parcel : null;

      const sender = senderBody || {
        countryCode: 'HU',
        name: companyName || 'Mate Probe',
        phone: '+36704135566',
        email: 'info@matedelivery.com',
        addressParts: {
          city: 'Budapest',
          street: 'Karinthy Frigyes út',
          building: '7',
          postCode: '1117',
        },
      };
      if (withTin) sender.companyTin = tin;
      if (companyName) sender.companyName = companyName;

      const payload = {
        status: 'ReadyToShip',
        clientOrder,
        note,
        payerType,
        ...(contract ? { payerContractNumber: contract } : {}),
        parcels: [{
          rowNumber: 1,
          cargoCategory: String(parcelBody?.cargoCategory || 'parcel'),
          parcelDescription: String(parcelBody?.description || parcelBody?.parcelDescription || 'B2C shipment').slice(0, 120),
          insuranceCost: Math.max(1, Number(parcelBody?.insuranceCost ?? parcelBody?.declaredValue ?? 100)),
          length: Number(parcelBody?.length ?? 400),
          width: Number(parcelBody?.width ?? 300),
          height: Number(parcelBody?.height ?? 300),
          actualWeight: Number(parcelBody?.actualWeight ?? 5000),
        }],
        sender,
        recipient: recipientBody || {
          countryCode: 'DE',
          divisionId: 1844740,
          name: 'Olha Zaletska',
          phone: '+4916091470469',
          email: 'malino.olga22@gmail.com',
        },
      };

      const jwt = await getNovaPostJwt();
      try {
        const created = await novaPostFetchJson('/shipments', {
          method: 'POST',
          headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
          body: payload,
        });
        if (created?.id && !keep) {
          await novaPostFetchJson(`/shipments/${created.id}`, {
            method: 'DELETE',
            headers: novaPostAuthHeader(jwt),
          }).catch(() => {});
        }
        return res.json({
          ok: true,
          kept: keep,
          request: payload,
          response: {
            id: created.id,
            number: created.number,
            cost: created.cost,
            status: created.status,
            scheduledDeliveryDate: created.scheduledDeliveryDate ?? null,
          },
        });
      } catch (err) {
        const raw = String(err?.message || err);
        return res.status(422).json({
          ok: false,
          request: {
            payerType,
            payerContractNumber: contract,
            companyTin: withTin ? tin : null,
            companyName,
          },
          error: raw.slice(0, 800),
        });
      }
    } catch (err) {
      console.error('[admin] novapost probe:', err);
      res.status(500).json({ error: String(err?.message || err).slice(0, 500) });
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
