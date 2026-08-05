/**
 * Nova Post courier pickup (POST /pickups → attach shipments → PUT status Created).
 * Docs: https://api-portal.novapost.com/metodi-1/methods/pickups
 */
import {
  getNovaPostContractConfig,
  getNovaPostJwt,
  isNovaPostMock,
  novaPostFetchJson,
  novaPostAuthHeader,
} from './client.mjs';
import { normalizeCountryCode } from './calculate.mjs';

const CALLING_CODE_BY_ISO2 = {
  CZ: '420', DE: '49', EE: '372', ES: '34', FR: '33', GB: '44',
  HU: '36', IT: '39', LT: '370', LV: '371', MD: '373', NL: '31',
  PL: '48', RO: '40', SK: '421', UA: '380',
};

const MAX_NATIONAL_DIGITS = {
  HU: 9, DE: 11, PL: 9, CZ: 9, SK: 9, RO: 9, UA: 9,
  FR: 9, ES: 9, IT: 10, GB: 10, NL: 9, LT: 8, LV: 8, EE: 8, MD: 8,
};

const TZ_BY_COUNTRY = {
  HU: 'Europe/Budapest',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  SK: 'Europe/Bratislava',
  DE: 'Europe/Berlin',
  AT: 'Europe/Vienna',
  RO: 'Europe/Bucharest',
  MD: 'Europe/Chisinau',
  UA: 'Europe/Kyiv',
  LT: 'Europe/Vilnius',
  LV: 'Europe/Riga',
  EE: 'Europe/Tallinn',
  NL: 'Europe/Amsterdam',
  FR: 'Europe/Paris',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  GB: 'Europe/London',
};

function normalizeNovaPostPhone(raw, iso2) {
  const country = iso2.toUpperCase();
  const cc = CALLING_CODE_BY_ISO2[country] || '36';
  const maxNational = MAX_NATIONAL_DIGITS[country] || 10;

  let digits = String(raw ?? '').trim().replace(/[\s\u00A0\-().]/g, '').replace(/^\+/, '');
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(cc)) digits = digits.slice(cc.length);
  digits = digits.replace(/^0+/, '');
  if (digits.length > maxNational) digits = digits.slice(0, maxNational);
  if (digits.length < 6) {
    throw new Error(`Некорректный телефон для забора курьером (${country})`);
  }
  // NP pickup phone: 8–14 chars including leading +
  const phone = `+${cc}${digits}`;
  if (phone.length > 14) {
    throw new Error(`Телефон для забора слишком длинный для Nova Post (макс. 14 символов): ${phone}`);
  }
  return phone;
}

function sanitizePersonName(...parts) {
  const raw = parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' ').replace(/[—–-]+/g, ' ').trim();
  const words = raw.match(/[\p{L}][\p{L}\s'.]*/gu) ?? [];
  const cleaned = words.map((w) => w.trim()).filter((w) => w.length >= 2).join(' ').trim();
  if (cleaned.length >= 3) return cleaned.slice(0, 100);
  return 'Mate Customer';
}

function buildAddressParts(location) {
  const source = location?.addressParts || {};
  const city = String(source.city || '').trim().slice(0, 100);
  const addressParts = {
    city,
    // NP pickups require region when addressParts is present (422 otherwise).
    region: String(source.region || city || '').trim().slice(0, 100),
    street: String(source.street || '').trim().slice(0, 100),
    postCode: String(source.postCode || source.post_code || '').trim().slice(0, 10),
    building: String(source.building || '').trim().slice(0, 100),
  };
  if (!addressParts.city || !addressParts.street || !addressParts.postCode || !addressParts.building) {
    throw new Error('Забор курьером: заполните полный адрес (город, улица, дом, индекс)');
  }
  if (!addressParts.region) {
    throw new Error('Забор курьером: укажите регион/область (или город как region)');
  }
  for (const key of ['flat', 'block', 'note']) {
    const value = String(source[key] || '').trim();
    if (value) addressParts[key] = value.slice(0, key === 'flat' ? 10 : 100);
  }
  return addressParts;
}

/** Format instant as NP pattern: 20YY-MM-DDTHH:mm:ss.ffffffZ */
function toNpDateTime(ms) {
  const iso = new Date(ms).toISOString();
  return iso.replace(/\.\d{3}Z$/, '.000000Z');
}

/**
 * Convert local wall-clock (date + HH:mm) in country TZ → UTC ms.
 */
function localWallTimeToUtcMs(isoDate, hhmm, timeZone) {
  const [y, mo, d] = String(isoDate).split('-').map(Number);
  const [hh, mm] = String(hhmm).split(':').map(Number);
  if (![y, mo, d, hh, mm].every((n) => Number.isFinite(n))) {
    throw new Error('Некорректная дата/время забора курьером');
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const partsOf = (ms) => {
    const o = {};
    for (const p of dtf.formatToParts(new Date(ms))) {
      if (p.type !== 'literal') o[p.type] = p.value;
    }
    return o;
  };

  let ms = Date.UTC(y, mo - 1, d, hh, mm, 0);
  for (let i = 0; i < 4; i += 1) {
    const p = partsOf(ms);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +(p.second || 0));
    const desired = Date.UTC(y, mo - 1, d, hh, mm, 0);
    ms += desired - asUtc;
  }
  return ms;
}

function parsePickupTimeWindow(pickupTime) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(pickupTime || '').trim());
  if (!m) return null;
  const pad = (n) => String(Number(n)).padStart(2, '0');
  return {
    from: `${pad(m[1])}:${m[2]}`,
    to: `${pad(m[3])}:${m[4]}`,
  };
}

