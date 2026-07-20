import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './db.mjs';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

export const DESTINATIONS = [
  'DOM', 'DE', 'CZ', 'SK', 'AT', 'LT', 'LV', 'EE',
  'IT', 'ES', 'FR', 'RO', 'NL', 'GB', 'MD', 'UA',
];

export const WEIGHT_ROWS = [
  { key: 'docs', label: 'Docs', maxKg: 0.25, avgKg: 0.25 },
  { key: '0.5', label: '0,5', maxKg: 0.5, avgKg: 0.25 },
  { key: '1', label: '1', maxKg: 1, avgKg: 0.75 },
  { key: '1.5', label: '1,5', maxKg: 1.5, avgKg: 1.25 },
  { key: '2', label: '2', maxKg: 2, avgKg: 1.75 },
  { key: '3', label: '3', maxKg: 3, avgKg: 2.5 },
  { key: '5', label: '5', maxKg: 5, avgKg: 4 },
  { key: '7.5', label: '7,5', maxKg: 7.5, avgKg: 6.25 },
  { key: '10', label: '10', maxKg: 10, avgKg: 8.75 },
  { key: '15', label: '15', maxKg: 15, avgKg: 12.5 },
  { key: '20', label: '20', maxKg: 20, avgKg: 17.5 },
  { key: '25', label: '25', maxKg: 25, avgKg: 22.5 },
  { key: '30', label: '30', maxKg: 30, avgKg: 27.5 },
  { key: '40', label: '40', maxKg: 40, avgKg: 35 },
  { key: '50', label: '50', maxKg: 50, avgKg: 45 },
  { key: '70', label: '70', maxKg: 70, avgKg: 60 },
  { key: '100', label: '100', maxKg: 100, avgKg: 85 },
];

export const DELIVERY_MODES = ['branch', 'locker', 'address'];

const DEST_FACTOR = {
  DOM: 1,
  DE: 1.55,
  CZ: 1.35,
  SK: 1.3,
  AT: 1.4,
  LT: 1.7,
  LV: 1.75,
  EE: 1.8,
  IT: 1.9,
  ES: 2.05,
  FR: 1.95,
  RO: 1.45,
  NL: 1.75,
  GB: 2.2,
  MD: 1.6,
  UA: 1.5,
};

const MODE_FACTOR = { branch: 1, locker: 1.08, address: 1.14 };

function buildCostMatrix() {
  const costs = {};
  for (const mode of DELIVERY_MODES) {
    costs[mode] = {};
    for (const row of WEIGHT_ROWS) {
      costs[mode][row.key] = {};
      for (const dest of DESTINATIONS) {
        const base = 1600 + row.avgKg * 280;
        const value = Math.round(base * MODE_FACTOR[mode] * DEST_FACTOR[dest]);
        costs[mode][row.key][dest] = value;
      }
    }
  }
  return costs;
}

function defaultSettings() {
  return {
    vatEnabled: true,
    vatPercent: 27,
    roundingEnabled: true,
    roundingStep: 10,
    currency: 'HUF',
    fxFromEur: { EUR: 1, HUF: 400, PLN: 4.3, CZK: 25, RON: 5 },
    fragileFeeEur: 1.98,
    insurancePercent: 1,
    updatedAt: new Date().toISOString(),
  };
}

