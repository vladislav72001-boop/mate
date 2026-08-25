import { randomBytes } from 'node:crypto';
import {
  getNovaPostContractConfig,
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
  validateNovaPostParcelRules,
  validateParcelDimensionsCm,
  NOVAPOST_PARCEL_RULES,
} from './parcel.mjs';
import { normalizeCountryCode } from './calculate.mjs';
import { buildShipmentInvoice } from './invoice.mjs';

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

function applyShipmentLocation(party, location) {
  if (location?.kind === 'division') {
    const divisionId = Number(location.divisionId);
    if (!Number.isInteger(divisionId) || divisionId <= 0) {
      throw new Error('Некорректный ID отделения Nova Post');
    }
    return { ...party, countryCode: normalizeCountryCode(location.countryCode), divisionId };
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
      throw new Error('Заполните полный адрес для курьерской доставки');
    }
    for (const key of ['region', 'flat', 'block', 'note']) {
      const value = String(source[key] || '').trim();
      if (value) addressParts[key] = value;
    }
    const { divisionId: _ignored, ...withoutDivision } = party;
    return {
      ...withoutDivision,
      countryCode: normalizeCountryCode(location.countryCode),
      addressParts,
    };
  }
  return party;
}

function formatNovaPostShipmentError(err) {
  const raw = String(err?.message || err);
  if (raw.includes('forbidden by API key') || raw.includes('Access to the company is forbidden')) {
    return 'Оплата прошла, но companyTin не совпал с компанией API-ключа. В sender нужен TIN без символов: 32834374243 (NOVAPOST_COMPANY_TIN).';
  }
  if (raw.includes('wrong_company') || raw.includes('validation.payer.contract.wrong_company')) {
    return 'Оплата прошла, но номер договора Nova Post принадлежит другой компании (wrong_company). Нужен договор org API-ключа Mate + sender.companyTin этой же компании.';
  }
  if (raw.includes('companyTin')) {
    return 'Оплата прошла, но Nova Post отклонил sender.companyTin. При договоре в блоке отправителя нужен TIN компании-владельца договора (NOVAPOST_COMPANY_TIN).';
  }
  if (raw.includes('invalid.contract.type') || raw.includes('validation.invalid.contract.type')) {
    return 'Оплата прошла, но тип договора не подходит для payerType=Sender (часто CNPHU — клиентский). Нужен логистический договор компании Mate на этот же API-ключ.';
  }
  if (raw.includes('ContractEntity.number') || raw.includes('validation.exists')) {
    return 'Оплата прошла, но Nova Post не принял номер договора (payerContractNumber). Проверьте NOVAPOST_PAYER_CONTRACT_NUMBER в Railway — заявка останется оплаченной, отправление можно создать повторно.';
  }
  if (raw.includes('validation.phone')) {
    return 'Некорректный номер телефона отправителя или получателя. Проверьте код страны и количество цифр.';
  }
  if (raw.includes('validation.not_allowed.sender')) {
    if (raw.includes('actualWeight')) {
      return 'Nova Post не принимает посылку с таким весом. Максимум — 30 кг.';
    }
    if (raw.includes('volumetricWeight')) {
      return 'Nova Post не принимает посылку с такими габаритами. Уменьшите размер или выберите меньший тариф.';
    }
    return 'Nova Post отклонил параметры посылки. Проверьте размер и вес.';
  }
  if (raw.includes('invoice_is_null') || raw.includes('validation.condition.invoice')) {
    return 'Nova Post требует таможенный invoice для этого направления (например HU→UA). Обновите сервер и повторите создание отправления.';
  }
  if (raw.includes('403')) {
    return 'Nova Post API недоступен (403). Проверьте NOVAPOST_API_KEY и перезапустите сервер.';
  }
  return raw;
}

