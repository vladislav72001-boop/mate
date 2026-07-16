import { randomBytes } from 'node:crypto';
import {
  getNovaPostDivisionId,
  getNovaPostJwt,
  isNovaPostMock,
  novaPostFetchJson,
  novaPostAuthHeader,
} from './client.mjs';
import {
  capParcelDimensionsMmForShipment,
  capWeightGramsForShipment,
  resolveParcelLimits,
  validateParcelDimensionsCm,
} from './parcel.mjs';
import { normalizeCountryCode } from './calculate.mjs';

const CALLING_CODE_BY_ISO2 = {
  CZ: '420', DE: '49', EE: '372', ES: '34', FR: '33', GB: '44',
  HU: '36', IT: '39', LT: '370', LV: '371', MD: '373', NL: '31',
  PL: '48', RO: '40', SK: '421', UA: '380',
};

/** Max national digits (without country code) for E.164 validation. */
const MAX_NATIONAL_DIGITS = {
  HU: 9, DE: 11, PL: 9, CZ: 9, SK: 9, RO: 9, UA: 9,
  FR: 9, ES: 9, IT: 10, GB: 10, NL: 9, LT: 8, LV: 8, EE: 8, MD: 8,
};

function normalizeNovaPostPhone(raw, iso2) {
  const country = iso2.toUpperCase();
  const cc = CALLING_CODE_BY_ISO2[country] || '48';
  const maxNational = MAX_NATIONAL_DIGITS[country] || 10;

  let digits = String(raw ?? '').trim().replace(/[\s\u00A0\-().]/g, '').replace(/^\+/, '');
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith(cc)) {
    digits = digits.slice(cc.length);
  }
  digits = digits.replace(/^0+/, '');

  if (digits.length > maxNational) {
    digits = digits.slice(0, maxNational);
  }
  if (digits.length < 6) {
    throw new Error(`Некорректный телефон (${country}): укажите номер в формате +${cc} и ${maxNational} цифр без лишних символов`);
  }

  return `+${cc}${digits}`;
}

