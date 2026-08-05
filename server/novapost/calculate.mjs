import {
  getNovaPostContractConfig,
  getNovaPostDivisionId,
  getNovaPostJwt,
  isNovaPostMock,
  novaPostFetchJson,
  novaPostAuthHeader,
} from './client.mjs';
import {
  normalizeParcelDimensionsMm,
  resolveParcelLimits,
  validateNovaPostParcelRules,
  validateParcelDimensionsCm,
} from './parcel.mjs';

const CURRENCY_SYMBOLS = { EUR: 'EUR', PLN: 'PLN', USD: 'USD', UAH: 'UAH', HUF: 'HUF' };

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
  const isDocuments = String(input.boxSize || '').toUpperCase() === 'XS';
  const volumetricKg = (lengthCm * widthCm * heightCm) / 4000;
  const chargeableKg = isDocuments
    ? weightKg
    : Math.max(weightKg, Math.min(volumetricKg, limits.maxWeightKg));
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

  // Courier-only “label fits” minimum: 5 × 15 × 15 cm (order-independent).
  // Nova Post will reject smaller faces for custom items, so we fail early on our side too.
  const isCustom = String(input.boxSize || '').toUpperCase().startsWith('CUSTOM');
  if (isCustom) {
    const sidesAsc = [lengthCm, widthCm, heightCm]
      .map((cm) => Math.max(0, Number(cm) || 0))
      .sort((a, b) => a - b);
    const minSmall = 5;
    const minMid = 15;
    if (sidesAsc[0] < minSmall || sidesAsc[1] < minMid) {
      throw new Error('Minimum face size is 5 × 15 × 15 cm (label must fit).');
    }
  }

  if (weightKg > limits.maxWeightKg) {
    throw new Error(`Weight ${weightKg} kg exceeds limit ${limits.maxWeightKg} kg`);
  }

  // Official Nova Post parcel rules for every quote (docs: ≤30 kg, side ≤120, sum ≤150).
  const isDocuments = ['XS', 'ENVELOPE', 'DOCUMENTS'].includes(String(input.boxSize || '').toUpperCase());
  if (!isDocuments) {
    const npErr = validateNovaPostParcelRules(lengthCm, widthCm, heightCm, weightKg);
    if (npErr) throw new Error(npErr);
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
  const isDocuments = ['XS', 'ENVELOPE', 'DOCUMENTS'].includes(String(input.boxSize || '').toUpperCase());
  // Documents must go to NP as a real envelope. Placeholder 1x1x1 cm gets parcel-like tariffs.
  const lengthCm = isDocuments ? 35 : Math.max(1, Number(input.lengthCm) || 30);
  const widthCm = isDocuments ? 25 : Math.max(1, Number(input.widthCm) || 20);
  const heightCm = isDocuments ? 2 : Math.max(1, Number(input.heightCm) || 15);
  // my.novapost UI allows empty declared; API requires insuranceCost > 0.
  const declaredRaw = Number(input.declaredValue);
  const insuranceCost = Number.isFinite(declaredRaw) && declaredRaw > 0
    ? Math.round(declaredRaw)
    : 1;
  const dims = normalizeParcelDimensionsMm(lengthCm, widthCm, heightCm);
  const weightKg = Math.max(0.1, Number(input.weightKg) || (isDocuments ? 0.2 : 1));

  // Same contract path as my.novapost "Legal entity" + GNPHU.
  const { payerContractNumber, companyTin, companyName } = getNovaPostContractConfig();

  const sender = {
    ...normalizeQuoteParty(input.pickupLocation, fromCountryCode, fromDivisionId),
    name: companyName,
    phone: '36701234567',
    email: 'ops@matedelivery.com',
  };
  if (payerContractNumber && companyTin) {
    sender.companyTin = companyTin;
    sender.companyName = companyName;
  }

  const payload = {
    payerType: input.payerType === 'Recipient'
      ? 'Recipient'
      : input.payerType === 'ThirdPerson'
        ? 'ThirdPerson'
        : 'Sender',
    ...(payerContractNumber ? { payerContractNumber } : {}),
    parcels: [{
      rowNumber: 1,
      cargoCategory: isDocuments ? 'documents' : 'parcel',
      parcelDescription: isDocuments ? 'Documents' : 'Calculation request',
      insuranceCost: Math.max(1, insuranceCost),
      length: dims.length,
      width: dims.width,
      height: dims.height,
      actualWeight: Math.max(1, Math.round(weightKg * 1000)),
    }],
    sender,
    recipient: {
      ...normalizeQuoteParty(input.deliveryLocation, toCountryCode, toDivisionId),
      name: 'Mate Recipient',
      phone: '420111111111',
      email: 'recipient@example.com',
    },
  };

  const response = await fetchCalculationsWithRetry(jwt, payload);

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
    meta: {
      payerContractNumber: payerContractNumber || null,
      usedCompanySender: Boolean(sender.companyTin),
    },
  };
}

