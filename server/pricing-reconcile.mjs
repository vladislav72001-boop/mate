import { calculateSingle } from './novapost/calculate.mjs';
import {
  getSettings,
  calculateMatePrice,
  applyVat,
  roundAmount,
  convertToSettingsCurrency,
} from './pricing-config.mjs';

/**
 * Compare matrix net tariff vs Nova Post net, take max, then VAT + rounding.
 * Matrix cells = prices without VAT (Excel). NP quote treated as net in its currency.
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
}) {
  const settings = await getSettings();
  const currency = String(settings.currency || 'HUF').toUpperCase();

  const mate = await calculateMatePrice({
    toCountry,
    weightKg,
    deliveryMode,
    monthlyShipments,
  });

  const matrixNet = mate.breakdown?.beforeVat != null
    ? Number(mate.breakdown.beforeVat)
    : mate.breakdown?.cost != null
      ? Number(mate.breakdown.cost)
      : null;

  let npNet = null;
  let npSource = null;
  let npServices = null;
  let npCurrency = null;

  try {
    const quote = await calculateSingle({
      fromCountry,
      toCountry,
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
      declaredValue,
      boxSize,
    });
    if (quote?.total != null && Number.isFinite(Number(quote.total))) {
      npCurrency = quote.currency?.code || 'EUR';
      npNet = convertToSettingsCurrency(Number(quote.total), npCurrency, settings);
      npNet = Math.round(npNet * 100) / 100;
      npSource = quote.priceSource || 'novapost';
      npServices = quote.breakdown || null;
    }
  } catch (err) {
    console.warn('[pricing] NP reconcile quote failed:', err?.message || err);
  }

  let chosenNet = matrixNet;
  let priceSource = 'mate-matrix';

  if (npNet != null && npSource === 'novapost') {
    if (matrixNet != null) {
      chosenNet = Math.max(matrixNet, npNet);
      if (chosenNet > matrixNet) priceSource = 'novapost';
      else if (chosenNet > npNet) priceSource = 'mate-matrix';
      else priceSource = 'reconciled';
    } else {
      chosenNet = npNet;
      priceSource = 'novapost';
    }
  } else if (chosenNet == null && npNet != null) {
    chosenNet = npNet;
    priceSource = npSource === 'novapost' ? 'novapost' : 'estimate';
  }

  if (chosenNet == null) {
    return {
      amount: null,
      currency,
      priceSource: null,
      breakdown: null,
    };
  }

  const baseNet = chosenNet;
  let beforeVat = baseNet;
  let welcomeDiscountAmount = 0;
  const appliedWelcomePercent = Number(welcomeDiscountPercent) > 0
    ? Math.min(100, Number(welcomeDiscountPercent))
    : 0;

  if (appliedWelcomePercent > 0) {
    welcomeDiscountAmount = beforeVat * (appliedWelcomePercent / 100);
    beforeVat = beforeVat - welcomeDiscountAmount;
  }

  const afterVat = applyVat(beforeVat, settings);
  const amount = roundAmount(afterVat, settings);

  const log = [];
  if (matrixNet != null) {
    log.push({
      step: log.length + 1,
      title: 'Матрица (без НДС)',
      detail: `${deliveryMode} · ${toCountry}`,
      value: Math.round(matrixNet * 100) / 100,
    });
  }
  if (npNet != null) {
    log.push({
      step: log.length + 1,
      title: 'Nova Post (без НДС)',
      detail: npSource || 'novapost',
      value: Math.round(npNet * 100) / 100,
    });
  }
  log.push({
    step: log.length + 1,
    title: 'База max(матрица, NP)',
    detail: priceSource,
    value: Math.round(baseNet * 100) / 100,
  });
  if (appliedWelcomePercent > 0) {
    log.push({
      step: log.length + 1,
      title: `Скидка новичка −${appliedWelcomePercent}%`,
      detail: 'одноразовая',
      value: -Math.round(welcomeDiscountAmount * 100) / 100,
    });
    log.push({
      step: log.length + 1,
      title: 'После скидки',
      detail: 'без НДС',
      value: Math.round(beforeVat * 100) / 100,
    });
  }
  if (settings?.vatEnabled) {
    log.push({
      step: log.length + 1,
      title: `НДС +${settings.vatPercent}%`,
      detail: `${Math.round(beforeVat * 100) / 100} × ${(1 + Number(settings.vatPercent) / 100).toFixed(2)}`,
      value: Math.round(afterVat * 100) / 100,
    });
  }
  if (settings?.roundingEnabled) {
    log.push({
      step: log.length + 1,
      title: `Округление до ${settings.roundingStep}`,
      detail: '→ доставка',
      value: amount,
    });
  }
  log.push({
    step: log.length + 1,
    title: 'Итого доставка',
    detail: currency,
    value: amount,
  });

  return {
    amount,
    currency,
    priceSource,
    breakdown: {
      matrixNet: matrixNet != null ? Math.round(matrixNet * 100) / 100 : null,
      npNet: npNet != null ? Math.round(npNet * 100) / 100 : null,
      chosenNet: Math.round(baseNet * 100) / 100,
      welcomeDiscountPercent: appliedWelcomePercent || null,
      welcomeDiscountAmount: appliedWelcomePercent > 0
        ? Math.round(welcomeDiscountAmount * 100) / 100
        : null,
      beforeVat: Math.round(beforeVat * 100) / 100,
      afterVat: Math.round(afterVat * 100) / 100,
      total: amount,
      currency,
      source: priceSource,
      deliveryMode,
      npServices,
      log,
    },
  };
}
