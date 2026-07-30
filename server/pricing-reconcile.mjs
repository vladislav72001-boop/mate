import { calculateSingle } from './novapost/calculate.mjs';
import {
  getSettings,
  getPricing,
  chargeableWeightKg,
  finalizeNovaPostClientPrice,
} from './pricing-config.mjs';

/**
 * Client delivery price from live Nova Post + markup + VAT + rounding.
 * No Excel matrix participates in the calculation. If NP is temporarily
 * unavailable, its clearly-labelled estimate follows the same formula.
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
  pickupLocation,
  deliveryLocation,
  payerType = 'Sender',
}) {
  const [settings, pricing] = await Promise.all([getSettings(), getPricing()]);
  const currency = String(settings.currency || 'HUF').toUpperCase();
  const billableKg = chargeableWeightKg(weightKg, lengthCm, widthCm, heightCm, boxSize);

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
      source,
      deliveryMode,
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