function sanitizePersonName(...parts) {
  const raw = parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' ').replace(/[—–-]+/g, ' ').trim();
  const words = raw.match(/[\p{L}][\p{L}\s'.]*/gu) ?? [];
  const cleaned = words.map((w) => w.trim()).filter((w) => w.length >= 2).join(' ').trim();
  if (cleaned.length >= 3) return cleaned.slice(0, 64);
  return 'Mate Customer';
}

function buildSender(body, divisionId) {
  const sender = body.sender || {};
  const countryCode = normalizeCountryCode(sender.country || 'HU');
  return {
    countryCode,
    divisionId,
    name: sanitizePersonName(sender.name, 'Mate Sender'),
    phone: normalizeNovaPostPhone(String(sender.phone || '+36000000000'), countryCode),
    email: String(sender.email || 'noreply@matedelivery.com').slice(0, 128),
  };
}

function buildRecipient(body, divisionId) {
  const receiver = body.receiver || {};
  const countryCode = normalizeCountryCode(receiver.country || 'PL');
  const name = sanitizePersonName(receiver.firstName, receiver.lastName);
  return {
    countryCode,
    divisionId,
    name,
    phone: normalizeNovaPostPhone(String(receiver.phone || '+48000000000'), countryCode),
    email: String(receiver.email || 'noreply@matedelivery.com').slice(0, 128),
  };
}

function formatNovaPostShipmentError(err) {
  const raw = String(err?.message || err);
  if (raw.includes('validation.phone')) {
    return 'Некорректный номер телефона отправителя или получателя. Проверьте код страны и количество цифр.';
  }
  if (raw.includes('validation.not_allowed.sender')) {
    if (raw.includes('actualWeight')) {
      return 'Nova Post не принимает посылку с таким весом. Максимум — 20 кг для международной отправки.';
    }
    if (raw.includes('volumetricWeight')) {
      return 'Nova Post не принимает посылку с такими габаритами. Уменьшите размер или выберите меньший тариф.';
    }
    return 'Nova Post отклонил параметры посылки. Проверьте размер и вес.';
  }
  if (raw.includes('403')) {
    return 'Nova Post API недоступен (403). Проверьте NOVAPOST_API_KEY и перезапустите сервер.';
  }
  return raw;
}

export async function createInternationalShipment(body, clientOrder) {
  const parcel = body.parcel || {};
  const weightKg = Math.max(0.1, Number(parcel.weightKg ?? 1));
  const lengthCm = Number(parcel.lengthCm ?? 30);
  const widthCm = Number(parcel.widthCm ?? 20);
  const heightCm = Number(parcel.heightCm ?? 15);
  const boxSize = String(parcel.boxSize || '');
  const limits = resolveParcelLimits(lengthCm, widthCm, heightCm, weightKg, boxSize);
  const dimErr = validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits);
  if (dimErr) throw new Error(dimErr);
  if (weightKg > limits.maxWeightKg) {
    throw new Error(`Weight ${weightKg} kg exceeds limit ${limits.maxWeightKg} kg`);
  }

  const maxNpKg = Number(process.env.NOVAPOST_MAX_WEIGHT_KG ?? 20);
  if (weightKg > maxNpKg) {
    throw new Error(`Nova Post не принимает посылки тяжелее ${maxNpKg} кг. Выберите меньший размер или уменьшите вес.`);
  }

  if (isNovaPostMock()) {
    const mockId = `mock-${randomBytes(6).toString('hex')}`;
    const mockTtn = `NP${Date.now().toString(36).toUpperCase()}`;
    return {
      npRef: mockId,
      npTtn: mockTtn,
      snapshot: { provider: 'mock', clientOrder, parcel },
    };
  }

  const { length: lengthMm, width: widthMm, height: heightMm, capped: dimsCapped } = capParcelDimensionsMmForShipment(
    lengthCm, widthCm, heightCm,
  );
  if (dimsCapped) {
    console.warn(
      `[novapost] Parcel dimensions capped for POST /shipments (${lengthCm}×${widthCm}×${heightCm} cm → ${lengthMm}×${widthMm}×${heightMm} mm)`,
    );
  }
  const { grams: actualWeight, capped: weightCapped } = capWeightGramsForShipment(weightKg);
  if (weightCapped) {
    throw new Error(`Nova Post не принимает посылки тяжелее ${maxNpKg} кг.`);
  }
  const insuranceCost = Math.max(1, Number(parcel.declaredValue ?? 100));

  const jwt = await getNovaPostJwt();
  const senderCountry = normalizeCountryCode(body.sender?.country || 'HU');
  const recipientCountry = normalizeCountryCode(body.receiver?.country || 'PL');

  const [senderDivisionId, recipientDivisionId] = await Promise.all([
    getNovaPostDivisionId(jwt, senderCountry),
    getNovaPostDivisionId(jwt, recipientCountry),
  ]);

  const sender = buildSender(body, senderDivisionId);
  const recipient = buildRecipient(body, recipientDivisionId);

  const payload = {
    status: 'ReadyToShip',
    clientOrder: clientOrder.slice(0, 50),
    note: `Mate B2C ${clientOrder}`.slice(0, 255),
    payerType: 'Sender',
    parcels: [{
      rowNumber: 1,
      cargoCategory: 'parcel',
      parcelDescription: String(parcel.description || 'B2C shipment').slice(0, 120),
      insuranceCost,
      length: lengthMm,
      width: widthMm,
      height: heightMm,
      actualWeight,
    }],
    sender,
    recipient,
  };

  try {
    const response = await novaPostFetchJson('/shipments', {
      method: 'POST',
      headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
      body: payload,
    });

    const npRef = response.id != null ? String(response.id) : '';
    if (!npRef) throw new Error('Nova Post create shipment did not return id');

    return {
      npRef,
      npTtn: response.number ?? null,
      snapshot: { provider: 'novapost.com', request: payload, response },
    };
  } catch (err) {
    console.error('[novapost] createInternationalShipment failed:', err?.message || err);
    throw new Error(formatNovaPostShipmentError(err));
  }
}

function isRealNpShipment(shipment) {
  return Boolean(
    shipment?.npRef
    && shipment?.npTtn
    && !String(shipment.npRef).startsWith('mock-'),
  );
}

/** Create NP draft at checkout; defer to payment if API is blocked or unavailable. */
export async function tryCreateCheckoutShipment(body, orderNumber) {
  try {
    const shipment = await createInternationalShipment(body, orderNumber);
    if (isRealNpShipment(shipment)) {
      return { shipment, deferred: false };
    }
    if (shipment.npRef && !String(shipment.npRef).startsWith('mock-')) {
      deleteInternationalShipment(shipment.npRef).catch(() => {});
    }
    console.warn(`[novapost] Checkout shipment deferred for ${orderNumber} (mock or missing TTN)`);
    return {
      shipment: {
        npRef: null,
        npTtn: null,
        snapshot: { provider: 'deferred', reason: 'mock_or_missing_ttn', clientOrder: orderNumber },
      },
      deferred: true,
    };
  } catch (err) {
    console.warn(`[novapost] Checkout shipment deferred for ${orderNumber}:`, err?.message || err);
    return {
      shipment: {
        npRef: null,
        npTtn: null,
        snapshot: { provider: 'deferred', error: String(err?.message || err), clientOrder: orderNumber },
      },
      deferred: true,
    };
  }
}

function isNovaPostShipmentGoneError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /shipment_was_deleted|shipment not found|not found/i.test(msg);
}

export async function deleteInternationalShipment(shipmentId) {
  if (isNovaPostMock() || !shipmentId || shipmentId.startsWith('mock-')) return;
  try {
    const jwt = await getNovaPostJwt();
    await novaPostFetchJson(`/shipments/${encodeURIComponent(shipmentId)}`, {
      method: 'DELETE',
      headers: novaPostAuthHeader(jwt),
    });
  } catch (err) {
    if (isNovaPostShipmentGoneError(err)) return;
    throw err;
  }
}
