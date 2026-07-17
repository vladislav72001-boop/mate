import { normalizeCountryCode } from './novapost/calculate.mjs';
import { inferParcelTier, resolveParcelLimits, validateParcelDimensionsCm } from './novapost/parcel.mjs';

const CALLING_CODE_BY_ISO2 = {
  CZ: '420', DE: '49', EE: '372', ES: '34', FR: '33', GB: '44',
  HU: '36', IT: '39', LT: '370', LV: '371', MD: '373', NL: '31',
  PL: '48', RO: '40', SK: '421', UA: '380',
};

const MAX_NATIONAL_DIGITS = {
  HU: 9, DE: 11, PL: 9, CZ: 9, SK: 9, RO: 9, UA: 9,
  FR: 9, ES: 9, IT: 10, GB: 10, NL: 9, LT: 8, LV: 8, EE: 8, MD: 8,
};

const MAX_NP_WEIGHT_KG = Number(process.env.NOVAPOST_MAX_WEIGHT_KG ?? 20);

function validatePersonName(name, label) {
  const raw = String(name ?? '').trim().replace(/[—–-]+/g, ' ');
  const words = raw.match(/[\p{L}][\p{L}\s'.]*/gu) ?? [];
  const cleaned = words.map((w) => w.trim()).filter((w) => w.length >= 2).join(' ').trim();
  if (cleaned.length < 3) {
    return `${label}: укажите имя буквами (не только цифры), минимум 2 буквы`;
  }
  return null;
}

function validatePhone(raw, countryCode, label) {
  const country = normalizeCountryCode(countryCode);
  const cc = CALLING_CODE_BY_ISO2[country] || '48';
  const maxNational = MAX_NATIONAL_DIGITS[country] || 10;

  let digits = String(raw ?? '').trim().replace(/[\s\u00A0\-().]/g, '').replace(/^\+/, '');
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(cc)) digits = digits.slice(cc.length);
  digits = digits.replace(/^0+/, '');

  if (!digits) {
    return `${label}: укажите номер телефона`;
  }
  if (digits.length < 6) {
    return `${label}: слишком короткий номер`;
  }
  if (digits.length > maxNational) {
    return `${label}: слишком много цифр для ${country} (максимум ${maxNational} без кода страны +${cc})`;
  }
  return null;
}

function validateEmail(email, label) {
  const v = String(email ?? '').trim().toLowerCase();
  if (!v) return `${label}: укажите email`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return `${label}: некорректный формат email`;
  }
  return null;
}

export function validateCheckoutBody(body) {
  const errors = [];
  const sender = body.sender || {};
  const receiver = body.receiver || {};
  const parcel = body.parcel || {};
  const tariff = body.tariff || {};

  const emailErr = validateEmail(body.customerEmail || sender.email, 'Email');
  if (emailErr) errors.push(emailErr);

  const senderNameErr = validatePersonName(sender.name, 'Имя отправителя');
  if (senderNameErr) errors.push(senderNameErr);

  const senderPhoneErr = validatePhone(sender.phone, sender.country || 'HU', 'Телефон отправителя');
  if (senderPhoneErr) errors.push(senderPhoneErr);

  const receiverFirstErr = validatePersonName(receiver.firstName, 'Имя получателя');
  const receiverLastErr = validatePersonName(receiver.lastName, 'Фамилия получателя');
  if (receiverFirstErr && receiverLastErr) {
    errors.push('Получатель: укажите имя и фамилию буквами');
  }

  const receiverPhoneErr = validatePhone(
    receiver.phone,
    receiver.country || tariff.toCountry || 'PL',
    'Телефон получателя',
  );
  if (receiverPhoneErr) errors.push(receiverPhoneErr);

  const weightKg = Number(parcel.weightKg ?? 0);
  const lengthCm = Number(parcel.lengthCm ?? 0);
  const widthCm = Number(parcel.widthCm ?? 0);
  const heightCm = Number(parcel.heightCm ?? 0);
  const boxSize = String(parcel.boxSize || '');

  if (!weightKg || !lengthCm || !widthCm || !heightCm) {
    errors.push('Посылка: укажите размер и вес');
  } else {
    const limits = resolveParcelLimits(lengthCm, widthCm, heightCm, weightKg, boxSize);
    const dimErr = validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits);
    if (dimErr) errors.push(`Посылка: ${dimErr}`);
    if (weightKg > limits.maxWeightKg) {
      const tierLabel = boxSize || inferParcelTier(lengthCm, widthCm, heightCm, weightKg);
      errors.push(`Посылка: вес ${weightKg} кг превышает лимит ${limits.maxWeightKg} кг для размера ${tierLabel}`);
    }
    if (weightKg > MAX_NP_WEIGHT_KG) {
      errors.push(`Посылка: Nova Post принимает до ${MAX_NP_WEIGHT_KG} кг на одну отправку`);
    }
  }

  const toCountry = normalizeCountryCode(receiver.country || tariff.toCountry);
  if (!toCountry || toCountry.length !== 2) {
    errors.push('Укажите страну получателя');
  }

  return { ok: errors.length === 0, errors };
}