function defaultPricing() {
  return {
    version: 1,
    destinations: DESTINATIONS,
    weightRows: WEIGHT_ROWS,
    costPrices: buildCostMatrix(),
    // Cost matrix already embeds destination/mode factors (see buildCostMatrix).
    // Extra weight markups here double-count margin and inflate B2C far above Excel/NP.
    weightMarkups: [
      { upToKg: 1, percent: 0 },
      { upToKg: 2, percent: 0 },
      { upToKg: 5, percent: 0 },
      { upToKg: 10, percent: 0 },
      { upToKg: 20, percent: 0 },
      { upToKg: 999, percent: 0 },
    ],
    tiers: [
      { id: 'start', label: 'Bronze', minShipments: 1, maxShipments: 19, discountPercent: 0 },
      { id: 'active', label: 'Copper', minShipments: 20, maxShipments: 49, discountPercent: 7 },
      { id: 'pro', label: 'Silver', minShipments: 50, maxShipments: 99, discountPercent: 15 },
      { id: 'maximum', label: 'Gold', minShipments: 100, maxShipments: 249, discountPercent: 22 },
      { id: 'individual', label: 'Platinum', minShipments: 250, maxShipments: null, discountPercent: null },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function mapSettingsRow(row) {
  const defaults = defaultSettings();
  if (!row) return defaults;
  return {
    vatEnabled: row.vatEnabled,
    vatPercent: row.vatPercent,
    roundingEnabled: row.roundingEnabled,
    roundingStep: row.roundingStep,
    currency: row.currency,
    fxFromEur: row.fxFromEur || defaults.fxFromEur,
    fragileFeeEur: row.fragileFeeEur,
    insurancePercent: row.insurancePercent,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

/** Fill missing high-weight cells so XXL (100 kg) does not reuse the 30 kg tier. */
function fillMissingWeightCosts(costPrices, fallbackCosts = buildCostMatrix()) {
  const next = { ...(costPrices || {}) };
  for (const mode of DELIVERY_MODES) {
    next[mode] = { ...(next[mode] || {}) };
    for (const row of WEIGHT_ROWS) {
      if (next[mode][row.key]) continue;
      if (fallbackCosts?.[mode]?.[row.key]) {
        next[mode][row.key] = { ...fallbackCosts[mode][row.key] };
        continue;
      }
      const base30 = next[mode]['30'] || {};
      next[mode][row.key] = {};
      for (const dest of DESTINATIONS) {
        const sample = base30[dest];
        next[mode][row.key][dest] = sample != null
          ? Math.round(Number(sample) * (row.avgKg / 27.5))
          : Math.round((1600 + row.avgKg * 280) * MODE_FACTOR[mode] * (DEST_FACTOR[dest] || 1.5));
      }
    }
  }
  return next;
}

function mergeWeightRows(existing) {
  const byKey = new Map((existing || []).map((row) => [row.key, row]));
  for (const row of WEIGHT_ROWS) {
    if (!byKey.has(row.key)) byKey.set(row.key, row);
  }
  return WEIGHT_ROWS.map((row) => byKey.get(row.key) || row);
}

function mapPricingRow(row) {
  const defaults = defaultPricing();
  if (!row) return defaults;
  return {
    version: row.version ?? defaults.version,
    destinations: row.destinations || DESTINATIONS,
    weightRows: mergeWeightRows(row.weightRows || defaults.weightRows),
    costPrices: fillMissingWeightCosts(row.costPrices || defaults.costPrices, defaults.costPrices),
    weightMarkups: row.weightMarkups || defaults.weightMarkups,
    tiers: row.tiers || defaults.tiers,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

async function readJsonFile(name, fallback = null) {
  try {
    const raw = await readFile(path.join(DATA_DIR, name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Prefer checked-in JSON tariffs over generated matrix (legacy JSON store). */
async function jsonSeedPricing() {
  const fromFile = await readJsonFile('pricing.json', null);
  if (fromFile?.costPrices) {
    return {
      version: fromFile.version || 1,
      destinations: fromFile.destinations || DESTINATIONS,
      weightRows: mergeWeightRows(fromFile.weightRows || WEIGHT_ROWS),
      costPrices: fillMissingWeightCosts(fromFile.costPrices),
      weightMarkups: fromFile.weightMarkups || defaultPricing().weightMarkups,
      tiers: fromFile.tiers || defaultPricing().tiers,
    };
  }
  return defaultPricing();
}

async function jsonSeedSettings() {
  const fromFile = await readJsonFile('settings.json', null);
  if (fromFile) {
    return {
      ...defaultSettings(),
      ...fromFile,
      fxFromEur: { ...defaultSettings().fxFromEur, ...(fromFile.fxFromEur || {}) },
    };
  }
  return defaultSettings();
}

function looksLikeGeneratedPricing(pricing) {
  if (!pricing?.costPrices) return true;
  const markups = pricing.weightMarkups || [];
  const allZeroMarkup = markups.length === 0 || markups.every((m) => !Number(m.percent));
  const generated = buildCostMatrix();
  const sample = pricing.costPrices?.locker?.['2']?.DE;
  const generatedSample = generated.locker?.['2']?.DE;
  return allZeroMarkup && sample === generatedSample;
}

function needsJsonResync(pricing, jsonPricing) {
  if (!jsonPricing?.costPrices) return false;
  if (looksLikeGeneratedPricing(pricing)) return true;
  const dbZero = !(pricing.weightMarkups || []).some((m) => Number(m.percent) > 0);
  const jsonHasMarkup = (jsonPricing.weightMarkups || []).some((m) => Number(m.percent) > 0);
  // Costs imported from JSON but markups wiped to 0% → restore full JSON tariffs
  if (dbZero && jsonHasMarkup) {
    const dbSample = pricing.costPrices?.locker?.['2']?.DE;
    const jsonSample = jsonPricing.costPrices?.locker?.['2']?.DE;
    if (dbSample === jsonSample) return true;
  }
  return false;
}

function needsHighWeightMerge(pricing) {
  return !pricing?.costPrices?.locker?.['100'];
}

export async function ensurePricingDefaults() {
  const settingsSeed = await jsonSeedSettings();
  await prisma.appSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      vatEnabled: settingsSeed.vatEnabled,
      vatPercent: settingsSeed.vatPercent,
      roundingEnabled: settingsSeed.roundingEnabled,
      roundingStep: settingsSeed.roundingStep,
      currency: settingsSeed.currency,
      fxFromEur: settingsSeed.fxFromEur,
      fragileFeeEur: settingsSeed.fragileFeeEur,
      insurancePercent: settingsSeed.insurancePercent,
    },
    update: {},
  });

  const pricingSeed = await jsonSeedPricing();
  await prisma.pricingConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      version: pricingSeed.version,
      destinations: pricingSeed.destinations,
      weightRows: pricingSeed.weightRows,
      costPrices: pricingSeed.costPrices,
      weightMarkups: pricingSeed.weightMarkups,
      tiers: pricingSeed.tiers,
    },
    update: {},
  });
}

/**
 * If PG was seeded with empty generated defaults (0% markups), restore tariffs from JSON.
 * Does not overwrite admin-edited matrices that already match JSON / custom markups.
 */
export async function syncPricingFromJsonIfNeeded() {
  await ensurePricingDefaults();
  const force = String(process.env.PRICING_SYNC_FROM_JSON || '').toLowerCase() === 'true';
  const seed = await jsonSeedPricing();
  const raw = await prisma.pricingConfig.findUnique({ where: { id: 1 } });
  let current = mapPricingRow(raw);
  if (force || needsJsonResync(current, seed)) {
    const settingsSeed = await jsonSeedSettings();
    await prisma.pricingConfig.update({
      where: { id: 1 },
      data: {
        version: seed.version,
        destinations: seed.destinations,
        weightRows: seed.weightRows,
        costPrices: seed.costPrices,
        weightMarkups: seed.weightMarkups,
        tiers: seed.tiers,
      },
    });
    if (force) {
      await prisma.appSettings.update({
        where: { id: 1 },
        data: {
          vatEnabled: settingsSeed.vatEnabled,
          vatPercent: settingsSeed.vatPercent,
          roundingEnabled: settingsSeed.roundingEnabled,
          roundingStep: settingsSeed.roundingStep,
          currency: settingsSeed.currency,
          fxFromEur: settingsSeed.fxFromEur,
          fragileFeeEur: settingsSeed.fragileFeeEur,
          insurancePercent: settingsSeed.insurancePercent,
        },
      });
    }
    console.log(`[pricing] synced matrix from JSON (force=${force})`);
    current = mapPricingRow(await prisma.pricingConfig.findUnique({ where: { id: 1 } }));
  } else if (needsHighWeightMerge({ costPrices: raw?.costPrices || {} })) {
    const mergedCosts = fillMissingWeightCosts(raw?.costPrices || {}, seed.costPrices);
    const mergedRows = mergeWeightRows(raw?.weightRows || []);
    await prisma.pricingConfig.update({
      where: { id: 1 },
      data: {
        weightRows: mergedRows,
        costPrices: mergedCosts,
      },
    });
    console.log('[pricing] merged high-weight tiers (40–100 kg) into matrix');
    current = mapPricingRow(await prisma.pricingConfig.findUnique({ where: { id: 1 } }));
  }
  return current;
}

/**
 * Fragile = fixed EUR fee + VAT.
 * Insurance = insurancePercent of delivery tariff (already client-facing / with VAT).
 * Matches calculator UX: "1% от суммы доставки".
 */
export function computeOrderExtras(baseAmount, { fragile = false, insurance = false } = {}, settings) {
  const currency = String(settings?.currency || 'HUF').toUpperCase();
  const fx = settings?.fxFromEur || {};
  const base = Number(baseAmount) || 0;
  let fragileFee = 0;
  let insuranceFee = 0;

  if (fragile) {
    const fee = eurToCurrency(settings?.fragileFeeEur ?? 1.98, currency, fx);
    fragileFee = roundAmount(applyVat(fee, settings), settings);
  }
  if (insurance) {
    const pct = Number(settings?.insurancePercent ?? 1) / 100;
    insuranceFee = roundAmount(base * pct, settings);
  }

  const total = roundAmount(base + fragileFee + insuranceFee, settings);
  return {
    base,
    fragileFee,
    insuranceFee,
    insurancePercent: Number(settings?.insurancePercent ?? 1),
    total,
    currency,
  };
}

export async function getSettings() {
  await ensurePricingDefaults();
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  return mapSettingsRow(row);
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
  };
  if (patch.fxFromEur) next.fxFromEur = { ...current.fxFromEur, ...patch.fxFromEur };

  const row = await prisma.appSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      vatEnabled: next.vatEnabled,
      vatPercent: next.vatPercent,
      roundingEnabled: next.roundingEnabled,
      roundingStep: next.roundingStep,
      currency: next.currency,
      fxFromEur: next.fxFromEur,
      fragileFeeEur: next.fragileFeeEur,
      insurancePercent: next.insurancePercent,
    },
    update: {
      vatEnabled: next.vatEnabled,
      vatPercent: next.vatPercent,
      roundingEnabled: next.roundingEnabled,
      roundingStep: next.roundingStep,
      currency: next.currency,
      fxFromEur: next.fxFromEur,
      fragileFeeEur: next.fragileFeeEur,
      insurancePercent: next.insurancePercent,
    },
  });
  return mapSettingsRow(row);
}

export async function getPricing() {
  await ensurePricingDefaults();
  const row = await prisma.pricingConfig.findUnique({ where: { id: 1 } });
  return mapPricingRow(row);
}

export async function savePricing(patch) {
  const current = await getPricing();
  const next = {
    ...current,
    ...patch,
  };

  const row = await prisma.pricingConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      version: next.version || 1,
      destinations: next.destinations || DESTINATIONS,
      weightRows: next.weightRows || WEIGHT_ROWS,
      costPrices: next.costPrices || {},
      weightMarkups: next.weightMarkups || [],
      tiers: next.tiers || [],
    },
    update: {
      version: next.version || 1,
      destinations: next.destinations || DESTINATIONS,
      weightRows: next.weightRows || WEIGHT_ROWS,
      costPrices: next.costPrices || {},
      weightMarkups: next.weightMarkups || [],
      tiers: next.tiers || [],
    },
  });
  return mapPricingRow(row);
}

