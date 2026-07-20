import { Router } from 'express';
import { calculateBatch, calculateSingle, normalizeCountryCode } from './novapost/calculate.mjs';
import { createInternationalShipment, deleteInternationalShipment, tryCreateCheckoutShipment } from './novapost/shipment.mjs';
import { validateCheckoutBody } from './shipping-validate.mjs';
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
} from './stripe.mjs';
import {
  getSettings,
  calculateMatePrice,
  finalizeExternalQuote,
  computeOrderExtras,
  applyVat,
  roundAmount,
  convertToSettingsCurrency,
} from './pricing-config.mjs';
import { reconcileParcelPrice } from './pricing-reconcile.mjs';
import { countNovaPostCoverage, fetchNovaPostDivisions, mapDivisionToPoint } from './novapost/divisions.mjs';
import { MATE_BRANCHES, FALLBACK_LOCKERS, filterCatalogPoints } from './points-catalog.mjs';
import { isNovaPostMock } from './novapost/client.mjs';
import { resolveUserMonthlyShipments } from './loyalty.mjs';
import { resolveWelcomeDiscountPercent, consumeWelcomeDiscount } from './welcome-discount.mjs';
import { sendOrderCreatedEmail } from './mail.mjs';
import { geocodeAddressSuggestions } from './geocode.mjs';

