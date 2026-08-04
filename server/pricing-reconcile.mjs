import { calculateSingle } from './novapost/calculate.mjs';
import {
  getSettings,
  getPricing,
  chargeableWeightKg,
  finalizeNovaPostClientPrice,
  matrixCostNet,
  preferMateMatrixPricing,
} from './pricing-config.mjs';

/**
 * Client delivery price:
 * 1) Prefer Mate matrix (Excel / B2C table) when PRICING_PREFER!=novapost
 * 2) Else live Nova Post — treated as VAT-inclusive company tariff + Mate markup
 */
export async function reconcileParcelPrice({
  fromCountry = 'HU',
  toCountry,
  weightKg,
  deliveryMode = 'locker',
  lengthCm,
  widthCm,
  heightCm,
  declaredValue = 100,
  boxSize,
  monthlyShipments = 1,
  welcomeDiscountPercent = 0,
  promo = null,
  pickupLocation,
  deliveryLocation,
  payerType = 'Sender',
}) {
  const [settings, pricing] = await Promise.all([getSettings(), getPricing()]);
  const currency = String(settings.currency || 'HUF').toUpperCase();
  const billableKg = chargeableWeightKg(weightKg, lengthCm, widthCm, heightCm, boxSize);
  const mode = deliveryMode || 'locker';

  if (preferMateMatrixPricing()) {
    const matrixNet = matrixCostNet(pricing, {
      toCountry,
      weightKg: billableKg,
      deliveryMode: mode,
    });
    if (matrixNet != null) {
      return finalizeNovaPostClientPrice({
        npTotal: matrixNet,
        quoteCurrency: currency,
        settings,
        weightMarkups: pricing.weightMarkups,
        tiers: pricing.tiers,
        weightKg: billableKg,
        monthlyShipments,
        welcomeDiscountPercent,
        promo,
        source: 'mate',
        deliveryMode: mode,
        costIncludesVat: false,
      });
    }
  }

  let npQuote = null;
  try {
    npQuote = await calculateSingle({
      fromCountry,
      toCountry,
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
      declaredValue,
      boxSize,
      pickupLocation,
      deliveryLocation,
      payerType,
    });
  } catch (err) {
    console.warn('[pricing] NP reconcile quote failed:', err?.message || err);
  }

  const npOk = npQuote?.total != null
    && Number.isFinite(Number(npQuote.total))
    && (npQuote.priceSource === 'novapost' || npQuote.priceSource === 'mock' || npQuote.priceSource === 'estimate');

  if (npOk) {
    const source = npQuote.priceSource === 'novapost' ? 'novapost' : 'estimate';
    return finalizeNovaPostClientPrice({
      npTotal: npQuote.total,
      quoteCurrency: npQuote.currency?.code || 'EUR',
      settings,
      weightMarkups: pricing.weightMarkups,
      tiers: pricing.tiers,
      weightKg: billableKg,
      monthlyShipments,
      welcomeDiscountPercent,
      promo,
      source,
      deliveryMode: mode,
      npServices: npQuote.breakdown || null,
    });
  }

  return {
    amount: null,
    currency,
    priceSource: null,
    breakdown: null,
  };
}