export function weightKeyForKg(weightKg) {
  const w = Number(weightKg) || 0;
  for (const row of WEIGHT_ROWS) {
    if (w <= row.maxKg) return row.key;
  }
  return WEIGHT_ROWS[WEIGHT_ROWS.length - 1].key;
}

export function markupPercentForWeight(weightMarkups, weightKg) {
  const w = Number(weightKg) || 0;
  const list = weightMarkups || [];
  for (const row of list) {
    if (w <= row.upToKg) return Number(row.percent) || 0;
  }
  return list.length ? Number(list[list.length - 1].percent) || 0 : 0;
}

export function tierForShipments(tiers, count) {
  const n = Number(count) || 0;
  const list = tiers || [];
  for (const t of list) {
    const max = t.maxShipments == null ? Infinity : t.maxShipments;
    if (n >= t.minShipments && n <= max) return t;
  }
  return list[0] || { id: 'start', discountPercent: 0 };
}

export function destCodeFromCountry(toCountry) {
  const code = String(toCountry || '').toUpperCase();
  if (!code || code === 'HU') return 'DOM';
  return code;
}

export function roundAmount(amount, settings) {
  const n = Number(amount) || 0;
  if (!settings?.roundingEnabled) {
    return settings?.currency === 'HUF' ? Math.round(n) : Math.round(n * 100) / 100;
  }
  const step = Number(settings.roundingStep) || 10;
  return Math.round(n / step) * step;
}