function buildSideCoverage({ country, city, npCounts, useFallback }) {
  const mateBranches = filterCatalogPoints(MATE_BRANCHES, country, city);
  const fallbackLockers = filterCatalogPoints(FALLBACK_LOCKERS, country, city);

  let lockerCount = (npCounts?.postomat || 0) + (npCounts?.pudo || 0);
  // Branch mode = Mate branches + live Nova Post branch offices (PostBranch).
  let branchCount = mateBranches.length + (npCounts?.postBranch || 0);
  let source = npCounts?.source || 'none';

  if (useFallback || source === 'mock' || source === 'error') {
    lockerCount = Math.max(lockerCount, fallbackLockers.length);
    branchCount = Math.max(branchCount, mateBranches.length);
    source = source === 'novapost' ? source : 'fallback';
  }

  return {
    home: { available: true, count: null },
    locker: { available: lockerCount > 0, count: lockerCount },
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
  if (!order?.customerEmail) return;
  // Never block Stripe redirect on SMTP
  void sendOrderCreatedEmail(order, { checkoutUrl })
    .then(() => {
      console.log(`[mail] checkout email sent to ${order.customerEmail} (${order.orderNumber})`);
    })
    .catch((err) => {
      console.error('[mail] checkout email failed:', err);
    });
}

async function createStripeCheckoutForOrder(order, customerEmail) {
  const session = await createB2CCheckoutSession({
    order,
    amount: order.amount,
    currency: order.currency,
    customerEmail,
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
  const weightKg = Number(parcel.weightKg) || 2;
  const deliveryMode = resolvePricingMode(
    tariff.pickupType || tariff.pickupMode || body.pickupMode,
    tariff.deliveryType || tariff.deliveryMode || body.deliveryType,
  );
  const welcomeDiscountPercent = await resolveWelcomeDiscountPercent(userId || body.userId);

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
    pickupLocation: tariff.pickupLocation,
    deliveryLocation: tariff.deliveryLocation,
    payerType: tariff.payerType,
  });

  if (reconciled.amount == null) {
    throw new Error('Не удалось рассчитать стоимость');
  }

  let currency = reconciled.currency;
  let total = reconciled.amount;
  let priceSource = reconciled.priceSource || 'mate-matrix';
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

  return { total, currency, priceSource, breakdown };
}

async function ensureNpShipmentForOrder(order) {
  if (!isMockNpOrder(order)) return order;

  const body = order.payload;
  if (!body) throw new Error('Нет данных заказа для создания отправления в Nova Post');

  const shipment = await createInternationalShipment(body, order.orderNumber);
  if (!shipment.npTtn || String(shipment.npRef).startsWith('mock-')) {
    throw new Error('Не удалось создать отправление в Nova Post');
  }

  return updateOrder(order.id, {
    npRef: shipment.npRef,
    npTtn: shipment.npTtn,
    npSnapshot: shipment.snapshot,
    status: order.status === 'cancelled' ? 'pending_payment' : order.status,
    cancelledAt: order.status === 'cancelled' ? null : order.cancelledAt,
  });
}

async function maybeConsumeWelcomeDiscount(order) {
  if (!order?.userId) return;
  const pct = Number(order.priceBreakdown?.welcomeDiscountPercent) || 0;
  if (pct <= 0) return;
  await consumeWelcomeDiscount(order.userId);
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
      if (kind !== 'locker' && kind !== 'branch') {
        return res.status(400).json({ error: 'kind: locker или branch' });
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
        // branch = Mate branches + live Nova Post branch offices (PostBranch)
        const mate = filterCatalogPoints(MATE_BRANCHES, country, city);
        let points = [...mate];
        let source = 'mate';

        if (!isNovaPostMock()) {
          const branches = await fetchNovaPostDivisions({
            countryCode: country,
            city,
            categories: ['PostBranch'],
            limit: 40,
          });
          if (branches.source === 'novapost') {
            const npPoints = branches.items
              .filter(matchesCity)
              .map(mapDivisionToPoint)
              .filter((p) => p.lat && p.lng);
            points = dedupeById([...mate, ...npPoints]);
            source = npPoints.length ? 'novapost' : 'mate';
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

      // locker = Postomat + PUDO from Nova Post
      let points = [];
      let source = 'novapost';
      if (!isNovaPostMock()) {
        const [postomats, pudos] = await Promise.all([
          fetchNovaPostDivisions({ countryCode: country, city, categories: ['Postomat'], limit: 40 }),
          fetchNovaPostDivisions({ countryCode: country, city, categories: ['PUDO'], limit: 40 }),
        ]);
        const mapped = [...postomats.items, ...pudos.items]
          .filter(matchesCity)
          .map(mapDivisionToPoint)
          .filter((p) => p.lat && p.lng);

        points = dedupeById(mapped);

        if (postomats.source === 'error' && pudos.source === 'error') {
          source = 'fallback';
          points = filterCatalogPoints(FALLBACK_LOCKERS, country, city);
        } else {
          source = 'novapost';
        }
      } else {
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
      const settings = await getSettings();
      const preferNovaPost = String(process.env.PRICING_PREFER || 'mate').toLowerCase() === 'novapost';

      // Same welcome discount as calculate-final (reconcile), so the price
      // doesn't jump when the user reaches steps 7–8.
      const withWelcomeDiscount = (quote) => {
        const beforeVat = quote?.breakdown?.beforeVat;
        if (!(welcomeDiscountPercent > 0) || beforeVat == null || !Number.isFinite(Number(beforeVat))) {
          return quote;
        }
        const discounted = Number(beforeVat) * (1 - welcomeDiscountPercent / 100);
        const afterVat = applyVat(discounted, settings);
        const total = roundAmount(afterVat, settings);
        return {
          ...quote,
          total,
          breakdown: {
            ...quote.breakdown,
            welcomeDiscountPercent,
            welcomeDiscountAmount: Math.round((Number(beforeVat) - discounted) * 100) / 100,
            beforeVat: Math.round(discounted * 100) / 100,
            afterVat: Math.round(afterVat * 100) / 100,
            total,
          },
        };
      };

      const quotes = { ...result.quotes };
      let currency = result.currency;
      let priceSource = result.priceSource;
      let usedNova = 0;
      let usedMate = 0;

      for (const size of sizes) {
        const key = size.boxSize;
        const raw = quotes[key];
        const npTotal = typeof raw === 'number' ? raw : raw?.total;
        const npCurrency = typeof raw === 'object' && raw?.currency?.code
          ? raw.currency.code
          : result.currency?.code || 'EUR';
        const npSource = typeof raw === 'object' ? raw.priceSource : result.priceSource;
        const weightKg = Number(size.weightKg) || 2;

        const canUseNp = preferNovaPost
          && npSource === 'novapost'
          && npTotal != null
          && Number.isFinite(Number(npTotal));

        if (canUseNp) {
          const finalized = finalizeExternalQuote(npTotal, npCurrency, settings, 'novapost');
          currency = { code: finalized.currency, symbol: finalized.currency };
          quotes[key] = withWelcomeDiscount({
            ...(typeof raw === 'object' && raw ? raw : {}),
            total: finalized.amount,
            currency: finalized.currency,
            priceSource: 'novapost',
            breakdown: {
              ...finalized.breakdown,
              deliveryMode: mode,
              npServices: typeof raw === 'object' ? raw.breakdown : null,
            },
          });
          usedNova += 1;
          continue;
        }

        const mate = await calculateMatePrice({
          toCountry,
          weightKg,
          deliveryMode: mode,
          monthlyShipments,
        });
        if (mate.amount != null) {
          // Same max(matrix net, Nova Post net) as calculate-final (reconcile),
          // so the price doesn't rise when the user reaches steps 7–8.
          const matrixNet = Number(mate.breakdown?.beforeVat ?? mate.breakdown?.cost) || 0;
          let chosenNet = matrixNet;
          let source = 'mate-matrix';
          if (npSource === 'novapost' && npTotal != null && Number.isFinite(Number(npTotal))) {
            const npNet = Math.round(
              convertToSettingsCurrency(Number(npTotal), npCurrency, settings) * 100,
            ) / 100;
            if (npNet > chosenNet) {
              chosenNet = npNet;
              source = 'novapost';
            }
          }
          const afterVat = applyVat(chosenNet, settings);
          const total = roundAmount(afterVat, settings);
          currency = { code: mate.currency, symbol: mate.currency };
          quotes[key] = withWelcomeDiscount({
            ...(typeof raw === 'object' && raw ? raw : {}),
            total,
            currency: mate.currency,
            priceSource: source,
            breakdown: {
              ...mate.breakdown,
              matrixNet: Math.round(matrixNet * 100) / 100,
              beforeVat: Math.round(chosenNet * 100) / 100,
              afterVat: Math.round(afterVat * 100) / 100,
              total,
              source,
            },
          });
          if (source === 'novapost') usedNova += 1;
          else usedMate += 1;
        } else if (npTotal != null && Number.isFinite(Number(npTotal))) {
          const finalized = finalizeExternalQuote(
            npTotal,
            npCurrency,
            settings,
            npSource === 'novapost' ? 'novapost' : 'estimate',
          );
          currency = { code: finalized.currency, symbol: finalized.currency };
          quotes[key] = withWelcomeDiscount({
            ...(typeof raw === 'object' && raw ? raw : {}),
            total: finalized.amount,
            currency: finalized.currency,
            priceSource: finalized.breakdown.source,
            breakdown: finalized.breakdown,
          });
        }
      }

      if (usedNova) priceSource = 'novapost';
      else if (usedMate) priceSource = 'mate-matrix';

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

  /** Final price: max(matrix net, Nova Post net) + VAT — for steps 7–8 and checkout */
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
      } = req.body;
      if (!toCountry || !parcel) {
        return res.status(400).json({ error: 'Укажите направление и параметры посылки' });
      }
      const monthlyShipments = Number(req.body.monthlyShipments)
        || await resolveUserMonthlyShipments(req.userId);
      const welcomeDiscountPercent = await resolveWelcomeDiscountPercent(req.userId);
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

      const fingerprint = checkoutPayloadFingerprint(body);
      const existing = await findRecentPendingOrder(customerEmail, fingerprint);
      if (existing && !String(existing.npRef || '').startsWith('mock-')) {
        console.log(`[shipping] reusing pending order ${existing.orderNumber} (duplicate checkout prevented)`);
        if (stripeEnabled()) {
          const checkoutUrl = await createStripeCheckoutForOrder(existing, customerEmail);
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

      const [pricingResult, shipmentResult] = await Promise.allSettled([
        withTimeout(
          resolveCheckoutAmount({ ...body, monthlyShipments }, req.userId),
          Number(process.env.CHECKOUT_PRICING_TIMEOUT_MS ?? 25_000),
          'checkout-pricing',
        ),
        withTimeout(
          tryCreateCheckoutShipment(body, orderNumber),
          Number(process.env.CHECKOUT_NP_TIMEOUT_MS ?? 18_000),
          'checkout-np',
        ),
      ]);

      if (pricingResult.status === 'rejected') {
        if (shipmentResult.status === 'fulfilled' && shipmentResult.value?.shipment?.npRef
          && !String(shipmentResult.value.shipment.npRef).startsWith('mock-')) {
          deleteInternationalShipment(shipmentResult.value.shipment.npRef).catch(() => {});
        }
        return res.status(500).json({
          error: pricingResult.reason?.message || 'Не удалось рассчитать стоимость',
        });
      }

      const pricing = pricingResult.value;
      const shipmentOutcome = shipmentResult.status === 'fulfilled'
        ? shipmentResult.value
        : {
          shipment: {
            npRef: null,
            npTtn: null,
            snapshot: {
              provider: 'deferred',
              error: String(shipmentResult.reason?.message || shipmentResult.reason || 'unknown'),
              clientOrder: orderNumber,
            },
          },
          deferred: true,
        };
      const shipment = shipmentOutcome.shipment;

      if (shipmentOutcome.deferred) {
        console.warn(`[shipping] NP shipment deferred for ${orderNumber} — will retry after payment`);
      }

      if (clientCurrency !== pricing.currency) {
        console.warn(`[shipping] currency mismatch client=${clientCurrency} server=${pricing.currency}`);
      }
      const tol = Math.max(pricing.total * (AMOUNT_TOLERANCE_PERCENT / 100), 0.05);
      if (Number.isFinite(clientAmount) && Math.abs(clientAmount - pricing.total) > tol) {
        console.warn(`[shipping] amount mismatch client=${clientAmount} server=${pricing.total}`);
      }

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
        payload: body,
        priceBreakdown: pricing.breakdown || null,
        priceSource: pricing.priceSource || null,
        npRef: shipment.npRef,
        npTtn: shipment.npTtn,
        npSnapshot: shipment.snapshot,
      }, { notify: false });

      if (stripeEnabled()) {
        try {
          const checkoutUrl = await createStripeCheckoutForOrder(order, customerEmail);
          await sendCheckoutEmail(order, checkoutUrl);
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
            error: 'Не удалось открыть страницу оплаты Stripe. Проверьте STRIPE_SECRET_KEY.',
          });
        }
      }

      const { successUrl } = buildStripeReturnUrls(order.publicToken);
      await updateOrder(order.id, { paymentMode: 'mock' }, { notify: false });
      await sendCheckoutEmail(order, successUrl);
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
      if (order.status === 'paid' || order.status === 'submitted') {
        return res.json({ data: publicOrder(order) });
      }

      if (order.paymentMode === 'stripe' && order.stripeSessionId) {
        try {
          await assertStripeSessionPaid(order.stripeSessionId);
        } catch (payErr) {
          const status = payErr.status || 402;
          return res.status(status).json({ error: payErr.message || 'Оплата не завершена' });
        }
      } else if (order.paymentMode === 'stripe') {
        return res.status(402).json({ error: 'Сначала завершите оплату на странице Stripe' });
      }
      // mock payment mode — skip Stripe verification

      const body = order.payload;

      if (order.npRef && order.npTtn) {
        const updated = await updateOrder(order.id, {
          status: 'submitted',
          paidAt: new Date().toISOString(),
        });
        await maybeConsumeWelcomeDiscount(order);
        return res.json({ data: publicOrder(updated) });
      }

      const shipment = await createInternationalShipment(body, order.orderNumber);
      npRef = shipment.npRef;

      const updated = await updateOrder(order.id, {
        status: 'submitted',
        npRef: shipment.npRef,
        npTtn: shipment.npTtn,
        npSnapshot: shipment.snapshot,
        paidAt: new Date().toISOString(),
      });

      await maybeConsumeWelcomeDiscount(order);

      res.json({ data: publicOrder(updated) });
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
      let order = await findByPublicToken(req.params.publicToken);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      if (order.status !== 'pending_payment') {
        return res.status(400).json({ error: 'Заказ уже оплачен или отправлен' });
      }
      if (!stripeEnabled()) {
        return res.status(503).json({ error: 'Оплата не настроена' });
      }

      if (isMockNpOrder(order)) {
        try {
          order = await ensureNpShipmentForOrder(order);
        } catch (npErr) {
          return res.status(422).json({
            error: npErr?.message || 'Не удалось создать отправление в Nova Post. Проверьте телефон и адрес.',
          });
        }
      }

      const customerEmail = order.customerEmail || order.payload?.customerEmail;
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
      const order = await findByPublicToken(req.params.publicToken);
      if (!order) return res.status(404).json({ error: 'Заказ не найден' });
      res.json({ data: publicOrder(order) });
    } catch (err) {
      console.error('[shipping] status:', err);
      res.status(500).json({ error: 'Не удалось получить статус' });
    }
  });

  router.get('/orders/me', authMiddleware, async (req, res) => {
    try {
      const user = await findById(req.userId);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      const orders = await findOrdersForUser(user);
      res.json({ data: orders });
    } catch (err) {
      console.error('[shipping] orders/me:', err);
      res.status(500).json({ error: 'Не удалось загрузить отправки' });
    }
  });

  router.get('/track/:ttn', async (req, res) => {
    try {
      const order = await findByTrackQuery(req.params.ttn);
      if (!order) {
        return res.status(404).json({ error: 'Отправление не найдено' });
      }
      res.json({ data: publicOrder(order) });
    } catch (err) {
      console.error('[shipping] track:', err);
      res.status(500).json({ error: 'Не удалось найти отправление' });
    }
  });

  return router;
}

export { normalizeCountryCode };
