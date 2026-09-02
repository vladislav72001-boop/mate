import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chargeableWeightKg,
  eurToCurrency,
  roundAmount,
} from './pricing-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pricingData = JSON.parse(
  readFileSync(path.join(__dirname, 'data', 'hu-ru-pricing.json'), 'utf8'),
);

/** Stripe fee baked into HU→RU client price (table EUR already includes VAT). */
const HU_RU_STRIPE_PERCENT = Number(process.env.HU_RU_STRIPE_PERCENT ?? 5);

export function isHuRuRoute(fromCountry, toCountry) {
  return String(fromCountry || '').toUpperCase() === 'HU'
    && String(toCountry || '').toUpperCase() === 'RU';
}

function huRuDeliveryKind(deliveryMode) {
  const mode = String(deliveryMode || '').toLowerCase();
  if (mode === 'home' || mode === 'address' || mode === 'courier') return 'home';
  return 'branch';
}

function lookupHuRuBand(weightKg, tiers) {
  const w = Math.max(0, Number(weightKg) || 0);
  const exact = tiers.find((t) => w >= t.minKg && w <= t.maxKg);
  if (exact) return exact;
  if (w > tiers[tiers.length - 1].maxKg) return tiers[tiers.length - 1];
  return tiers.find((t) => t.maxKg >= w) || tiers[tiers.length - 1];
}

export function huRuBasePriceEur(weightKg, deliveryMode) {
  const kind = huRuDeliveryKind(deliveryMode);
  const tiers = kind === 'home' ? pricingData.home : pricingData.branch;
  const band = lookupHuRuBand(weightKg, tiers);
  return { eur: band.priceEur, band, kind };
}

function applyHuRuDiscounts(baseHuf, { welcomeDiscountPercent = 0, promo = null }) {
  let amount = baseHuf;
  let welcomeDiscountAmount = 0;
  let promoDiscountAmount = 0;
  let appliedPromo = null;

  const appliedWelcomePercent = Number(welcomeDiscountPercent) > 0
    ? Math.min(100, Number(welcomeDiscountPercent))
    : 0;
  if (appliedWelcomePercent > 0) {
    welcomeDiscountAmount = amount * (appliedWelcomePercent / 100);
    amount -= welcomeDiscountAmount;
  }

  const promoType = promo?.type === 'fixed' ? 'fixed' : (promo?.type === 'percent' ? 'percent' : null);
  const promoValue = Number(promo?.value) || 0;
  const promoCode = String(promo?.code || '').trim().toUpperCase();
  if (promoType && promoValue > 0 && promoCode) {
    if (promoType === 'percent') {
      const pct = Math.min(100, promoValue);
      promoDiscountAmount = amount * (pct / 100);
      appliedPromo = {
        id: promo.id || null,
        code: promoCode,
        type: 'percent',
        value: pct,
        amount: Math.round(promoDiscountAmount * 100) / 100,
      };
    } else {
      promoDiscountAmount = Math.min(amount, promoValue);
      appliedPromo = {
        id: promo.id || null,
        code: promoCode,
        type: 'fixed',
        value: promoValue,
        amount: Math.round(promoDiscountAmount * 100) / 100,
      };
    }
    amount -= promoDiscountAmount;
  }

  return {
    amount,
    welcomeDiscountAmount,
    appliedWelcomePercent,
    promoDiscountAmount,
    appliedPromo,
  };
}

function finalizeHuRuClientPrice({
  eur,
  settings,
  welcomeDiscountPercent = 0,
  promo = null,
  band,
  kind,
}) {
  const currency = String(settings?.currency || 'HUF').toUpperCase();
  const fx = settings?.fxFromEur || {};
  const fxRate = Number(fx[currency] ?? fx.HUF ?? 370);
  const baseHuf = Math.round(eurToCurrency(eur, currency, fx) * 100) / 100;
  const stripeFee = Math.round(baseHuf * (HU_RU_STRIPE_PERCENT / 100) * 100) / 100;
  const beforeDiscounts = baseHuf + stripeFee;

  const discounted = applyHuRuDiscounts(beforeDiscounts, { welcomeDiscountPercent, promo });
  const total = roundAmount(discounted.amount, settings);

  const log = [
    {
      step: 1,
      title: kind === 'home' ? 'HU→RU EMS (курьер)' : 'HU→RU отделение Почты РФ',
      detail: `${band.minKg}–${band.maxKg} kg · ${eur} EUR (НДС включён)`,
      value: eur,
    },
    {
      step: 2,
      title: 'Курс EUR → HUF',
      detail: `${eur} EUR × ${fxRate}`,
      value: baseHuf,
    },
    {
      step: 3,
      title: `Комиссия Stripe +${HU_RU_STRIPE_PERCENT}%`,
      detail: `${baseHuf} × ${(1 + HU_RU_STRIPE_PERCENT / 100).toFixed(2)}`,
      value: beforeDiscounts,
    },
  ];

  if (discounted.appliedWelcomePercent > 0) {
    log.push({
      step: log.length + 1,
      title: `Скидка новичка −${discounted.appliedWelcomePercent}%`,
      detail: 'одноразовая',
      value: -Math.round(discounted.welcomeDiscountAmount * 100) / 100,
    });
  }
  if (discounted.appliedPromo) {
    log.push({
      step: log.length + 1,
      title: `Промокод ${discounted.appliedPromo.code}`,
      detail: discounted.appliedPromo.type === 'percent'
        ? `−${discounted.appliedPromo.value}%`
        : `−${discounted.appliedPromo.value} ${currency}`,
      value: -discounted.appliedPromo.amount,
    });
  }
  log.push({
    step: log.length + 1,
    title: 'Итого для клиента',
    detail: currency,
    value: total,
  });

  return {
    amount: total,
    currency,
    priceSource: 'hu-ru',
    breakdown: {
      baseEur: eur,
      baseHuf,
      stripePercent: HU_RU_STRIPE_PERCENT,
      stripeFee,
      beforeDiscounts,
      welcomeDiscountPercent: discounted.appliedWelcomePercent || null,
      welcomeDiscountAmount: discounted.welcomeDiscountAmount || null,
      promoCode: discounted.appliedPromo?.code || null,
      promoId: discounted.appliedPromo?.id || null,
      promoType: discounted.appliedPromo?.type || null,
      promoValue: discounted.appliedPromo?.value ?? null,
      promoDiscountAmount: discounted.promoDiscountAmount || null,
      total,
      currency,
      source: 'hu-ru',
      vatIncludedInTable: true,
      huRu: { band, kind, baseEur: eur, fxRate },
      log,
    },
  };
}

export function quoteHuRuParcel({
  weightKg,
  lengthCm,
  widthCm,
  heightCm,
  boxSize,
  deliveryMode = 'branch',
  settings,
  monthlyShipments: _monthlyShipments = 1,
  welcomeDiscountPercent = 0,
  promo = null,
}) {
  const billableKg = chargeableWeightKg(weightKg, lengthCm, widthCm, heightCm, boxSize);
  const { eur, band, kind } = huRuBasePriceEur(billableKg, deliveryMode);
  const finalized = finalizeHuRuClientPrice({
    eur,
    settings,
    welcomeDiscountPercent,
    promo,
    band,
    kind,
  });

  return {
    ...finalized,
    scheduledDeliveryDate: null,
  };
}

export function huRuDeliveryEta() {
  return pricingData.deliveryDays || { min: 10, max: 20 };
}
