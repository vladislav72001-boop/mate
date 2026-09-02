import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chargeableWeightKg,
  finalizeNovaPostClientPrice,
} from './pricing-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pricingData = JSON.parse(
  readFileSync(path.join(__dirname, 'data', 'hu-ru-pricing.json'), 'utf8'),
);

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

export function quoteHuRuParcel({
  weightKg,
  lengthCm,
  widthCm,
  heightCm,
  boxSize,
  deliveryMode = 'branch',
  settings,
  monthlyShipments = 1,
  welcomeDiscountPercent = 0,
  promo = null,
}) {
  const billableKg = chargeableWeightKg(weightKg, lengthCm, widthCm, heightCm, boxSize);
  const { eur, band, kind } = huRuBasePriceEur(billableKg, deliveryMode);
  const finalized = finalizeNovaPostClientPrice({
    npTotal: eur,
    quoteCurrency: 'EUR',
    settings,
    weightMarkups: [],
    tiers: [],
    weightKg: billableKg,
    monthlyShipments,
    welcomeDiscountPercent,
    promo,
    source: 'hu-ru',
    deliveryMode: kind === 'home' ? 'address' : 'branch',
    costIncludesVat: false,
  });

  const log = Array.isArray(finalized.breakdown?.log) ? [...finalized.breakdown.log] : [];
  log.unshift({
    step: 0,
    title: kind === 'home' ? 'HU→RU EMS (курьер)' : 'HU→RU отделение Почты РФ',
    detail: `${band.minKg}–${band.maxKg} kg · ${eur} EUR`,
    value: eur,
  });

  return {
    ...finalized,
    priceSource: 'hu-ru',
    scheduledDeliveryDate: null,
    breakdown: {
      ...(finalized.breakdown || {}),
      huRu: { band, kind, baseEur: eur },
      log,
    },
  };
}

export function huRuDeliveryEta() {
  return pricingData.deliveryDays || { min: 10, max: 20 };
}
