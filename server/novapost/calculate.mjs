import {
  getNovaPostDivisionId,
  getNovaPostJwt,
  isNovaPostMock,
  markNovaPostUnavailable,
  novaPostFetchJson,
  novaPostAuthHeader,
} from './client.mjs';
import {
  normalizeParcelDimensionsMm,
  resolveParcelLimits,
  validateParcelDimensionsCm,
} from './parcel.mjs';

const CURRENCY_SYMBOLS = { EUR: 'EUR', PLN: 'PLN', USD: 'USD', UAH: 'UAH' };

function normalizeCountryCode(value) {
  const s = String(value || '').trim().toUpperCase();
  if (s.length === 2) return s;
  const map = {
    ВЕНГРИЯ: 'HU', HUNGARY: 'HU', HU: 'HU',
    ПОЛЬША: 'PL', POLAND: 'PL', PL: 'PL',
    ГЕРМАНИЯ: 'DE', GERMANY: 'DE', DE: 'DE',
    ФРАНЦИЯ: 'FR', FRANCE: 'FR', FR: 'FR',
    ИСПАНИЯ: 'ES', SPAIN: 'ES', ES: 'ES',
    ИТАЛИЯ: 'IT', ITALY: 'IT', IT: 'IT',
    ЧЕХИЯ: 'CZ', CZECH: 'CZ', CZ: 'CZ',
    РУМЫНИЯ: 'RO', ROMANIA: 'RO', RO: 'RO',
    СЛОВАКИЯ: 'SK', SLOVAKIA: 'SK', SK: 'SK',
    УКРАИНА: 'UA', UKRAINE: 'UA', UA: 'UA',
    ЛИТВА: 'LT', LITHUANIA: 'LT', LT: 'LT',
    ЛАТВИЯ: 'LV', LATVIA: 'LV', LV: 'LV',
    ЭСТОНИЯ: 'EE', ESTONIA: 'EE', EE: 'EE',
    НИДЕРЛАНДЫ: 'NL', NETHERLANDS: 'NL', NL: 'NL',
    ВЕЛИКОБРИТАНИЯ: 'GB', 'UNITED KINGDOM': 'GB', GB: 'GB',
    МОЛДОВА: 'MD', MOLDOVA: 'MD', MD: 'MD',
  };
  return map[s] || s.slice(0, 2);
}

export function calculateMock(input) {
  const weightKg = Math.max(0.1, Number(input.weightKg) || 1);
  const lengthCm = Math.max(1, Number(input.lengthCm) || 30);
  const widthCm = Math.max(1, Number(input.widthCm) || 20);
  const heightCm = Math.max(1, Number(input.heightCm) || 15);
  const limits = resolveParcelLimits(lengthCm, widthCm, heightCm, weightKg, input.boxSize);
  const volumetricKg = (lengthCm * widthCm * heightCm) / 5000;
  const chargeableKg = Math.max(weightKg, Math.min(volumetricKg, limits.maxWeightKg));
  const base = 12;
  const perKg = 2.1;
  const delivery = Math.round((base + chargeableKg * perKg) * 100) / 100;
  return {
    total: delivery,
    currency: { code: 'EUR', symbol: 'EUR' },
    breakdown: [{ item: 'Delivery service (mock)', total: delivery, currencyCode: 'EUR' }],
    priceSource: 'mock',
  };
}

function validateParcelInput(input) {
  const lengthCm = Math.max(1, Number(input.lengthCm) || 30);
  const widthCm = Math.max(1, Number(input.widthCm) || 20);
  const heightCm = Math.max(1, Number(input.heightCm) || 15);
  const weightKg = Math.max(0.1, Number(input.weightKg) || 1);
  const limits = resolveParcelLimits(lengthCm, widthCm, heightCm, weightKg, input.boxSize);
  const dimError = validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits);
  if (dimError) throw new Error(dimError);
  if (weightKg > limits.maxWeightKg) {
    throw new Error(`Weight ${weightKg} kg exceeds limit ${limits.maxWeightKg} kg`);
  }
}

