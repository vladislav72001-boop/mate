import { Router } from 'express';
import { calculateBatch, calculateSingle, normalizeCountryCode } from './novapost/calculate.mjs';
import {
  createInternationalShipment,
  deleteInternationalShipment,
  fetchInternationalShipmentStatus,
  mapNovaPostStatusToOrderStatus,
  isArrivedAtPickupPointStatus,
} from './novapost/shipment.mjs';
import {
  createCourierPickupForShipment,
  hasFinalizedCourierPickup,
  orderNeedsCourierPickup,
} from './novapost/pickup.mjs';
import { validateCheckoutBody } from './shipping-validate.mjs';
import { normalizeMailLocale } from './mail-i18n.mjs';
import {
  createOrder,
  findByPublicToken,
  findByTtn,
  findByTrackQuery,
  findOrdersForUser,
  findRecentPendingOrder,
  checkoutPayloadFingerprint,
  isMockNpOrder,
  newOrderNumber,
  orderBelongsToUser,
  publicOrder,
  updateOrder,
} from './orders.mjs';
import { findById } from './store.mjs';
import {
  assertStripeSessionPaid,
  buildStripeReturnUrls,
  createB2CCheckoutSession,
  stripeEnabled,
  getStripeCheckoutPaymentDetails,
  formatStripeCheckoutError,
  assertStripePayableAmount,
} from './stripe.mjs';
import {
  getSettings,
  getPricing,
  finalizeNovaPostClientPrice,
  computeOrderExtras,
  chargeableWeightKg,
} from './pricing-config.mjs';
import { reconcileParcelPrice } from './pricing-reconcile.mjs';
import { countNovaPostCoverage, fetchNovaPostDivisions, mapDivisionToPoint } from './novapost/divisions.mjs';
import { MATE_BRANCHES, FALLBACK_LOCKERS, filterCatalogPoints } from './points-catalog.mjs';
import { isNovaPostMock } from './novapost/client.mjs';
import { resolveUserMonthlyShipments } from './loyalty.mjs';
import { resolveWelcomeDiscountPercent, consumeWelcomeDiscount } from './welcome-discount.mjs';
import { resolvePromoDiscount, consumePromoCode } from './promo-codes.mjs';
import { sendOrderCreatedEmail, sendArrivedAtPointEmail } from './mail.mjs';
import { geocodeAddressSuggestions } from './geocode.mjs';
import { buildWaybillPdf, waybillFilename } from './waybill-pdf.mjs';

function buildSideCoverage({ country, city, npCounts, useFallback }) {
  const mateBranches = filterCatalogPoints(MATE_BRANCHES, country, city);
  const fallbackLockers = filterCatalogPoints(FALLBACK_LOCKERS, country, city);

  // Postomat and PUDO stay separate — mixing them made EU users pick a shop as a "locker".
  let lockerCount = npCounts?.postomat || 0;
  let pudoCount = npCounts?.pudo || 0;
  // Quote/checkout need numeric Nova Post division IDs — catalog mate_*
  // placeholders must not enable branch mode in the UI.
  let branchCount = npCounts?.postBranch || 0;
  let source = npCounts?.source || 'none';

  if (useFallback || source === 'mock' || source === 'error') {
    lockerCount = Math.max(lockerCount, fallbackLockers.length);
    // Mock/offline only: keep catalog branches so local demos still work.
    branchCount = Math.max(branchCount, mateBranches.length);
    source = source === 'novapost' ? source : 'fallback';
  }

  return {
    home: { available: true, count: null },
    locker: { available: lockerCount > 0, count: lockerCount },
    pudo: { available: pudoCount > 0, count: pudoCount },
    branch: { available: branchCount > 0, count: branchCount },
    counts: {
      postomat: npCounts?.postomat || 0,
      pudo: npCounts?.pudo || 0,
      postBranch: npCounts?.postBranch || 0,
      mateBranch: mateBranches.length,
    },
    source,
  };
}

async function sendCheckoutEmail(order, checkoutUrl) {
  if (!order?.customerEmail && !order?.payload?.receiver?.email) return;
  const payUrl = order?.publicToken
    ? `${String(process.env.APP_URL || 'http://localhost:5011').replace(/\/$/, '')}/?pay=${encodeURIComponent(order.publicToken)}`
    : checkoutUrl;
  // Never block Stripe redirect on SMTP
  void sendOrderCreatedEmail(order, { checkoutUrl, payUrl })
    .then(() => {
      console.log(`[mail] checkout email sent (${order.orderNumber}) payer=${order.payload?.tariff?.payer || 'sender'}`);
    })
    .catch((err) => {
      console.error('[mail] checkout email failed:', err);
    });
}

function isRecipientPayer(source) {
  const payer = String(
    source?.payload?.tariff?.payer
    || source?.tariff?.payer
    || '',
  ).toLowerCase();
  return payer === 'receiver' || payer === 'recipient';
}

function stripeCustomerEmailForOrder(order, fallbackEmail = '') {
  if (isRecipientPayer(order)) {
    const receiverEmail = String(order?.payload?.receiver?.email || '').trim().toLowerCase();
    if (receiverEmail) return receiverEmail;
  }
  return String(
    order?.customerEmail
    || order?.payload?.customerEmail
    || fallbackEmail
    || '',
  ).trim().toLowerCase();
}

async function createStripeCheckoutForOrder(order, customerEmail) {
  const email = stripeCustomerEmailForOrder(order, customerEmail);
  const session = await createB2CCheckoutSession({
    order,
    amount: order.amount,
    currency: order.currency,
    customerEmail: email,
  });
  await updateOrder(order.id, {
    stripeSessionId: session.id,
    paymentMode: 'stripe',
  }, { notify: false });
  return session.url;
}

