import { calculateSingle } from './novapost/calculate.mjs';
import {
  getSettings,
  getPricing,
  chargeableWeightKg,
  finalizeNovaPostClientPrice,
  matrixCostNet,
  preferMateMatrixPricing,
  markupsForLiveNovaPost,
  tiersForLiveNovaPost,
} from './pricing-config.mjs';
import { isHuRuRoute, quoteHuRuParcel } from './hu-ru-pricing.mjs';

/**
 * Client delivery price:
 * 1) Live Nova Post under Mate GNPHU contract (VAT already in tariff) + Mate ~30%
 * 2) Excel matrix only when PRICING_FORCE_MATE=true
 * 3) Matrix fallback if live NP quote unavailable (never sell mock EUR estimates)
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

  if (isHuRuRoute(fromCountry, toCountry)) {
    const huRu = quoteHuRuParcel({
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
      boxSize,
      deliveryMode: mode,
      settings,
      monthlyShipments,
      welcomeDiscountPercent,
      promo,
    });
    return {
      amount: huRu.amount,
      currency: huRu.currency,
      priceSource: huRu.priceSource,
      breakdown: huRu.breakdown,
      scheduledDeliveryDate: null,
    };
  }

  if (preferMateMatrixPricing()) {
    const matrixNet = matrixCostNet(pricing, {
      toCountry,
      weightKg: billableKg,
      deliveryMode: mode,
    });
    if (matrixNet != null) {
      return {
        ...finalizeNovaPostClientPrice({
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
        }),
        scheduledDeliveryDate: null,
      };
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

  if (npQuote?.priceSource === 'novapost' && npQuote?.total != null && Number.isFinite(Number(npQuote.total))) {
    return {
      ...finalizeNovaPostClientPrice({
        npTotal: npQuote.total,
        quoteCurrency: npQuote.currency?.code || 'EUR',
        settings,
        weightMarkups: markupsForLiveNovaPost(pricing),
        tiers: tiersForLiveNovaPost(pricing),
        weightKg: billableKg,
        monthlyShipments,
        welcomeDiscountPercent,
        promo,
        source: 'novapost',
        deliveryMode: mode,
        npServices: npQuote.breakdown || null,
        costIncludesVat: true,
      }),
      scheduledDeliveryDate: npQuote.scheduledDeliveryDate || null,
    };
  }

  const matrixFallback = matrixCostNet(pricing, {
    toCountry,
    weightKg: billableKg,
    deliveryMode: mode,
  });
  if (matrixFallback != null) {
    return {
      ...finalizeNovaPostClientPrice({
        npTotal: matrixFallback,
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
      }),
      scheduledDeliveryDate: npQuote?.scheduledDeliveryDate || null,
    };
  }

  return {
    amount: null,
    currency,
    priceSource: null,
    breakdown: null,
    scheduledDeliveryDate: null,
  };
}