function normalizeQuoteParty(location, fallbackCountryCode, fallbackDivisionId) {
  const countryCode = normalizeCountryCode(location?.countryCode || fallbackCountryCode);
  if (location?.kind === 'division') {
    const divisionId = Number(location.divisionId);
    if (!Number.isInteger(divisionId) || divisionId <= 0) {
      throw new Error(`Invalid Nova Post division ID for ${countryCode}`);
    }
    return { countryCode, divisionId };
  }
  if (location?.kind === 'address') {
    const source = location.addressParts || {};
    const addressParts = {
      city: String(source.city || '').trim(),
      street: String(source.street || '').trim(),
      postCode: String(source.postCode || '').trim(),
      building: String(source.building || '').trim(),
    };
    if (!addressParts.city || !addressParts.street || !addressParts.postCode || !addressParts.building) {
      throw new Error(`Incomplete courier address for ${countryCode}`);
    }
    for (const key of ['region', 'flat', 'block', 'note']) {
      const value = String(source[key] || '').trim();
      if (value) addressParts[key] = value;
    }
    return { countryCode, addressParts };
  }
  return { countryCode, divisionId: fallbackDivisionId };
}

async function calculateWithSession(jwt, fromCountryCode, toCountryCode, fromDivisionId, toDivisionId, input) {
  const lengthCm = Math.max(1, Number(input.lengthCm) || 30);
  const widthCm = Math.max(1, Number(input.widthCm) || 20);
  const heightCm = Math.max(1, Number(input.heightCm) || 15);
  const insuranceCost = Math.max(1, Math.round(Number(input.declaredValue ?? 100)));
  const dims = normalizeParcelDimensionsMm(lengthCm, widthCm, heightCm);

  const payload = {
    payerType: input.payerType === 'Recipient' ? 'Recipient' : 'Sender',
    parcels: [{
      rowNumber: 1,
      cargoCategory: 'parcel',
      parcelDescription: 'Calculation request',
      insuranceCost,
      length: dims.length,
      width: dims.width,
      height: dims.height,
      actualWeight: Math.max(1, Math.round(input.weightKg * 1000)),
    }],
    sender: {
      ...normalizeQuoteParty(input.pickupLocation, fromCountryCode, fromDivisionId),
      name: 'Mate Sender',
      phone: '380991111111',
      email: 'sender@example.com',
    },
    recipient: {
      ...normalizeQuoteParty(input.deliveryLocation, toCountryCode, toDivisionId),
      name: 'Mate Recipient',
      phone: '491111111111',
      email: 'recipient@example.com',
    },
  };

  const response = await novaPostFetchJson('/shipments/calculations', {
    method: 'POST',
    headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
    body: payload,
  });

  const services = response.services ?? [];
  if (!services.length) throw new Error('Nova Post returned empty calculation response');

  const total = services.reduce((sum, s) => sum + Number(s.cost ?? 0), 0);
  const currencyCode = services[0]?.currencyCode ?? 'EUR';

  return {
    total: Math.round(total * 100) / 100,
    currency: { code: currencyCode, symbol: CURRENCY_SYMBOLS[currencyCode] ?? currencyCode },
    breakdown: services.map((s) => ({
      item: s.serviceName || 'Delivery',
      total: Number(s.cost ?? 0),
      currencyCode: s.currencyCode ?? currencyCode,
    })),
    priceSource: 'novapost',
  };
}

const quoteCache = new Map();
const QUOTE_CACHE_MS = Number(process.env.NOVAPOST_QUOTE_CACHE_MS ?? 15 * 60 * 1000);

function quoteLocationKey(location) {
  if (location?.kind === 'division') return `division:${location.countryCode}:${location.divisionId}`;
  if (location?.kind === 'address') {
    const p = location.addressParts || {};
    return `address:${location.countryCode}:${p.city}:${p.street}:${p.building}:${p.postCode}`;
  }
  return 'default';
}

function quoteCacheKey(fromCode, toCode, declaredValue, input) {
  return [
    fromCode,
    toCode,
    declaredValue,
    input.boxSize,
    input.weightKg,
    `${input.lengthCm}x${input.widthCm}x${input.heightCm}`,
    input.payerType || 'Sender',
    quoteLocationKey(input.pickupLocation),
    quoteLocationKey(input.deliveryLocation),
  ].join(':');
}

