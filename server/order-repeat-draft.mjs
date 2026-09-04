import { parsePhoneNumberFromString } from 'libphonenumber-js';

function splitPersonName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function splitPhone(raw, fallbackCc = 'HU') {
  const value = String(raw || '').trim();
  if (!value) {
    return { dial: fallbackCc === 'HU' ? '+36' : '+49', local: '' };
  }
  const parsed = parsePhoneNumberFromString(value)
    || parsePhoneNumberFromString(value, fallbackCc);
  if (parsed) {
    return {
      dial: `+${parsed.countryCallingCode}`,
      local: String(parsed.nationalNumber || ''),
    };
  }
  const digits = value.replace(/[^\d+]/g, '');
  const m = digits.match(/^(\+\d{1,3})(\d{6,})$/);
  if (m) return { dial: m[1], local: m[2] };
  return { dial: fallbackCc === 'HU' ? '+36' : '+49', local: value.replace(/\D/g, '') };
}

function modeFromTariff(raw) {
  const m = String(raw || '').toLowerCase();
  if (m === 'address' || m === 'home') return 'home';
  if (m === 'locker' || m === 'pudo' || m === 'branch') return m;
  return 'branch';
}

function sizeKeyFromParcel(parcel) {
  const box = String(parcel?.boxSize || '').toUpperCase();
  if (box === 'CUSTOM' || box.startsWith('CUSTOM:')) return 'custom';
  if (['XS', 'S', 'M', 'L', 'XL'].includes(box)) return box === 'XS' ? 'XS' : box;
  if (box === 'ENVELOPE' || box === 'DOCUMENTS') return 'XS';
  return 'custom';
}

function contentValueFromDeclared(declared) {
  const n = Number(declared) || 0;
  if (n <= 100) return 'under100';
  if (n <= 500) return 'mid';
  if (n <= 1000) return 'high';
  return 'over';
}

function locationStreet(loc) {
  if (!loc || typeof loc !== 'object') return '';
  const parts = loc.addressParts || {};
  const street = [parts.street, parts.building].filter(Boolean).join(' ').trim();
  if (street) return street;
  return String(loc.address || loc.name || '').trim();
}

function nextPickupDateIso() {
  const d = new Date();
  for (let i = 0; i < 10; i += 1) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      return d.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build calculator draft fields from a stored checkout payload
 * so the client can open a filled “repeat shipment” flow.
 */
export function buildRepeatDraftFromOrder(order) {
  const p = order?.payload || {};
  const tariff = p.tariff || {};
  const parcel = p.parcel || {};
  const sender = p.sender || {};
  const receiver = p.receiver || {};
  const pickupLoc = tariff.pickupLocation || {};
  const deliveryLoc = tariff.deliveryLocation || {};
  const pickupParts = pickupLoc.addressParts || {};
  const deliveryParts = deliveryLoc.addressParts || {};

  const toCountry = String(tariff.toCountry || receiver.country || order.toCountry || 'DE').toUpperCase();
  const fromCountry = String(tariff.fromCountry || sender.country || 'HU').toUpperCase();
  const pickupType = modeFromTariff(tariff.pickupType || tariff.pickupMode);
  const deliveryType = modeFromTariff(tariff.deliveryType || tariff.deliveryMode);
  const sizeKey = sizeKeyFromParcel(parcel);
  const senderName = splitPersonName(sender.name);
  const senderPhone = splitPhone(sender.phone, fromCountry);
  const receiverPhone = splitPhone(receiver.phone, toCountry);

  const pickupCity = String(
    tariff.pickupCity || pickupParts.city || '',
  ).trim();
  const destCity = String(
    tariff.destCity || deliveryParts.city || '',
  ).trim();
  const pickupPostal = String(pickupParts.postCode || pickupParts.postalCode || '').trim();
  const destPostal = String(deliveryParts.postCode || deliveryParts.postalCode || '').trim();
  const pickupStreet = locationStreet(pickupLoc) || String(sender.line || '').trim();
  const destStreet = locationStreet(deliveryLoc) || String(receiver.destinationLine || '').trim();

  const pickupDivisionId = String(pickupLoc.divisionId || pickupLoc.id || '');
  const deliveryDivisionId = String(deliveryLoc.divisionId || deliveryLoc.id || '');

  const contents = ['documents', 'clothing', 'shoes', 'cosmetics', 'electronics', 'gift', 'other']
    .includes(String(parcel.contents || ''))
    ? parcel.contents
    : 'gift';

  return {
    step: 8,
    toCountry,
    pickupType,
    deliveryType,
    sizeKey,
    customSize: {
      l: String(parcel.lengthCm ?? ''),
      w: String(parcel.widthCm ?? ''),
      h: String(parcel.heightCm ?? ''),
      kg: String(parcel.weightKg ?? ''),
    },
    contents,
    contentsNote: String(parcel.contentsNote || ''),
    contentValue: contentValueFromDeclared(parcel.insuredValueEur ?? parcel.declaredValue),
    payer: String(tariff.payer || 'sender').toLowerCase() === 'recipient'
      || String(tariff.payer || '').toLowerCase() === 'receiver'
      ? 'receiver'
      : 'sender',
    pickupStreet,
    pickupAddressQuery: pickupStreet,
    pickupCity,
    pickupPostal,
    destStreet,
    destCity,
    destPostal,
    destAddressQuery: destStreet,
    destAddressFocus: null,
    destAddressReady: Boolean(destStreet && destCity),
    pickupAddressFocus: null,
    pickupAddressReady: Boolean(pickupStreet && pickupCity),
    geoPickupCity: '',
    pickupCityFromGeo: false,
    pickupCityTouched: true,
    pickupDate: nextPickupDateIso(),
    pickupTime: 'within_day',
    pickupLocker: pickupType === 'locker' || pickupType === 'pudo' ? pickupDivisionId : '',
    pickupBranch: pickupType === 'branch' ? pickupDivisionId : '',
    destLocker: deliveryType === 'locker' || deliveryType === 'pudo' ? deliveryDivisionId : '',
    destBranch: deliveryType === 'branch' ? deliveryDivisionId : '',
    fragile: Boolean(parcel.fragile || tariff.fragile),
    insurance: Boolean(parcel.insurance || tariff.insurance),
    senderFirst: senderName.first,
    senderLast: senderName.last,
    senderEmail: String(sender.email || order.customerEmail || '').trim(),
    senderDial: senderPhone.dial,
    senderPhone: senderPhone.local,
    receiverFirst: String(receiver.firstName || '').trim(),
    receiverLast: String(receiver.lastName || '').trim(),
    receiverEmail: String(receiver.email || '').trim(),
    receiverDial: receiverPhone.dial,
    receiverPhone: receiverPhone.local,
    termsAccepted: true,
    sourceOrderNumber: order.orderNumber || null,
  };
}