export function orderNeedsCourierPickup(orderOrBody) {
  const body = orderOrBody?.payload && typeof orderOrBody.payload === 'object'
    ? orderOrBody.payload
    : orderOrBody;
  const tariff = body?.tariff || {};
  const mode = String(tariff.pickupMode || tariff.pickupType || body?.pickupMode || '').toLowerCase();
  if (mode === 'home' || mode === 'address' || mode === 'courier') return true;
  const loc = tariff.pickupLocation;
  return loc?.kind === 'address';
}

export function hasFinalizedCourierPickup(order) {
  const pickup = order?.npSnapshot?.pickup;
  if (!pickup?.id) return false;
  const status = String(pickup.status || '').toLowerCase();
  return status === 'created' || pickup.finalized === true;
}

function formatPickupError(err) {
  const raw = String(err?.message || err);
  // Keep NP body for ops; map only clear cases.
  if (/validation\.phone|\"phone\"/i.test(raw)) {
    return `Nova Post отклонил телефон для забора курьером. ${raw.slice(0, 400)}`;
  }
  if (/addressParts|validation\.address|invalid.?address/i.test(raw)) {
    return `Nova Post отклонил адрес забора курьером. ${raw.slice(0, 500)}`;
  }
  if (/forbidden|403/i.test(raw)) {
    return `Nova Post отклонил создание заявки на забор (доступ/контракт). ${raw.slice(0, 400)}`;
  }
  return raw.startsWith('Nova Post') || raw.startsWith('Забор')
    ? raw
    : `Забор курьером Nova Post: ${raw}`;
}

export async function findPickupTimeIntervals({ type, countryCode, addressParts, weightKg }) {
  const jwt = await getNovaPostJwt();
  const body = {
    type,
    countryCode: normalizeCountryCode(countryCode),
    addressParts,
  };
  if (Number.isFinite(Number(weightKg)) && Number(weightKg) > 0) {
    body.maxWeightPlaceRecipient = Math.round(Number(weightKg));
  }
  return novaPostFetchJson('/time-intervals/find', {
    method: 'POST',
    headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
    body,
  });
}

/**
 * Best-effort: confirm user date is a working day in NP schedule; times come from the order.
 */