function getCachedQuote(key) {
  const row = quoteCache.get(key);
  if (!row) return null;
  if (Date.now() - row.at > QUOTE_CACHE_MS) {
    quoteCache.delete(key);
    return null;
  }
  return row.value;
}

function setCachedQuote(key, value) {
  quoteCache.set(key, { at: Date.now(), value });
}

export async function calculateBatch({
  fromCountry,
  toCountry,
  declaredValue,
  sizes,
  pickupLocation,
  deliveryLocation,
  payerType,
}) {
  const fromCode = normalizeCountryCode(fromCountry);
  const toCode = normalizeCountryCode(toCountry);
  const inputs = (sizes || []).map((s) => ({
    fromCountry: fromCode,
    toCountry: toCode,
    weightKg: s.weightKg,
    lengthCm: s.lengthCm,
    widthCm: s.widthCm,
    heightCm: s.heightCm,
    declaredValue: declaredValue ?? 100,
    boxSize: s.boxSize,
    pickupLocation,
    deliveryLocation,
    payerType,
  }));

  for (const input of inputs) validateParcelInput(input);

  if (isNovaPostMock()) {
    const quotes = {};
    for (const input of inputs) {
      const key = String(input.boxSize || 'parcel');
      quotes[key] = calculateMock(input);
    }
    return { quotes, currency: { code: 'EUR', symbol: 'EUR' }, priceSource: 'mock' };
  }

  try {
    const jwt = await getNovaPostJwt();
    const [fromDivisionId, toDivisionId] = await Promise.all([
      getNovaPostDivisionId(jwt, fromCode),
      getNovaPostDivisionId(jwt, toCode),
    ]);

    const quotes = {};
    let currency = { code: 'EUR', symbol: 'EUR' };

    const pending = [];
    for (const input of inputs) {
      const key = String(input.boxSize || 'parcel');
      const cacheKey = quoteCacheKey(fromCode, toCode, declaredValue ?? 100, input);
      const cached = getCachedQuote(cacheKey);
      if (cached) {
        quotes[key] = cached;
        currency = cached.currency ?? currency;
      } else {
        pending.push({ key, input, cacheKey });
      }
    }

    if (pending.length) {
      const entries = await Promise.all(
        pending.map(async ({ key, input, cacheKey }) => {
          const result = await calculateWithSession(jwt, fromCode, toCode, fromDivisionId, toDivisionId, input);
          setCachedQuote(cacheKey, result);
          return [key, result];
        }),
      );
      for (const [key, result] of entries) {
        quotes[key] = result;
        currency = result.currency;
      }
    }

    return { quotes, currency, priceSource: 'novapost' };
  } catch (err) {
    markNovaPostUnavailable();
    console.warn('[novapost] calculateBatch fallback to estimate:', err?.message || err);
    const quotes = {};
    for (const input of inputs) {
      const key = String(input.boxSize || 'parcel');
      quotes[key] = calculateMock(input);
    }
    return { quotes, currency: { code: 'EUR', symbol: 'EUR' }, priceSource: 'estimate' };
  }
}

export async function calculateSingle(input) {
  const fromCode = normalizeCountryCode(input.fromCountry);
  const toCode = normalizeCountryCode(input.toCountry);
  const normalized = { ...input, fromCountry: fromCode, toCountry: toCode };
  validateParcelInput(normalized);

  if (isNovaPostMock()) return calculateMock(normalized);

  const cacheKey = quoteCacheKey(fromCode, toCode, normalized.declaredValue ?? 100, normalized);
  const cached = getCachedQuote(cacheKey);
  if (cached) return cached;

  try {
    const jwt = await getNovaPostJwt();
    const [fromDivisionId, toDivisionId] = await Promise.all([
      getNovaPostDivisionId(jwt, fromCode),
      getNovaPostDivisionId(jwt, toCode),
    ]);
    const result = await calculateWithSession(jwt, fromCode, toCode, fromDivisionId, toDivisionId, normalized);
    setCachedQuote(cacheKey, result);
    return result;
  } catch (err) {
    markNovaPostUnavailable();
    console.warn('[novapost] calculateSingle fallback to estimate:', err?.message || err);
    return calculateMock(normalized);
  }
}

export { normalizeCountryCode };