export async function createInternationalShipment(body, clientOrder) {
  const parcel = body.parcel || {};
  const weightKg = Math.max(0.1, Number(parcel.weightKg ?? 1));
  const isDocuments = ['XS', 'ENVELOPE', 'DOCUMENTS'].includes(String(parcel.boxSize || '').toUpperCase());
  const lengthCm = isDocuments ? 35 : Number(parcel.lengthCm ?? 30);
  const widthCm = isDocuments ? 25 : Number(parcel.widthCm ?? 20);
  const heightCm = isDocuments ? 2 : Number(parcel.heightCm ?? 15);
  const boxSize = String(parcel.boxSize || '');
  const limits = resolveParcelLimits(lengthCm, widthCm, heightCm, weightKg, boxSize);
  const dimErr = validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits);
  if (dimErr) throw new Error(dimErr);
  if (weightKg > limits.maxWeightKg) {
    throw new Error(`Weight ${weightKg} kg exceeds limit ${limits.maxWeightKg} kg`);
  }

  const npRuleErr = validateNovaPostParcelRules(lengthCm, widthCm, heightCm, weightKg);
  if (npRuleErr) throw new Error(npRuleErr);

  const maxNpKg = Number(process.env.NOVAPOST_MAX_WEIGHT_KG ?? NOVAPOST_PARCEL_RULES.maxWeightKg);
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
    const maxL = Math.round(Number(process.env.NOVAPOST_MAX_LENGTH_MM ?? 1200) / 10);
    const maxW = Math.round(Number(process.env.NOVAPOST_MAX_WIDTH_MM ?? 1200) / 10);
    const maxH = Math.round(Number(process.env.NOVAPOST_MAX_HEIGHT_MM ?? 1200) / 10);
    throw new Error(
      `Габариты ${lengthCm}×${widthCm}×${heightCm} см превышают лимит Nova Post (${maxL}×${maxW}×${maxH} см). Уменьшите размер посылки.`,
    );
  }
  const { grams: actualWeight, capped: weightCapped } = capWeightGramsForShipment(weightKg);
  if (weightCapped) {
    throw new Error(`Nova Post не принимает посылки тяжелее ${maxNpKg} кг.`);
  }
  const invoice = buildShipmentInvoice(body, parcel, actualWeight, clientOrder);
  const insuranceCost = Math.max(1, Number(invoice?.cost ?? parcel.declaredValue ?? 100));

  const jwt = await getNovaPostJwt();
  const senderCountry = normalizeCountryCode(body.sender?.country || 'HU');
  const recipientCountry = normalizeCountryCode(body.receiver?.country || 'PL');

  const [senderDivisionId, recipientDivisionId] = await Promise.all([
    getNovaPostDivisionId(jwt, senderCountry),
    getNovaPostDivisionId(jwt, recipientCountry),
  ]);

  const sender = applyShipmentLocation(
    buildSender(body, senderDivisionId),
    body.tariff?.pickupLocation,
  );
  const recipient = applyShipmentLocation(
    buildRecipient(body, recipientDivisionId),
    body.tariff?.deliveryLocation,
  );

  // Non-cash under Mate↔Nova Post contract when a valid API contract id is configured.
  // NP: companyTin must match the API-key company exactly, digits only (e.g. 32834374243, not 32834374-2-43).
  const { payerContractNumber, companyTin } = getNovaPostContractConfig();

  if (payerContractNumber && companyTin) {
    sender.companyTin = companyTin;
  }

  const payload = {
    status: 'ReadyToShip',
    clientOrder: clientOrder.slice(0, 50),
    note: `Mate B2C ${clientOrder}`.slice(0, 255),
    payerType: 'Sender',
    ...(payerContractNumber ? { payerContractNumber } : {}),
    ...(invoice ? { invoice } : {}),
    parcels: [{
      rowNumber: 1,
      cargoCategory: isDocuments ? 'documents' : 'parcel',
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

    const scheduledDeliveryDate = extractNovaPostScheduledDelivery(response);

    return {
      npRef,
      npTtn: response.number ?? null,
      snapshot: {
        provider: 'novapost.com',
        request: payload,
        response,
        ...(scheduledDeliveryDate ? { scheduledDeliveryDate } : {}),
      },
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

/**
 * Map Nova Post shipment status string/code → Mate order status.
 * Prefer numeric tracking statusCode when available.
 * ReadyToShip / code 1 = waiting for sender drop-off; Delivered* / 9–11 = done; else in transit.
 * Arrived-at-point (postomat/PUDO/branch) stays in transit until the recipient collects.
 */
export function mapNovaPostStatusToOrderStatus(npStatus) {
  const raw = String(npStatus || '').trim();
  if (!raw) return null;

  // FullTracking statusCode (docs: /shipments/tracking).
  if (/^\d+$/.test(raw)) {
    const code = Number(raw);
    if (code === 1) return 'waiting_from_you';
    if (code === 2) return null; // deleted — do not auto-cancel
    if (code === 9 || code === 10 || code === 11) return 'delivered';
    if (code > 0) return 'submitted';
  }

  const s = raw.toLowerCase().replace(/[\s_-]+/g, '');

  if (
    s === 'readytoship'
    || s === 'created'
    || s === 'draft'
    || s === 'new'
    || (s.includes('waiting') && (s.includes('parcel') || s.includes('sender')))
  ) {
    return 'waiting_from_you';
  }
  // Handed over at branch / waybill issued — no longer waiting for sender drop-off.
  if (s === 'accepted' || s === 'issued' || s.includes('intransit') || s.includes('processing')) {
    return 'submitted';
  }
  // Still waiting for the recipient at a locker/PUDO/branch — not fully delivered yet.
  if (isArrivedAtPickupPointStatus(raw)) {
    return 'submitted';
  }
  if (
    s.includes('delivered')
    || s === 'completed'
    || s === 'received'
    || s === 'pickedupbyrecipient'
  ) {
    return 'delivered';
  }
  if (
    s.includes('cancel')
    || s.includes('deleted')
    || s === 'void'
  ) {
    return null; // do not auto-cancel from NP sync
  }
  // In transit / picked up / on the way / etc.
  return 'submitted';
}

/**
 * True when NP says the parcel is waiting at a Postomat / PUDO / branch for the recipient.
 * Heuristic over status strings — PIN/cell is not available via API.
 */
export function isArrivedAtPickupPointStatus(npStatus) {
  const raw = String(npStatus || '').trim();
  if (!raw) return false;

  if (/^\d+$/.test(raw)) {
    const code = Number(raw);
    // 7 Arrived (Division), 8 Arrived (Postomat)
    return code === 7 || code === 8;
  }

  const s = raw.toLowerCase().replace(/[\s_-]+/g, '');

  // Already collected by the recipient — use the regular delivered email.
  if (
    s.includes('pickedupbyrecipient')
    || s.includes('receivedbyrecipient')
    || s.includes('collectedbyrecipient')
    || s.includes('handedover')
    || s === 'completed'
  ) {
    return false;
  }

  const atPoint = (
    s.includes('postomat')
    || s.includes('pudo')
    || s.includes('locker')
    || s.includes('pickuppoint')
    || s.includes('parcelpoint')
  );
  if (atPoint) {
    if (
      s.includes('arriv')
      || s.includes('deliveredto')
      || s.includes('atpostomat')
      || s.includes('atpudo')
      || s.includes('inpostomat')
      || s.includes('inpudo')
      || s.includes('ready')
      || s.includes('waiting')
      || s.includes('stored')
    ) {
      return true;
    }
  }

  if (
    (s.includes('arriv') || s.includes('deliveredto') || s.includes('readyfor'))
    && (s.includes('branch') || s.includes('division') || s.includes('office') || s.includes('depot'))
  ) {
    return true;
  }

  if (
    s === 'readyforpickup'
    || s === 'awaitingrecipient'
    || s === 'waitingforpickup'
    || s === 'awaitingpickup'
    || s === 'storedatdestination'
  ) {
    return true;
  }

  return false;
}

function extractNovaPostStatus(response) {
  if (!response || typeof response !== 'object') return null;

  // FullTracking: /shipments/tracking → items[].currentStatus
  const trackingItem = Array.isArray(response.items) ? response.items[0] : null;
  const current = trackingItem?.currentStatus || response.currentStatus;
  if (current?.statusCode != null && String(current.statusCode).trim() !== '') {
    return String(current.statusCode).trim();
  }
  if (current?.status != null && String(current.status).trim() !== '') {
    return String(current.status).trim();
  }

  const candidates = [
    response.status,
    response.shipmentStatus,
    response.state,
    response?.shipment?.status,
    response?.data?.status,
    trackingItem?.status,
    response?.items?.[0]?.status,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

/** NP estimated arrival (scheduledDeliveryDate from create/get/tracking). */
export function extractNovaPostScheduledDelivery(response) {
  if (!response || typeof response !== 'object') return null;
  const trackingItem = Array.isArray(response.items) ? response.items[0] : null;
  const current = trackingItem?.currentStatus || response.currentStatus;
  const candidates = [
    current?.scheduledDate,
    current?.adjustedDate,
    trackingItem?.scheduled_delivery_date,
    response.scheduledDeliveryDate,
    response.scheduled_delivery_date,
    response?.shipment?.scheduledDeliveryDate,
    response?.data?.scheduledDeliveryDate,
    response?.items?.[0]?.scheduledDeliveryDate,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

function extractTrackingNumber(response) {
  const trackingItem = Array.isArray(response?.items) ? response.items[0] : null;
  return (
    trackingItem?.currentStatus?.number
    || trackingItem?.number
    || response?.number
    || response?.ttn
    || null
  );
}

/**
 * Fetch live shipment status from Nova Post.
 * Prefer FullTracking (`GET /shipments/tracking?ids[]=` / `numbers[]=`) —
 * `GET /shipments/{id}` returns 405 on the current API.
 */
export async function fetchInternationalShipmentStatus(shipmentId, shipmentNumber = null) {
  if (isNovaPostMock() || (!shipmentId && !shipmentNumber)) {
    return { npStatus: null, orderStatus: null, raw: null };
  }
  if (shipmentId && String(shipmentId).startsWith('mock-')) {
    return { npStatus: null, orderStatus: null, raw: null };
  }

  const jwt = await getNovaPostJwt();
  const qs = new URLSearchParams();
  if (shipmentId && /^\d+$/.test(String(shipmentId))) {
    qs.set('ids[]', String(shipmentId));
  } else if (shipmentNumber) {
    qs.set('numbers[]', String(shipmentNumber));
  } else if (shipmentId) {
    // Legacy: some older rows may store TTN in npRef.
    qs.set('numbers[]', String(shipmentId));
  }

  const response = await novaPostFetchJson(`/shipments/tracking?${qs.toString()}`, {
    method: 'GET',
    headers: novaPostAuthHeader(jwt),
  });
  const npStatus = extractNovaPostStatus(response);
  const scheduledDeliveryDate = extractNovaPostScheduledDelivery(response);
  return {
    npStatus,
    orderStatus: mapNovaPostStatusToOrderStatus(npStatus),
    raw: response,
    number: extractTrackingNumber(response),
    scheduledDeliveryDate,
  };
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
