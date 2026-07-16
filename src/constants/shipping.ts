import { translateCountry, getRuntimeLocale } from '../i18n/translate';
import type { Locale } from '../i18n/types';

export type ParcelKey = 'S' | 'M' | 'L' | 'XL' | 'XXL';

export const PICKUP_COUNTRY = 'HU';

export const PARCEL_PRESETS: Record<ParcelKey, {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}> = {
  S: { lengthCm: 9, widthCm: 38, heightCm: 64, weightKg: 5 },
  M: { lengthCm: 19, widthCm: 38, heightCm: 64, weightKg: 10 },
  L: { lengthCm: 39, widthCm: 38, heightCm: 64, weightKg: 20 },
  XL: { lengthCm: 150, widthCm: 50, heightCm: 25, weightKg: 30 },
  XXL: { lengthCm: 250, widthCm: 50, heightCm: 25, weightKg: 100 },
};

export const COUNTRIES = [
  { code: 'HU', label: 'Венгрия', flag: '🇭🇺' },
  { code: 'PL', label: 'Польша', flag: '🇵🇱' },
  { code: 'DE', label: 'Германия', flag: '🇩🇪' },
  { code: 'FR', label: 'Франция', flag: '🇫🇷' },
  { code: 'ES', label: 'Испания', flag: '🇪🇸' },
  { code: 'IT', label: 'Италия', flag: '🇮🇹' },
  { code: 'CZ', label: 'Чехия', flag: '🇨🇿' },
  { code: 'SK', label: 'Словакия', flag: '🇸🇰' },
  { code: 'AT', label: 'Австрия', flag: '🇦🇹' },
  { code: 'RO', label: 'Румыния', flag: '🇷🇴' },
  { code: 'UA', label: 'Украина', flag: '🇺🇦' },
  { code: 'LT', label: 'Литва', flag: '🇱🇹' },
  { code: 'LV', label: 'Латвия', flag: '🇱🇻' },
  { code: 'EE', label: 'Эстония', flag: '🇪🇪' },
  { code: 'NL', label: 'Нидерланды', flag: '🇳🇱' },
  { code: 'BE', label: 'Бельгия', flag: '🇧🇪' },
  { code: 'GB', label: 'Великобритания', flag: '🇬🇧' },
  { code: 'MD', label: 'Молдова', flag: '🇲🇩' },
] as const;

export const PICKUP_TIMES = [
  '10:00-11:30',
  '11:30-13:00',
  '13:00-14:30',
  '14:30-16:00',
  '16:00-17:30',
  '17:30-19:00',
];

export const PHONE_PREFIXES = [
  { dial: '+36', code: 'HU', label: 'Венгрия +36' },
  { dial: '+48', code: 'PL', label: 'Польша +48' },
  { dial: '+49', code: 'DE', label: 'Германия +49' },
  { dial: '+420', code: 'CZ', label: 'Чехия +420' },
  { dial: '+421', code: 'SK', label: 'Словакия +421' },
  { dial: '+43', code: 'AT', label: 'Австрия +43' },
  { dial: '+40', code: 'RO', label: 'Румыния +40' },
  { dial: '+380', code: 'UA', label: 'Украина +380' },
  { dial: '+370', code: 'LT', label: 'Литва +370' },
  { dial: '+371', code: 'LV', label: 'Латвия +371' },
  { dial: '+372', code: 'EE', label: 'Эстония +372' },
  { dial: '+33', code: 'FR', label: 'Франция +33' },
  { dial: '+34', code: 'ES', label: 'Испания +34' },
  { dial: '+39', code: 'IT', label: 'Италия +39' },
  { dial: '+31', code: 'NL', label: 'Нидерланды +31' },
  { dial: '+32', code: 'BE', label: 'Бельгия +32' },
  { dial: '+44', code: 'GB', label: 'Великобритания +44' },
  { dial: '+373', code: 'MD', label: 'Молдова +373' },
];

export const DIAL_BY_CC: Record<string, string> = {
  HU: '+36', PL: '+48', DE: '+49', CZ: '+420', SK: '+421',
  RO: '+40', UA: '+380', LT: '+370', LV: '+371', EE: '+372',
  FR: '+33', ES: '+34', IT: '+39', NL: '+31', BE: '+32', GB: '+44', MD: '+373', AT: '+43',
};

export const FRAGILE_FEE_EUR = 1.98;
export const INSURANCE_RATE = 0.01;
export const DEFAULT_QUOTE_CURRENCY = 'HUF';

/** EUR → quote currency (aligned with server shipping.mjs). */
export const EUR_TO_CURRENCY: Record<string, number> = {
  EUR: 1,
  HUF: 400,
  PLN: 4.3,
  CZK: 25,
  RON: 5,
};

export function eurToQuoteCurrency(amountEur: number, currencyCode: string) {
  const code = (currencyCode || DEFAULT_QUOTE_CURRENCY).toUpperCase();
  if (!Number.isFinite(amountEur) || amountEur === 0) return 0;
  if (code === 'EUR') return amountEur;
  const rate = EUR_TO_CURRENCY[code];
  if (!rate) return 0;
  return amountEur * rate;
}

