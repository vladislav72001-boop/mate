import type { Locale, MessageTree, TranslateVars } from './types';
import { messages } from './messages';

let runtimeLocale: Locale = 'ru';

export function setRuntimeLocale(locale: Locale) {
  runtimeLocale = locale;
}

export function getRuntimeLocale(): Locale {
  return runtimeLocale;
}

function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split('.');
  let cur: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur == null || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(text: string, vars?: TranslateVars) {
  if (!vars) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''));
}

export function createTranslator(locale: Locale) {
  const dict = messages[locale];
  return (key: string, vars?: TranslateVars) => {
    const hit = lookup(dict, key);
    if (hit) return interpolate(hit, vars);
    const fallback = lookup(messages.en, key);
    if (fallback) return interpolate(fallback, vars);
    return key;
  };
}

export function translateCountry(code: string, locale = runtimeLocale): string {
  const key = `countries.${code}`;
  const t = createTranslator(locale);
  const label = t(key);
  return label === key ? code : label;
}