export function applyVat(amount, settings) {
  const n = Number(amount) || 0;
  if (!settings?.vatEnabled) return n;
  const pct = Number(settings.vatPercent) || 0;
  return n * (1 + pct / 100);
}

/**
 * B2C price from matrix cost (+ optional weight markup / tier discount) + VAT + rounding.
 * Matrix cells = net tariff (as in Excel / Nova Post aligned rates, без НДС).
 * Client price = matrix × weight markup × (1 − tier discount) + VAT + rounding.
 * Falls back to null if cell missing (caller may use NP quote).
 */
export async function calculateMatePrice({
  toCountry,
  weightKg,
  deliveryMode = 'locker',
  monthlyShipments = 1,
}) {
  const [settings, pricing] = await Promise.all([getSettings(), getPricing()]);
  const mode = DELIVERY_MODES.includes(deliveryMode) ? deliveryMode : 'locker';
  const dest = destCodeFromCountry(toCountry);
  const wKey = weightKeyForKg(weightKg);
  const cost = pricing.costPrices?.[mode]?.[wKey]?.[dest];
  if (cost == null || !Number.isFinite(Number(cost))) {
    return { amount: null, currency: settings.currency, breakdown: null, settings, pricing };
  }

  const markupPct = markupPercentForWeight(pricing.weightMarkups, weightKg);
  const tier = tierForShipments(pricing.tiers, monthlyShipments);
  const discountPct = Number(tier.discountPercent) || 0;

  const costNum = Number(cost);
  let amount = costNum;
  const afterMarkup = amount * (1 + markupPct / 100);
  amount = afterMarkup;
  const afterDiscount = amount * (1 - discountPct / 100);
  amount = afterDiscount;
  const beforeVat = amount;
  const afterVat = applyVat(amount, settings);
  amount = afterVat;
  amount = roundAmount(amount, settings);

  const modeLabel = mode === 'branch' ? 'филиал' : mode === 'address' ? 'адрес' : 'постамат';
  const log = [
    {
      step: 1,
      title: 'Цена из матрицы (без НДС)',
      detail: `${modeLabel} · направление ${dest} · вес ≤ ${wKey} кг`,
      value: costNum,
    },
  ];
  if (markupPct) {
    log.push({
      step: log.length + 1,
      title: `Наценка по весу +${markupPct}%`,
      detail: `${costNum} × ${(1 + markupPct / 100).toFixed(2)}`,
      value: Math.round(afterMarkup * 100) / 100,
    });
  } else {
    log.push({
      step: log.length + 1,
      title: 'Наценка по весу',
      detail: '0% (уже учтено в матрице)',
      value: costNum,
    });
  }
  if (discountPct) {
    log.push({
      step: log.length + 1,
      title: `Скидка уровня «${tier.label || tier.id}» −${discountPct}%`,
      detail: `отправок/мес: ${monthlyShipments}`,
      value: Math.round(afterDiscount * 100) / 100,
    });
  } else {
    log.push({
      step: log.length + 1,
      title: `Уровень «${tier.label || tier.id}»`,
      detail: 'скидка 0%',
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
  } else {
    log.push({
      step: log.length + 1,
      title: 'НДС',
      detail: 'выключен',
      value: Math.round(beforeVat * 100) / 100,
    });
  }
  if (settings?.roundingEnabled) {
    log.push({
      step: log.length + 1,
      title: `Округление до ${settings.roundingStep}`,
      detail: `→ итог`,
      value: amount,
    });
  }
  log.push({
    step: log.length + 1,
    title: 'Итого для клиента',
    detail: settings.currency || 'HUF',
    value: amount,
  });

  return {
    amount,
    currency: settings.currency || 'HUF',
    settings,
    pricing,
    breakdown: {
      cost: costNum,
      mode,
      dest,
      weightKg: Number(weightKg) || 0,
      weightKey: wKey,
      markupPercent: markupPct,
      tierId: tier.id,
      tierLabel: tier.label || tier.id,
      discountPercent: discountPct,
      beforeVat: Math.round(beforeVat * 100) / 100,
      afterVat: Math.round(afterVat * 100) / 100,
      vatEnabled: Boolean(settings.vatEnabled),
      vatPercent: settings.vatPercent,
      roundingEnabled: Boolean(settings.roundingEnabled),
      roundingStep: settings.roundingStep,
      total: amount,
      currency: settings.currency || 'HUF',
      source: 'mate-matrix',
      log,
    },
  };
}

export function eurToCurrency(amountEur, currencyCode, fxFromEur) {
  const code = String(currencyCode || 'EUR').toUpperCase();
  if (!Number.isFinite(amountEur) || amountEur === 0) return 0;
  if (code === 'EUR') return amountEur;
  const rate = (fxFromEur || {})[code];
  if (!rate) return 0;
  return amountEur * rate;
}

/** Convert quote amount into settings currency (via EUR if needed). */
export function convertToSettingsCurrency(amount, fromCurrency, settings) {
  const n = Number(amount) || 0;
  const from = String(fromCurrency || 'EUR').toUpperCase();
  const to = String(settings?.currency || 'HUF').toUpperCase();
  const fx = settings?.fxFromEur || {};
  if (from === to) return n;
  let inEur = n;
  if (from !== 'EUR') {
    const rate = Number(fx[from]);
    if (!rate) return n;
    inEur = n / rate;
  }
  return eurToCurrency(inEur, to, fx);
}

/**
 * Live NP (or estimate) quote → client-facing amount in settings currency + VAT + rounding.
 */
export function finalizeExternalQuote(total, quoteCurrency, settings, source = 'novapost') {
  const currency = String(settings?.currency || 'HUF').toUpperCase();
  const converted = convertToSettingsCurrency(total, quoteCurrency, settings);
  const beforeVat = converted;
  const afterVat = applyVat(converted, settings);
  const amount = roundAmount(afterVat, settings);
  const log = [
    {
      step: 1,
      title: source === 'novapost' ? 'Тариф Nova Post' : 'Оценка Nova Post',
      detail: `${Math.round(Number(total) * 100) / 100} ${String(quoteCurrency || 'EUR').toUpperCase()}`,
      value: Math.round(beforeVat * 100) / 100,
    },
  ];
  if (settings?.vatEnabled) {
    log.push({
      step: 2,
      title: `НДС +${settings.vatPercent}%`,
      detail: `${Math.round(beforeVat * 100) / 100} × ${(1 + Number(settings.vatPercent) / 100).toFixed(2)}`,
      value: Math.round(afterVat * 100) / 100,
    });
  }
  if (settings?.roundingEnabled) {
    log.push({
      step: log.length + 1,
      title: `Округление до ${settings.roundingStep}`,
      detail: '→ итог',
      value: amount,
    });
  }
  log.push({
    step: log.length + 1,
    title: 'Итого для клиента',
    detail: currency,
    value: amount,
  });
  return {
    amount,
    currency,
    breakdown: {
      total: amount,
      currency,
      source,
      beforeVat: Math.round(beforeVat * 100) / 100,
      afterVat: Math.round(afterVat * 100) / 100,
      log,
    },
  };
}
