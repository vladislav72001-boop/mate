import { translateCountry, getRuntimeLocale } from '../i18n/translate';
import type { Locale } from '../i18n/types';
import {
  getCountries,
  getCountryCallingCode,
} from 'libphonenumber-js';

export type ParcelKey = 'S' | 'M' | 'L' | 'XL';

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

/**
 * Complete ISO country/region calling-code catalog from libphonenumber metadata.
 * Calling codes are sorted numerically (+1, +7, +20, +27, +30...) like Apple's
 * enrollment form. Regions sharing a calling code remain separate choices.
 */
export const PHONE_PREFIXES = getCountries()
  .map((code) => ({
    dial: `+${getCountryCallingCode(code)}`,
    code,
  }))
  .sort((a, b) => {
    const byDial = Number(a.dial.slice(1)) - Number(b.dial.slice(1));
    return byDial || a.code.localeCompare(b.code);
  });

export const DIAL_BY_CC: Record<string, string> = Object.fromEntries(
  PHONE_PREFIXES.map(({ code, dial }) => [code, dial]),
);

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

export function countryCodeFromDial(dial: string, preferredCountry?: string): string {
  const normalized = String(dial || '').trim();
  if (!normalized) return 'HU';
  const withPlus = normalized.startsWith('+') ? normalized : `+${normalized.replace(/\D/g, '')}`;
  const preferred = String(preferredCountry || '').toUpperCase();
  if (preferred && DIAL_BY_CC[preferred] === withPlus) {
    return preferred;
  }
  const fromList = PHONE_PREFIXES.find((p) => p.dial === withPlus)?.code;
  return fromList || 'HU';
}

export function validatePhone(dial: string, local: string, countryCode: string, label: string): string | null {
  const cc = dial.replace('+', '');

  let digits = local.replace(/[\s\u00A0\-().]/g, '').replace(/^0+/, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith(cc)) digits = digits.slice(cc.length).replace(/^0+/, '');

  if (!digits) return `${label}: укажите номер телефона`;
  if (digits.length < 6) return `${label}: слишком короткий номер`;
  // E.164 allows at most 15 digits including the country calling code.
  if ((cc + digits).length > 15) {
    return `${label}: слишком много цифр (максимум 15 вместе с кодом страны)`;
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
  return countryCodeFromDial(dial);
}
