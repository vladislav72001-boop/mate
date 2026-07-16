import type { Locale } from './types';

export const LOCALE_STORAGE_KEY = 'mate-locale';

export type LocaleOption = {
  code: Locale;
  flag: string;
  nativeName: string;
};

export const LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'en', flag: 'gb', nativeName: 'English' },
  { code: 'hu', flag: 'hu', nativeName: 'Magyar' },
  { code: 'ru', flag: 'ru', nativeName: 'Русский' },
  { code: 'uk', flag: 'ua', nativeName: 'Українська' },
];

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'en' || stored === 'hu' || stored === 'ru' || stored === 'uk') return stored;
  } catch {
    /* ignore */
  }
  const lang = (navigator.language || 'en').toLowerCase();
  if (lang.startsWith('hu')) return 'hu';
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('uk') || lang.startsWith('ua')) return 'uk';
  return 'en';
}

export function localeToHtmlLang(locale: Locale): string {
  return locale === 'uk' ? 'uk' : locale;
}

export function localeToIntl(locale: Locale): string {
  switch (locale) {
    case 'hu': return 'hu-HU';
    case 'ru': return 'ru-RU';
    case 'uk': return 'uk-UA';
    default: return 'en-GB';
  }
}