async function resolvePickedTimes({ countryCode, addressParts, pickupDate, pickupTime, weightKg }) {
  const window = parsePickupTimeWindow(pickupTime);
  if (!window || !pickupDate) {
    return { pickedTimeFrom: null, pickedTimeTo: null, intervalType: null };
  }

  const tz = TZ_BY_COUNTRY[normalizeCountryCode(countryCode)] || 'Europe/Budapest';
  const fromMs = localWallTimeToUtcMs(pickupDate, window.from, tz);
  const toMs = localWallTimeToUtcMs(pickupDate, window.to, tz);

  let intervalType = 'PickupNextDay';
  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (pickupDate === todayIso) intervalType = 'PickupDayToDay';

  try {
    let schedule = await findPickupTimeIntervals({
      type: intervalType,
      countryCode,
      addressParts,
      weightKg,
    });
    if (!schedule?.monday && intervalType === 'PickupNextDay') {
      schedule = await findPickupTimeIntervals({
        type: 'PickupDayToDay',
        countryCode,
        addressParts,
        weightKg,
      });
      intervalType = 'PickupDayToDay';
    }
    const noonLocalMs = localWallTimeToUtcMs(pickupDate, '12:00', tz);
    const weekdayLong = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' })
      .format(new Date(noonLocalMs))
      .toLowerCase();
    const scheduleDay = schedule?.[weekdayLong];
    if (
      scheduleDay
      && scheduleDay.from == null
      && Array.isArray(scheduleDay.timeIntervals)
      && scheduleDay.timeIntervals.length === 0
    ) {
      console.warn(`[novapost] pickup schedule empty for ${pickupDate} (${weekdayLong}); sending user window anyway`);
    }
  } catch (err) {
    console.warn('[novapost] time-intervals/find failed (using user window):', err?.message || err);
  }

  return {
    pickedTimeFrom: toNpDateTime(fromMs),
    pickedTimeTo: toNpDateTime(toMs),
    intervalType,
  };
}

export async function createCourierPickupDraft(payload) {
  const jwt = await getNovaPostJwt();
  return novaPostFetchJson('/pickups', {
    method: 'POST',
    headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
    body: payload,
  });
}

export async function addShipmentsToPickup(pickupId, shipmentIds) {
  const jwt = await getNovaPostJwt();
  const shipments = shipmentIds.map((id) => ({ shipmentId: Number(id) }));
  return novaPostFetchJson(`/pickups/${encodeURIComponent(pickupId)}/shipments`, {
    method: 'POST',
    headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
    body: { shipments },
  });
}

export async function finalizePickupStatus(pickupId, lockVersion, note) {
  const jwt = await getNovaPostJwt();
  const id = Number(pickupId);
  return novaPostFetchJson(`/pickups/${encodeURIComponent(pickupId)}/status`, {
    method: 'PUT',
    headers: { ...novaPostAuthHeader(jwt), 'Content-Type': 'application/json' },
    body: {
      id,
      status: 'Created',
      lockVersion: Number(lockVersion) || 1,
      note: String(note || 'Mate B2C courier pickup').slice(0, 255),
    },
  });
}

export async function fetchPickupById(pickupId) {
  const jwt = await getNovaPostJwt();
  const response = await novaPostFetchJson(`/pickups?ids[]=${encodeURIComponent(pickupId)}`, {
    method: 'GET',
    headers: novaPostAuthHeader(jwt),
  });
  const items = response?.items || [];
  return items.find((item) => String(item.id) === String(pickupId)) || items[0] || null;
}