/** Format price for calculator UI (HUF without decimals). */
export function formatQuoteMoney(amount: number, currencyCode = DEFAULT_QUOTE_CURRENCY) {
  const code = (currencyCode || DEFAULT_QUOTE_CURRENCY).toUpperCase();
  if (code === 'HUF') {
    return `${Math.round(amount).toLocaleString('hu-HU')} HUF`;
  }
  return `${amount.toFixed(2)} ${code}`;
}

/** Local price estimate when Nova Post API is unavailable */
export function estimateParcelPrice(preset: {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}, currency = DEFAULT_QUOTE_CURRENCY) {
  const weightKg = Math.max(0.1, preset.weightKg);
  const volumetricKg = (preset.lengthCm * preset.widthCm * preset.heightCm) / 5000;
  const chargeableKg = Math.max(weightKg, volumetricKg);
  const baseEur = 12 + chargeableKg * 2.1;
  const inCurrency = eurToQuoteCurrency(Math.round(baseEur * 100) / 100, currency);
  return currency === 'HUF' ? Math.round(inCurrency) : Math.round(inCurrency * 100) / 100;
}

export function countryLabel(code: string, locale?: Locale) {
  return translateCountry(code, locale ?? getRuntimeLocale());
}

export function countryFlag(code: string) {
  return COUNTRIES.find((c) => c.code === code)?.flag || '';
}

export function labelToCode(label: string) {
  const found = COUNTRIES.find((c) => c.label === label || `${c.flag} ${c.label}` === label);
  return found?.code || 'HU';
}

/** Build E.164 phone from dial prefix + local input (strip duplicate country code). */
export function composePhone(dial: string, local: string) {
  const cc = dial.replace('+', '');
  let digits = local.replace(/[\s\u00A0\-().]/g, '').replace(/^0+/, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith(cc)) digits = digits.slice(cc.length).replace(/^0+/, '');
  return `+${cc}${digits}`;
}

const MAX_NATIONAL_DIGITS: Record<string, number> = {
  HU: 9, DE: 11, PL: 9, CZ: 9, SK: 9, RO: 9, UA: 9,
  FR: 9, ES: 9, IT: 10, GB: 10, NL: 9, BE: 9, LT: 8, LV: 8, EE: 8, MD: 8, AT: 10,
};

const DIAL_TO_COUNTRY: Record<string, string> = {
  '+36': 'HU', '+48': 'PL', '+49': 'DE', '+420': 'CZ', '+421': 'SK',
  '+43': 'AT', '+40': 'RO', '+380': 'UA', '+370': 'LT', '+371': 'LV',
  '+372': 'EE', '+33': 'FR', '+34': 'ES', '+39': 'IT', '+31': 'NL',
  '+32': 'BE', '+44': 'GB', '+373': 'MD',
};

export function countryCodeFromDial(dial: string): string {
  const normalized = String(dial || '').trim();
  if (!normalized) return 'HU';
  const withPlus = normalized.startsWith('+') ? normalized : `+${normalized.replace(/\D/g, '')}`;
  const sorted = Object.keys(DIAL_TO_COUNTRY).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (withPlus.startsWith(prefix)) return DIAL_TO_COUNTRY[prefix];
  }
  const fromList = PHONE_PREFIXES.find((p) => p.dial === withPlus)?.code;
  return fromList || 'HU';
}

export function validatePhone(dial: string, local: string, countryCode: string, label: string): string | null {
  const country = countryCodeFromDial(dial) || countryCode.toUpperCase();
  const maxNational = MAX_NATIONAL_DIGITS[country] || 10;
  const cc = dial.replace('+', '');

  let digits = local.replace(/[\s\u00A0\-().]/g, '').replace(/^0+/, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith(cc)) digits = digits.slice(cc.length).replace(/^0+/, '');

  if (!digits) return `${label}: укажите номер телефона`;
  if (digits.length < 6) return `${label}: слишком короткий номер`;
  if (digits.length > maxNational) {
    return `${label}: слишком много цифр для ${country} (макс. ${maxNational} без кода ${dial})`;
  }
  return null;
}

export function validateEmail(email: string, label = 'Email'): string | null {
  const v = email.trim().toLowerCase();
  if (!v) return `${label}: укажите email`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `${label}: некорректный формат`;
  return null;
}

export function validatePersonName(name: string, label: string): string | null {
  const raw = name.trim().replace(/[—–-]+/g, ' ');
  const words = raw.match(/[\p{L}][\p{L}\s'.]*/gu) ?? [];
  const cleaned = words.map((w) => w.trim()).filter((w) => w.length >= 2).join(' ').trim();
  if (cleaned.length < 3) {
    return `${label}: укажите буквами, минимум 2 буквы (не только цифры)`;
  }
  return null;
}

export function countryFromDial(dial: string) {
  return DIAL_TO_COUNTRY[dial] || 'HU';
}