async function fetchCalculationsWithRetry(jwt, payload, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await novaPostFetchJson('/shipments/calculations', {
        method: 'POST',
        headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
        body: payload,
      });
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const retryable = /\b(403|429|502|503|504)\b/.test(msg) || /transport error/i.test(msg);
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
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
  const { payerContractNumber } = getNovaPostContractConfig();
  return [
    'v3',
    payerContractNumber || 'none',
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

  // Per-size validation so one bad CUSTOM dims doesn't 500 the whole batch.
  const validInputs = [];
  const quotes = {};
  const errors = {};
  for (const input of inputs) {
    const key = String(input.boxSize || 'parcel');
    try {
      validateParcelInput(input);
      validInputs.push(input);
    } catch (err) {
      errors[key] = err?.message || String(err);
    }
  }

  if (isNovaPostMock()) {
    for (const input of validInputs) {
      const key = String(input.boxSize || 'parcel');
      quotes[key] = calculateMock(input);
    }
    return { quotes, errors, currency: { code: 'EUR', symbol: 'EUR' }, priceSource: 'mock' };
  }

  if (!validInputs.length) {
    return { quotes, errors, currency: { code: 'EUR', symbol: 'EUR' }, priceSource: 'novapost' };
  }

  try {
    const jwt = await getNovaPostJwt();
    const [fromDivisionId, toDivisionId] = await Promise.all([
      getNovaPostDivisionId(jwt, fromCode),
      getNovaPostDivisionId(jwt, toCode),
    ]);

    let currency = { code: 'EUR', symbol: 'EUR' };

    const pending = [];
    for (const input of validInputs) {
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
          try {
            const result = await calculateWithSession(jwt, fromCode, toCode, fromDivisionId, toDivisionId, input);
            setCachedQuote(cacheKey, result);
            return [key, result, null];
          } catch (err) {
            return [key, null, err?.message || String(err)];
          }
        }),
      );
      for (const [key, result, errMsg] of entries) {
        if (result) {
          quotes[key] = result;
          currency = result.currency;
        } else if (errMsg) {
          errors[key] = errMsg;
        }
      }
    }

    return { quotes, errors, currency, priceSource: 'novapost' };
  } catch (err) {
    // Do not open the global NP circuit on quote failures — intermittent 403s
    // must not force mock EUR prices for every customer for a minute.
    console.warn('[novapost] calculateBatch incomplete:', err?.message || err);
    return { quotes, errors, currency: { code: 'EUR', symbol: 'EUR' }, priceSource: 'novapost' };
  }
}

export async function calculateSingle(input) {
  const fromCode = normalizeCountryCode(input.fromCountry);
  const toCode = normalizeCountryCode(input.toCountry);
  const normalized = { ...input, fromCountry: fromCode, toCountry: toCode };
  validateParcelInput(normalized);

  if (isNovaPostMock()) {
    const mock = calculateMock(normalized);
    return { ...mock, priceSource: 'mock' };
  }

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
    console.warn('[novapost] calculateSingle failed:', err?.message || err);
    throw err;
  }
}

export { normalizeCountryCode };