/** Find an existing pickup that already contains this shipment id (idempotent recover). */
export async function findPickupForShipment(shipmentId) {
  const jwt = await getNovaPostJwt();
  const id = Number(shipmentId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const response = await novaPostFetchJson('/pickups?limit=50&page=1', {
    method: 'GET',
    headers: novaPostAuthHeader(jwt),
  });
  const items = response?.items || [];
  for (const item of items) {
    const shipments = item?.shipments || [];
    const hit = shipments.some((s) => Number(s.shipmentId) === id || Number(s.shipment_id) === id);
    if (hit) return item;
  }
  return null;
}

/**
 * Full NP flow for address/courier pickup after shipment create:
 * 1) POST /pickups (Draft)
 * 2) POST /pickups/{id}/shipments
 * 3) PUT /pickups/{id}/status → Created
 */
export async function createCourierPickupForShipment(body, shipment) {
  const tariff = body?.tariff || {};
  const location = tariff.pickupLocation;
  if (!location || location.kind !== 'address') {
    throw new Error('Забор курьером: нужен адресный pickupLocation');
  }

  const shipmentIdRaw = shipment?.npRef;
  if (isNovaPostMock() || String(shipmentIdRaw || '').startsWith('mock-')) {
    return {
      id: `mock-pickup-${shipmentIdRaw || 'x'}`,
      number: null,
      status: 'Created',
      finalized: true,
      lockVersion: 1,
      provider: 'mock',
      shipmentId: shipmentIdRaw,
      pickedTimeFrom: null,
      pickedTimeTo: null,
    };
  }

  const shipmentId = Number(shipmentIdRaw);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new Error('Забор курьером: нет валидного shipment id (npRef)');
  }

  // Already attached in NP (e.g. manual recover) — reuse, don't create a second pickup.
  try {
    const existing = await findPickupForShipment(shipmentId);
    if (existing?.id) {
      const status = String(existing.status || '');
      let lockVersion = Number(existing.lockVersion) || 1;
      if (status === 'Draft') {
        try {
          await finalizePickupStatus(existing.id, lockVersion, `Mate finalize ${shipment.npTtn || shipmentId}`.slice(0, 255));
        } catch {
          await finalizePickupStatus(existing.id, lockVersion + 1, `Mate finalize ${shipment.npTtn || shipmentId}`.slice(0, 255));
        }
      }
      return {
        id: existing.id,
        number: existing.number || null,
        status: status === 'Draft' ? 'Created' : status || 'Created',
        finalized: true,
        lockVersion,
        provider: 'novapost.com',
        shipmentId,
        reused: true,
        pickedTimeFrom: existing.pickedTimeFrom || null,
        pickedTimeTo: existing.pickedTimeTo || null,
        createdAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.warn('[novapost] findPickupForShipment failed:', err?.message || err);
  }

  const countryCode = normalizeCountryCode(location.countryCode || body.sender?.country || 'HU');
  const addressParts = buildAddressParts(location);
  const sender = body.sender || {};
  const phone = normalizeNovaPostPhone(String(sender.phone || ''), countryCode);
  const fullName = sanitizePersonName(sender.name) || 'Mate Customer';
  const email = String(sender.email || '').trim().slice(0, 128) || undefined;
  const { payerContractNumber, companyTin, companyName } = getNovaPostContractConfig();

  const pickupDate = String(tariff.pickupDate || body.pickupDate || '').trim();
  const pickupTime = String(tariff.pickupTime || body.pickupTime || '').trim();
  const weightKg = Number(body.parcel?.weightKg);
  const { pickedTimeFrom, pickedTimeTo, intervalType } = await resolvePickedTimes({
    countryCode,
    addressParts,
    pickupDate,
    pickupTime,
    weightKg,
  });

  const noteParts = [
    `Mate B2C ${body.clientOrder || shipment.npTtn || ''}`.trim(),
    pickupDate && pickupTime ? `${pickupDate} ${pickupTime}` : '',
    addressParts.note || '',
  ].filter(Boolean);

  const createPayload = {
    phone,
    fullName,
    countryCode,
    addressParts,
    note: noteParts.join(' · ').slice(0, 255),
  };
  if (email) createPayload.email = email;
  if (payerContractNumber && companyTin) {
    createPayload.companyTin = companyTin;
    createPayload.companyName = companyName.slice(0, 255);
  }
  if (pickedTimeFrom) createPayload.pickedTimeFrom = pickedTimeFrom;
  if (pickedTimeTo) createPayload.pickedTimeTo = pickedTimeTo;
  // CourierPickupService is contract/MD-restricted — do not send for standard HU B2C.

  try {
    const created = await createCourierPickupDraft(createPayload);
    const pickupId = created?.id;
    if (pickupId == null) throw new Error('Nova Post create pickup did not return id');

    let lockVersion = Number(created.lockVersion) || 1;

    await addShipmentsToPickup(pickupId, [shipmentId]);

    const refreshed = await fetchPickupById(pickupId).catch(() => null);
    if (refreshed?.lockVersion != null) {
      lockVersion = Number(refreshed.lockVersion) || lockVersion;
    }

    try {
      await finalizePickupStatus(
        pickupId,
        lockVersion,
        `Mate finalize ${shipment.npTtn || shipmentId}`.slice(0, 255),
      );
    } catch (statusErr) {
      try {
        await finalizePickupStatus(
          pickupId,
          lockVersion + 1,
          `Mate finalize ${shipment.npTtn || shipmentId}`.slice(0, 255),
        );
      } catch {
        throw statusErr;
      }
    }

    return {
      id: pickupId,
      number: created.number || refreshed?.number || null,
      status: 'Created',
      finalized: true,
      lockVersion,
      provider: 'novapost.com',
      shipmentId,
      pickedTimeFrom: pickedTimeFrom || null,
      pickedTimeTo: pickedTimeTo || null,
      intervalType: intervalType || null,
      request: createPayload,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[novapost] createCourierPickupForShipment failed:', err?.message || err);
    throw new Error(formatPickupError(err));
  }
}