const AMOUNT_TOLERANCE_PERCENT = Number(process.env.B2C_AMOUNT_TOLERANCE_PERCENT ?? 3);

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function mapDeliveryMode(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'branch' || t === 'office') return 'branch';
  if (t === 'home' || t === 'address' || t === 'courier') return 'address';
  // PUDO prices like Postomat in the Mate matrix; NP still quotes the real division.
  if (t === 'pudo' || t === 'locker' || t === 'postomat') return 'locker';
  return 'locker';
}

/** Matrix tier: address > branch > locker — use the higher of pickup and delivery. */
function resolvePricingMode(pickupRaw, deliveryRaw) {
  const rank = { locker: 0, branch: 1, address: 2 };
  const pickup = mapDeliveryMode(pickupRaw);
  const delivery = mapDeliveryMode(deliveryRaw);
  return rank[pickup] >= rank[delivery] ? pickup : delivery;
}

export async function resolveCheckoutAmount(body, userId = null) {
  const parcel = body.parcel || {};
  const tariff = body.tariff || {};
  const settings = await getSettings();
  const toCountry = tariff.toCountry || body.receiver?.country || 'DE';
  const fromCountry = tariff.fromCountry || body.sender?.country || 'HU';
  const weightKg = chargeableWeightKg(
    Number(parcel.weightKg) || 2,
    parcel.lengthCm,
    parcel.widthCm,
    parcel.heightCm,
    parcel.boxSize,
  );
  const deliveryMode = resolvePricingMode(
    tariff.pickupType || tariff.pickupMode || body.pickupMode,
    tariff.deliveryType || tariff.deliveryMode || body.deliveryType,
  );
  const welcomeDiscountPercent = await resolveWelcomeDiscountPercent(userId || body.userId);

  let promo = null;
  const rawPromo = body.promoCode || body.promo?.code || tariff.promoCode;
  if (rawPromo) {
    const resolved = await resolvePromoDiscount(rawPromo);
    if (!resolved.ok) {
      throw new Error(resolved.error || 'Промокод недействителен');
    }
    promo = resolved.promo;
  }

  const reconciled = await reconcileParcelPrice({
    fromCountry,
    toCountry,
    weightKg,
    deliveryMode,
    lengthCm: parcel.lengthCm,
    widthCm: parcel.widthCm,
    heightCm: parcel.heightCm,
    declaredValue: parcel.declaredValue ?? 100,
    boxSize: parcel.boxSize,
    monthlyShipments: Number(body.monthlyShipments) || 1,
    welcomeDiscountPercent,
    promo,
    pickupLocation: tariff.pickupLocation,
    deliveryLocation: tariff.deliveryLocation,
    payerType: tariff.payerType,
  });

  if (reconciled.amount == null) {
    throw new Error('Не удалось рассчитать стоимость');
  }

  let currency = reconciled.currency;
  let total = reconciled.amount;
  let priceSource = reconciled.priceSource || 'estimate';
  let breakdown = reconciled.breakdown || null;

  const log = Array.isArray(breakdown?.log) ? [...breakdown.log] : [];
  if (log.length && String(log[log.length - 1]?.title || '').toLowerCase().includes('итог')) {
    log.pop();
  }

  const extras = computeOrderExtras(total, {
    fragile: Boolean(parcel.fragile),
    insurance: Boolean(parcel.insurance),
  }, settings);

  if (extras.fragileFee) {
    log.push({
      step: log.length + 1,
      title: 'Хрупкое',
      detail: `${settings.fragileFeeEur ?? 1.98} EUR + НДС`,
      value: extras.fragileFee,
    });
  }
  if (extras.insuranceFee) {
    log.push({
      step: log.length + 1,
      title: 'Страховка',
      detail: `${extras.insurancePercent}% от тарифа доставки`,
      value: extras.insuranceFee,
    });
  }
  total = extras.total;
  log.push({
    step: log.length + 1,
    title: 'Итого заказа',
    detail: currency,
    value: total,
  });

  breakdown = {
    ...(breakdown || {}),
    total,
    currency,
    source: priceSource,
    deliveryMode,
    deliveryAmount: extras.base,
    fragileFee: extras.fragileFee,
    insuranceFee: extras.insuranceFee,
    insurancePercent: extras.insurancePercent,
    log,
  };

  // Fail early with a clear message (e.g. 99% promo → 120 HUF < Stripe min 175).
  if (promo) {
    assertStripePayableAmount(total, currency);
  }

  return { total, currency, priceSource, breakdown };
}

async function maybeConsumeWelcomeDiscount(order) {
  if (!order?.userId) return;
  const pct = Number(order.priceBreakdown?.welcomeDiscountPercent) || 0;
  if (pct <= 0) return;
  await consumeWelcomeDiscount(order.userId);
}

async function maybeConsumePromoCode(order) {
  const promoId = order?.priceBreakdown?.promoId;
  if (!promoId) return;
  await consumePromoCode(promoId);
}

const NP_STATUS_CACHE = new Map();
const NP_STATUS_TTL_MS = Number(process.env.NOVAPOST_STATUS_TTL_MS ?? 90_000);
const SYNCABLE_STATUSES = new Set(['waiting_from_you', 'submitted', 'paid']);

function deliveryModeFromOrder(order) {
  const tariff = order?.payload?.tariff || {};
  return String(tariff.deliveryMode || tariff.deliveryType || '').toLowerCase();
}

async function maybeNotifyArrivedAtPoint(order, npStatus) {
  if (!order || !isArrivedAtPickupPointStatus(npStatus)) return order;
  const mode = deliveryModeFromOrder(order);
  if (!['locker', 'pudo', 'branch'].includes(mode)) return order;

  const snap = (order.npSnapshot && typeof order.npSnapshot === 'object')
    ? { ...order.npSnapshot }
    : {};
  if (snap.arrivedAtPointMailSentAt) return order;

  try {
    await sendArrivedAtPointEmail(order);
    return (await updateOrder(order.id, {
      npSnapshot: {
        ...snap,
        arrivedAtPointMailSentAt: new Date().toISOString(),
        arrivedAtPointNpStatus: String(npStatus || ''),
      },
    }, { notify: false })) || order;
  } catch (err) {
    console.error(`[mail] arrived-at-point failed (${order.orderNumber}):`, err?.message || err);
    return order;
  }
}

/** Best-effort refresh of order.status from Nova Post (cached). */
async function syncOrderStatusFromNovaPost(order) {
  if (!order?.npRef || String(order.npRef).startsWith('mock-')) return order;
  if (order.status === 'pending_payment' || order.status === 'cancelled' || order.status === 'delivered') {
    return order;
  }
  if (!SYNCABLE_STATUSES.has(order.status) && order.status !== 'waiting_from_you') {
    return order;
  }

  const cacheKey = String(order.npRef);
  const cached = NP_STATUS_CACHE.get(cacheKey);
  let npStatus = cached?.npStatus || null;
  let current = order;

  if (cached && cached.expiresAt > Date.now()) {
    if (cached.orderStatus && cached.orderStatus !== current.status) {
      current = (await updateOrder(current.id, { status: cached.orderStatus }, { notify: false })) || current;
    }
    return maybeNotifyArrivedAtPoint(current, npStatus);
  }

  try {
    const result = await fetchInternationalShipmentStatus(order.npRef);
    npStatus = result.npStatus;
    NP_STATUS_CACHE.set(cacheKey, {
      orderStatus: result.orderStatus,
      npStatus: result.npStatus,
      expiresAt: Date.now() + Math.max(15_000, NP_STATUS_TTL_MS),
    });
    if (result.orderStatus && result.orderStatus !== current.status) {
      const patch = { status: result.orderStatus };
      if (result.number && !current.npTtn) patch.npTtn = String(result.number);
      current = (await updateOrder(current.id, patch)) || current;
    } else if (result.number && !current.npTtn) {
      current = (await updateOrder(current.id, { npTtn: String(result.number) }, { notify: false })) || current;
    }
    return maybeNotifyArrivedAtPoint(current, npStatus);
  } catch (err) {
    console.warn(`[shipping] NP status sync failed for ${order.orderNumber}:`, err?.message || err);
    NP_STATUS_CACHE.set(cacheKey, {
      orderStatus: null,
      npStatus: null,
      expiresAt: Date.now() + 30_000,
    });
    return current;
  }
}

export function createShippingRouter({ authMiddleware, optionalAuth }) {
  const router = Router();

  /** Coverage for pickup/delivery modes after city selection */
  router.get('/coverage', async (req, res) => {
    try {
      const fromCountry = String(req.query.fromCountry || 'HU').toUpperCase();
      const toCountry = String(req.query.toCountry || '').toUpperCase();
      const fromCity = String(req.query.fromCity || '').trim();
      const toCity = String(req.query.toCity || '').trim();

      if (!toCountry || !fromCity || !toCity) {
        return res.status(400).json({ error: 'Укажите страны и города маршрута' });
      }

      const useFallback = isNovaPostMock();
      const [pickupNp, deliveryNp] = await Promise.all([
        countNovaPostCoverage(fromCountry, fromCity),
        countNovaPostCoverage(toCountry, toCity),
      ]);

      const pickup = buildSideCoverage({
        country: fromCountry,
        city: fromCity,
        npCounts: pickupNp,
        useFallback: useFallback || pickupNp.source !== 'novapost',
      });
      const delivery = buildSideCoverage({
        country: toCountry,
        city: toCity,
        npCounts: deliveryNp,
        useFallback: useFallback || deliveryNp.source !== 'novapost',
      });

      res.json({
        data: {
          pickup,
          delivery,
          route: { fromCountry, fromCity, toCountry, toCity },
        },
      });
    } catch (err) {
      console.error('[shipping] coverage:', err);
      res.status(500).json({ error: 'Не удалось проверить доступность доставки' });
    }
  });

  /** Live points for locker/branch pickers */
  router.get('/points', async (req, res) => {
    try {
      const country = String(req.query.country || '').toUpperCase();
      const city = String(req.query.city || '').trim();
      const kind = String(req.query.kind || 'locker').toLowerCase();
      const side = String(req.query.side || 'delivery').toLowerCase();

      if (!country || !city) {
        return res.status(400).json({ error: 'Укажите страну и город' });
      }
      if (kind !== 'locker' && kind !== 'branch' && kind !== 'pudo') {
        return res.status(400).json({ error: 'kind: locker, pudo или branch' });
      }

      const matchesCity = (it) => {
        const q = city.toLowerCase();
        const settlement = String(it?.settlement?.name || '').toLowerCase();
        return !q
          || settlement === q
          || settlement.includes(q)
          || q.includes(settlement);
      };

      const dedupeById = (list) => {
        const seen = new Set();
        return list.filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
      };

      if (kind === 'branch') {
        // Live Nova Post PostBranch only — mate_* catalog IDs cannot be quoted/checked out.
        let points = [];
        let source = 'novapost';

        if (isNovaPostMock()) {
          points = filterCatalogPoints(MATE_BRANCHES, country, city);
          source = 'mate';
        } else {
          const branches = await fetchNovaPostDivisions({
            countryCode: country,
            city,
            categories: ['PostBranch'],
            limit: 40,
          });
          if (branches.source === 'novapost') {
            // fetchNovaPostDivisions already city-filters; keep items that map to quoteable points.
            points = dedupeById(
              branches.items
                .map(mapDivisionToPoint)
                .filter((p) => p.lat && p.lng && /^\d+$/.test(String(p.id))),
            );
            source = 'novapost';
          } else if (branches.source === 'error' || branches.source === 'mock') {
            points = filterCatalogPoints(MATE_BRANCHES, country, city);
            source = 'mate';
          }
        }

        return res.json({
          data: {
            points: points.slice(0, 60),
            source,
            kind,
            side,
          },
        });
      }

      // locker = Postomat only; pudo = PUDO only (never merge — EU partners are not lockers)
      const npCategory = kind === 'pudo' ? 'PUDO' : 'Postomat';
      let points = [];
      let source = 'novapost';
      if (!isNovaPostMock()) {
        const divisions = await fetchNovaPostDivisions({
          countryCode: country,
          city,
          categories: [npCategory],
          limit: 40,
        });
        points = dedupeById(
          divisions.items
            .filter(matchesCity)
            .map(mapDivisionToPoint)
            .filter((p) => p.lat && p.lng && /^\d+$/.test(String(p.id))),
        );

        if (divisions.source === 'error' || divisions.source === 'mock') {
          source = kind === 'locker' ? 'fallback' : 'novapost';
          if (kind === 'locker') {
            points = filterCatalogPoints(FALLBACK_LOCKERS, country, city);
          }
        } else {
          source = 'novapost';
        }
      } else if (kind === 'locker') {
        source = 'fallback';
        points = filterCatalogPoints(FALLBACK_LOCKERS, country, city);
      }

      res.json({
        data: {
          points: points.slice(0, 60),
          source,
          kind,
          side,
        },
      });
    } catch (err) {
      console.error('[shipping] points:', err);
      res.status(500).json({ error: 'Не удалось загрузить точки' });
    }
  });

  /** Address autocomplete (Photon + Nominatim) */
  router.get('/geocode', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const country = String(req.query.country || '').toUpperCase().replace(/[^A-Z]/g, '');
      const city = String(req.query.city || '').trim();
      const lang = String(req.query.lang || 'en').toLowerCase().slice(0, 2);
      if (q.length < 3) {
        return res.json({ data: { suggestions: [] } });
      }

      const suggestions = await geocodeAddressSuggestions({ q, country, city, lang });
      res.json({ data: { suggestions } });
    } catch (err) {
      console.error('[shipping] geocode:', err);
      res.status(500).json({ error: 'Не удалось найти адрес' });
    }
  });

  /** Public quote settings — keep calculator extras in sync with admin/DB. */
  router.get('/quote-settings', async (_req, res) => {
    try {
      const settings = await getSettings();
      res.json({
        data: {
          currency: settings.currency,
          vatEnabled: settings.vatEnabled,
          vatPercent: settings.vatPercent,
          roundingEnabled: settings.roundingEnabled,
          roundingStep: settings.roundingStep,
          fxFromEur: settings.fxFromEur,
          fragileFeeEur: settings.fragileFeeEur,
          insurancePercent: settings.insurancePercent,
        },
      });
    } catch (err) {
      console.error('[shipping] quote-settings:', err);
      res.status(500).json({ error: 'Не удалось загрузить настройки тарифа' });
    }
  });

  router.post('/calculate-batch', optionalAuth, async (req, res) => {
    try {
      const {
        fromCountry,
        toCountry,
        declaredValue,
        sizes,
        deliveryMode,
        pickupMode,
        pickupLocation,
        deliveryLocation,
        payerType,
      } = req.body;
      if (!fromCountry || !toCountry || !Array.isArray(sizes) || !sizes.length) {
        return res.status(400).json({ error: 'Укажите страны и размеры посылки' });
      }
      const monthlyShipments = Number(req.body.monthlyShipments)
        || await resolveUserMonthlyShipments(req.userId);
      const welcomeDiscountPercent = await resolveWelcomeDiscountPercent(req.userId);
      const result = await calculateBatch({
        fromCountry,
        toCountry,
        declaredValue,
        sizes,
        pickupLocation,
        deliveryLocation,
        payerType,
      });
      const mode = resolvePricingMode(pickupMode, deliveryMode || 'locker');
      const [settings, pricing] = await Promise.all([getSettings(), getPricing()]);

      const quotes = { ...result.quotes };
      let currency = result.currency;
      let priceSource = result.priceSource;
      let usedNova = 0;
      let usedEstimate = 0;

      for (const size of sizes) {
        const key = size.boxSize;
        const raw = quotes[key];
        const npTotal = typeof raw === 'number' ? raw : raw?.total;
        const npCurrency = typeof raw === 'object' && raw?.currency?.code
          ? raw.currency.code
          : result.currency?.code || 'EUR';
        const npSource = typeof raw === 'object' ? raw.priceSource : result.priceSource;
        const weightKg = chargeableWeightKg(
          size.weightKg,
          size.lengthCm,
          size.widthCm,
          size.heightCm,
          size.boxSize,
        );

        // Carrier quote + markup + VAT + rounding. Matrix never participates.
        if (
          npTotal != null
          && Number.isFinite(Number(npTotal))
        ) {
          const source = npSource === 'novapost' ? 'novapost' : 'estimate';
          const finalized = finalizeNovaPostClientPrice({
            npTotal,
            quoteCurrency: npCurrency,
            settings,
            weightMarkups: pricing.weightMarkups,
            tiers: pricing.tiers,
            weightKg,
            monthlyShipments,
            welcomeDiscountPercent,
            source,
            deliveryMode: mode,
            npServices: typeof raw === 'object' ? raw.breakdown : null,
          });
          currency = { code: finalized.currency, symbol: finalized.currency };
          quotes[key] = {
            ...(typeof raw === 'object' && raw ? raw : {}),
            total: finalized.amount,
            currency: finalized.currency,
            priceSource: source,
            breakdown: finalized.breakdown,
          };
          if (source === 'novapost') usedNova += 1;
          else usedEstimate += 1;
          continue;
        }
      }

      if (usedNova) priceSource = 'novapost';
      else if (usedEstimate) priceSource = 'estimate';

      res.json({
        data: {
          ...result,
          quotes,
          currency,
          priceSource,
        },
      });
      if (process.env.PRICING_LOG !== 'false') {
        for (const size of sizes) {
          const q = quotes[size.boxSize];
          if (q && typeof q === 'object' && q.breakdown?.log) {
            console.log(
              `[pricing] ${fromCountry}→${toCountry} ${size.boxSize}/${size.weightKg}kg ${mode}:`,
              q.priceSource,
              q.breakdown.log.map((l) => `${l.title}=${l.value}`).join(' | '),
            );
          }
        }
      }
    } catch (err) {
      console.error('[shipping] calculate-batch:', err);
      res.status(500).json({ error: err.message || 'Не удалось рассчитать стоимость' });
    }
  });

  /** Preview full checkout total with optional promo (fragile/insurance included). */
  router.post('/promo/preview', optionalAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.parcel) {
        return res.status(400).json({ error: 'Укажите параметры посылки' });
      }
      const monthlyShipments = Number(body.monthlyShipments)
        || await resolveUserMonthlyShipments(req.userId);
      const pricing = await resolveCheckoutAmount({ ...body, monthlyShipments }, req.userId);
      res.json({
        data: {
          total: pricing.total,
          currency: pricing.currency,
          priceSource: pricing.priceSource,
          breakdown: pricing.breakdown,
        },
      });
    } catch (err) {
      const msg = err?.message || 'Не удалось применить промокод';
      const bad = /промокод|promo/i.test(msg);
      res.status(bad ? 400 : 500).json({ error: msg });
    }
  });

  /** Final price: Nova Post + markup + VAT — for steps 7–8 and checkout */
  router.post('/calculate-final', optionalAuth, async (req, res) => {
    try {
      const {
        fromCountry,
        toCountry,
        deliveryMode,
        pickupMode,
        declaredValue,
        parcel,
        pickupLocation,
        deliveryLocation,
        payerType,
        promoCode,
      } = req.body;
      if (!toCountry || !parcel) {
        return res.status(400).json({ error: 'Укажите направление и параметры посылки' });
      }
      const monthlyShipments = Number(req.body.monthlyShipments)
        || await resolveUserMonthlyShipments(req.userId);
      const welcomeDiscountPercent = await resolveWelcomeDiscountPercent(req.userId);
      let promo = null;
      if (promoCode) {
        const resolved = await resolvePromoDiscount(promoCode);
        if (!resolved.ok) {
          return res.status(400).json({ error: resolved.error });
        }
        promo = resolved.promo;
      }
      const result = await reconcileParcelPrice({
        fromCountry: fromCountry || 'HU',
        toCountry,
        weightKg: Number(parcel.weightKg) || 2,
        deliveryMode: resolvePricingMode(pickupMode, deliveryMode || 'locker'),
        lengthCm: parcel.lengthCm,
        widthCm: parcel.widthCm,
        heightCm: parcel.heightCm,
        declaredValue: declaredValue ?? parcel.declaredValue ?? 100,
        boxSize: parcel.boxSize,
        monthlyShipments,
        welcomeDiscountPercent,
        promo,
        pickupLocation,
        deliveryLocation,
        payerType,
      });
      if (result.amount == null) {
        return res.status(422).json({ error: 'Не удалось рассчитать стоимость' });
      }
      if (process.env.PRICING_LOG !== 'false' && result.breakdown?.log) {
        console.log(
          `[pricing] reconcile ${fromCountry || 'HU'}→${toCountry} ${parcel.boxSize}/${parcel.weightKg}kg:`,
          result.priceSource,
          result.breakdown.log.map((l) => `${l.title}=${l.value}`).join(' | '),
        );
      }
      res.json({ data: result });
    } catch (err) {
      console.error('[shipping] calculate-final:', err);
      res.status(500).json({ error: err.message || 'Не удалось рассчитать стоимость' });
    }
  });

  router.post('/checkout', optionalAuth, async (req, res) => {
    try {
      const body = req.body;

      const validation = validateCheckoutBody(body);
      if (!validation.ok) {
        return res.status(400).json({
          error: validation.errors[0],
          errors: validation.errors,
        });
      }

      const customerEmail = String(body.customerEmail || '').trim().toLowerCase();
      const clientAmount = Number(body.amount);
      const clientCurrency = String(body.currency || 'EUR').toUpperCase();
      const recipientPays = isRecipientPayer(body);
      const receiverEmail = String(body.receiver?.email || '').trim().toLowerCase();
      if (recipientPays && !receiverEmail) {
        return res.status(400).json({ error: 'Укажите email получателя для оплаты' });
      }

      const fingerprint = checkoutPayloadFingerprint(body);
      const existing = await findRecentPendingOrder(customerEmail, fingerprint);
      if (existing) {
        console.log(`[shipping] reusing pending order ${existing.orderNumber} (duplicate checkout prevented)`);
        // Keep mail language in sync with the UI language of this checkout attempt.
        const nextLocale = normalizeMailLocale(body.locale || body.lang || body.language);
        const prevLocale = normalizeMailLocale(existing.payload?.locale || existing.payload?.lang);
        if (nextLocale !== prevLocale || !existing.payload?.locale) {
          const nextPayload = { ...(existing.payload || {}), locale: nextLocale };
          const refreshed = await updateOrder(existing.id, { payload: nextPayload }, { notify: false });
          if (refreshed) Object.assign(existing, refreshed);
          else existing.payload = nextPayload;
        }
        if (stripeEnabled()) {
          const checkoutUrl = await createStripeCheckoutForOrder(existing, customerEmail);
          if (recipientPays) {
            await sendCheckoutEmail(existing, checkoutUrl);
            return res.json({
              data: {
                awaitingRecipientPayment: true,
                publicToken: existing.publicToken,
                orderNumber: existing.orderNumber,
                amount: existing.amount,
                currency: existing.currency,
                reused: true,
                recipientEmail: existing.payload?.receiver?.email || body.receiver?.email || null,
              },
            });
          }
          return res.json({
            data: {
              checkoutUrl,
              publicToken: existing.publicToken,
              orderNumber: existing.orderNumber,
              amount: existing.amount,
              currency: existing.currency,
              reused: true,
            },
          });
        }
        const { successUrl } = buildStripeReturnUrls(existing.publicToken);
        if (recipientPays) {
          await sendCheckoutEmail(existing, successUrl);
          return res.json({
            data: {
              awaitingRecipientPayment: true,
              mockPayment: true,
              publicToken: existing.publicToken,
              orderNumber: existing.orderNumber,
              amount: existing.amount,
              currency: existing.currency,
              reused: true,
              recipientEmail: existing.payload?.receiver?.email || body.receiver?.email || null,
            },
          });
        }
        return res.json({
          data: {
            checkoutUrl: successUrl,
            mockPayment: true,
            publicToken: existing.publicToken,
            orderNumber: existing.orderNumber,
            amount: existing.amount,
            currency: existing.currency,
            reused: true,
          },
        });
      }

      const orderNumber = newOrderNumber();
      const monthlyShipments = Number(body.monthlyShipments)
        || await resolveUserMonthlyShipments(req.userId);

      let pricing;
      try {
        pricing = await withTimeout(
          resolveCheckoutAmount({ ...body, monthlyShipments }, req.userId),
          Number(process.env.CHECKOUT_PRICING_TIMEOUT_MS ?? 25_000),
          'checkout-pricing',
        );
      } catch (pricingErr) {
        return res.status(500).json({
          error: pricingErr?.message || 'Не удалось рассчитать стоимость',
        });
      }

      if (clientCurrency !== pricing.currency) {
        console.warn(`[shipping] currency mismatch client=${clientCurrency} server=${pricing.currency}`);
      }
      const tol = Math.max(pricing.total * (AMOUNT_TOLERANCE_PERCENT / 100), 0.05);
      if (Number.isFinite(clientAmount) && Math.abs(clientAmount - pricing.total) > tol) {
        console.warn(`[shipping] amount mismatch client=${clientAmount} server=${pricing.total}`);
      }

      // Nova Post shipment is created only after payment (confirm-payment).
      const checkoutPayload = {
        ...body,
        locale: normalizeMailLocale(body.locale || body.lang || body.language),
      };
      const order = await createOrder({
        orderNumber,
        userId: req.userId || null,
        customerEmail,
        senderPhone: body.sender?.phone,
        receiverPhone: body.receiver?.phone,
        amount: pricing.total,
        currency: pricing.currency,
        status: 'pending_payment',
        paymentMode: stripeEnabled() ? 'stripe' : 'mock',
        payload: checkoutPayload,
        priceBreakdown: pricing.breakdown || null,
        priceSource: pricing.priceSource || null,
        npRef: null,
        npTtn: null,
        npSnapshot: { provider: 'deferred', reason: 'awaiting_payment', clientOrder: orderNumber },
      }, { notify: false });

      if (stripeEnabled()) {
        try {
          const checkoutUrl = await createStripeCheckoutForOrder(order, customerEmail);
          await sendCheckoutEmail(order, checkoutUrl);
          if (recipientPays) {
            return res.json({
              data: {
                awaitingRecipientPayment: true,
                publicToken: order.publicToken,
                orderNumber: order.orderNumber,
                amount: pricing.total,
                currency: pricing.currency,
                recipientEmail: body.receiver?.email || null,
              },
            });
          }
          return res.json({
            data: {
              checkoutUrl,
              publicToken: order.publicToken,
              orderNumber: order.orderNumber,
              amount: pricing.total,
              currency: pricing.currency,
            },
          });
        } catch (stripeErr) {
          console.error('[shipping] stripe checkout failed:', stripeErr);
          return res.status(502).json({
            error: formatStripeCheckoutError(stripeErr),
          });
        }
      }

      const { successUrl } = buildStripeReturnUrls(order.publicToken);
      await updateOrder(order.id, { paymentMode: 'mock' }, { notify: false });
      await sendCheckoutEmail(order, successUrl);
      if (recipientPays) {
        return res.json({
          data: {
            awaitingRecipientPayment: true,
            mockPayment: true,
            publicToken: order.publicToken,
            orderNumber: order.orderNumber,
            amount: pricing.total,
            currency: pricing.currency,
            recipientEmail: body.receiver?.email || null,
          },
        });
      }
      return res.json({
        data: {
          checkoutUrl: successUrl,
          mockPayment: true,
          publicToken: order.publicToken,
          orderNumber: order.orderNumber,
          amount: pricing.total,
          currency: pricing.currency,
        },
      });
    } catch (err) {
      console.error('[shipping] checkout:', err);
      res.status(500).json({ error: err.message || 'Не удалось оформить заказ' });
    }
  });

  router.post('/orders/:publicToken/confirm-payment', async (req, res) => {
    let npRef = null;
    try {
      const order = await findByPublicToken(req.params.publicToken);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });

      const bodyForCheck = order.payload || {};
      const needsPickup = orderNeedsCourierPickup(bodyForCheck);
      const pickupDone = hasFinalizedCourierPickup(order);

      // Already fully registered in Nova Post — idempotent OK.
      // Home/courier still needs a finalized NP pickup even if shipment exists.
      if (['submitted', 'delivered'].includes(order.status)) {
        return res.json({ data: publicOrder(order) });
      }
      if (
        (order.status === 'waiting_from_you' || (order.status === 'paid' && order.npRef && order.npTtn && !isMockNpOrder(order)))
        && (!needsPickup || pickupDone)
      ) {
        return res.json({ data: publicOrder(order) });
      }

      if (order.paymentMode === 'stripe' && order.stripeSessionId) {
        try {
          await assertStripeSessionPaid(order.stripeSessionId);
        } catch (payErr) {
          const status = payErr.status || 402;
          return res.status(status).json({ error: payErr.message || 'Оплата не завершена' });
        }
      } else if (order.paymentMode === 'stripe' && order.status !== 'paid' && order.status !== 'waiting_from_you') {
        return res.status(402).json({ error: 'Сначала завершите оплату на странице Stripe' });
      }
      // mock payment mode — skip Stripe verification
      // status===paid (retry after NP failure) — Stripe already confirmed

      const body = order.payload || {};
      const paidAt = order.paidAt || new Date().toISOString();

      let paymentMeta = {};
      if (order.paymentMode === 'stripe' && order.stripeSessionId) {
        const details = await getStripeCheckoutPaymentDetails(order.stripeSessionId);
        if (details?.last4) {
          paymentMeta = { cardLast4: details.last4, cardBrand: details.brand || null };
        }
      }
      const nextPayload = Object.keys(paymentMeta).length
        ? { ...body, ...paymentMeta }
        : body;

      // Persist payment BEFORE Nova Post create — money is already captured by Stripe.
      // If NP fails, the order stays "paid" and confirm-payment can retry NP.
      let paidOrder = order;
      if (order.status === 'pending_payment' || !order.paidAt) {
        paidOrder = await updateOrder(order.id, {
          status: 'paid',
          paidAt,
          ...(Object.keys(paymentMeta).length ? { payload: nextPayload } : {}),
        }) || order;
        await maybeConsumeWelcomeDiscount(paidOrder);
        await maybeConsumePromoCode(paidOrder);
      }

      // Shipment already exists — optionally create missing courier pickup, then mark waiting.
      if (paidOrder.npRef && paidOrder.npTtn && !isMockNpOrder(paidOrder)) {
        let snap = (paidOrder.npSnapshot && typeof paidOrder.npSnapshot === 'object')
          ? { ...paidOrder.npSnapshot }
          : {};
        if (orderNeedsCourierPickup(nextPayload) && !hasFinalizedCourierPickup(paidOrder)) {
          try {
            const pickup = await createCourierPickupForShipment(
              { ...nextPayload, clientOrder: paidOrder.orderNumber },
              { npRef: paidOrder.npRef, npTtn: paidOrder.npTtn },
            );
            snap = { ...snap, pickup, pickupError: null };
          } catch (pickupErr) {
            const msg = pickupErr instanceof Error ? pickupErr.message : String(pickupErr);
            console.error('[shipping] NP pickup after existing shipment failed:', msg);
            const failedOrder = await updateOrder(paidOrder.id, {
              status: 'paid',
              paidAt: paidOrder.paidAt || paidAt,
              npSnapshot: {
                ...snap,
                pickupError: { error: msg, at: new Date().toISOString() },
              },
              ...(Object.keys(paymentMeta).length ? { payload: nextPayload } : {}),
            }) || paidOrder;
            return res.status(502).json({
              error: msg,
              code: 'NP_PICKUP_FAILED',
              paymentCaptured: true,
              data: publicOrder(failedOrder),
            });
          }
        }
        const updated = await updateOrder(paidOrder.id, {
          status: 'waiting_from_you',
          paidAt: paidOrder.paidAt || paidAt,
          npSnapshot: snap,
          ...(Object.keys(paymentMeta).length ? { payload: nextPayload } : {}),
        });
        return res.json({ data: publicOrder(updated) });
      }

      try {
        const shipment = await createInternationalShipment(body, paidOrder.orderNumber);
        npRef = shipment.npRef;

        let snapshot = { ...shipment.snapshot };
        if (orderNeedsCourierPickup(body)) {
          try {
            const pickup = await createCourierPickupForShipment(
              { ...body, clientOrder: paidOrder.orderNumber },
              shipment,
            );
            snapshot = { ...snapshot, pickup };
          } catch (pickupErr) {
            // Keep shipment — payment is captured; retry confirm-payment creates pickup only.
            const msg = pickupErr instanceof Error ? pickupErr.message : String(pickupErr);
            console.error('[shipping] NP pickup after payment failed:', msg);
            const failedOrder = await updateOrder(paidOrder.id, {
              status: 'paid',
              paidAt: paidOrder.paidAt || paidAt,
              npRef: shipment.npRef,
              npTtn: shipment.npTtn,
              npSnapshot: {
                ...snapshot,
                pickupError: { error: msg, at: new Date().toISOString() },
              },
              payload: nextPayload,
            }) || paidOrder;
            return res.status(502).json({
              error: msg,
              code: 'NP_PICKUP_FAILED',
              paymentCaptured: true,
              data: publicOrder(failedOrder),
            });
          }
        }

        const updated = await updateOrder(paidOrder.id, {
          status: 'waiting_from_you',
          npRef: shipment.npRef,
          npTtn: shipment.npTtn,
          npSnapshot: snapshot,
          paidAt: paidOrder.paidAt || paidAt,
          payload: nextPayload,
        });

        return res.json({ data: publicOrder(updated) });
      } catch (npErr) {
        console.error('[shipping] NP after payment failed:', npErr);
        if (npRef) {
          deleteInternationalShipment(npRef).catch((e) => console.error('[shipping] rollback failed:', e));
        }
        const msg = npErr instanceof Error ? npErr.message : String(npErr);
        // Keep payment; store failure so admin/client can diagnose and retry confirm-payment.
        const failedOrder = await updateOrder(paidOrder.id, {
          status: 'paid',
          paidAt: paidOrder.paidAt || paidAt,
          npSnapshot: {
            provider: 'error',
            reason: 'np_after_payment_failed',
            error: msg,
            at: new Date().toISOString(),
            clientOrder: paidOrder.orderNumber,
          },
          payload: nextPayload,
        }) || paidOrder;
        return res.status(502).json({
          error: msg,
          code: 'NP_AFTER_PAYMENT_FAILED',
          paymentCaptured: true,
          data: publicOrder(failedOrder),
        });
      }
    } catch (err) {
      console.error('[shipping] confirm-payment:', err);
      if (npRef) {
        deleteInternationalShipment(npRef).catch((e) => console.error('[shipping] rollback failed:', e));
      }
      res.status(500).json({ error: err.message || 'Не удалось подтвердить оплату' });
    }
  });

  router.post('/orders/:publicToken/cancel', authMiddleware, async (req, res) => {
    try {
      const user = await findById(req.userId);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

      const order = await findByPublicToken(req.params.publicToken);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (!orderBelongsToUser(order, user)) {
        return res.status(403).json({ error: 'Нет доступа к этому заказу' });
      }
      if (order.status === 'cancelled') {
        return res.json({ data: publicOrder(order) });
      }
      if (order.status !== 'pending_payment') {
        return res.status(400).json({ error: 'Отменить можно только неоплаченный заказ' });
      }

      if (order.npRef) {
        try {
          await deleteInternationalShipment(order.npRef);
        } catch (npErr) {
          console.error('[shipping] NP cancel failed:', npErr);
          return res.status(502).json({
            error: 'Не удалось отменить отправление в Nova Post. Попробуйте позже.',
          });
        }
      }

      const updated = await updateOrder(order.id, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        npRef: null,
        npTtn: null,
      });

      res.json({ data: publicOrder(updated) });
    } catch (err) {
      console.error('[shipping] cancel:', err);
      res.status(500).json({ error: err.message || 'Не удалось отменить заказ' });
    }
  });

  router.post('/orders/:publicToken/pay', async (req, res) => {
    try {
      const order = await findByPublicToken(req.params.publicToken);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (order.status !== 'pending_payment') {
        return res.status(400).json({ error: 'Заказ уже оплачен или отправлен' });
      }
      if (!stripeEnabled()) {
        return res.status(503).json({ error: 'Оплата не настроена' });
      }

      // Nova Post is created only after payment confirmation — not here.

      const customerEmail = stripeCustomerEmailForOrder(order);
      if (!customerEmail) {
        return res.status(400).json({ error: 'Не указан email для оплаты' });
      }
      const checkoutUrl = await createStripeCheckoutForOrder(order, customerEmail);
      res.json({
        data: {
          checkoutUrl,
          publicToken: order.publicToken,
          orderNumber: order.orderNumber,
          amount: order.amount,
          currency: order.currency,
        },
      });
    } catch (err) {
      console.error('[shipping] pay:', err);
      res.status(500).json({ error: err.message || 'Не удалось открыть оплату' });
    }
  });

  router.get('/orders/status/:publicToken', async (req, res) => {
    try {
      let order = await findByPublicToken(req.params.publicToken);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      order = await syncOrderStatusFromNovaPost(order);
      res.json({ data: publicOrder(order) });
    } catch (err) {
      console.error('[shipping] status:', err);
      res.status(500).json({ error: 'Не удалось получить статус' });
    }
  });

  /** Public waybill PDF — token in URL is the access key. */
  router.get('/orders/:publicToken/waybill.pdf', async (req, res) => {
    try {
      const order = await findByPublicToken(req.params.publicToken);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (order.status === 'cancelled') {
        return res.status(400).json({ error: 'Накладная недоступна для отменённого заказа' });
      }
      const pdf = await buildWaybillPdf(order);
      const filename = waybillFilename(order);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(pdf);
    } catch (err) {
      console.error('[shipping] waybill.pdf:', err);
      res.status(500).json({ error: err?.message || 'Не удалось сформировать PDF' });
    }
  });

  router.get('/orders/me', authMiddleware, async (req, res) => {
    try {
      const user = await findById(req.userId);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      const orders = await findOrdersForUser(user);
      // Sync a limited batch of active NP shipments so the dashboard stays fresh.
      const synced = await Promise.all(
        orders.slice(0, 25).map(async (o) => {
          if (!o.npTtn && !o.npValid) return o;
          const full = await findByPublicToken(o.publicToken);
          if (!full) return o;
          const updated = await syncOrderStatusFromNovaPost(full);
          return publicOrder(updated);
        }),
      );
      // Keep any remaining orders beyond the sync window unchanged.
      const rest = orders.slice(25);
      res.json({ data: [...synced, ...rest] });
    } catch (err) {
      console.error('[shipping] orders/me:', err);
      res.status(500).json({ error: 'Не удалось загрузить отправки' });
    }
  });

  router.get('/track/:ttn', async (req, res) => {
    try {
      let order = await findByTrackQuery(req.params.ttn);
      if (!order) {
        return res.status(404).json({ error: 'Отправление не найдено' });
      }
      order = await syncOrderStatusFromNovaPost(order);
      res.json({ data: publicOrder(order) });
    } catch (err) {
      console.error('[shipping] track:', err);
      res.status(500).json({ error: 'Не удалось найти отправление' });
    }
  });

  return router;
}

export { normalizeCountryCode };
