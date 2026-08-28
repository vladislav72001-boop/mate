/**
 * Transliterate RU/UK/HU text to Latin before Nova Post API calls.
 * NP international docs: sender/recipient names must use Latin characters.
 */

const CYRILLIC_LOWER = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // Ukrainian
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

const HUNGARIAN = {
  á: 'a', Á: 'A', é: 'e', É: 'E', í: 'i', Í: 'I',
  ó: 'o', Ó: 'O', ö: 'o', Ö: 'O', ő: 'o', Ő: 'O',
  ú: 'u', Ú: 'U', ü: 'u', Ü: 'U', ű: 'u', Ű: 'U',
};

function capitalizeRepl(ch, repl) {
  if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) {
    if (repl.length === 1) return repl.toUpperCase();
    return repl.charAt(0).toUpperCase() + repl.slice(1);
  }
  return repl;
}

function transliterateCyrillicChar(ch) {
  const lower = ch.toLowerCase();
  const repl = CYRILLIC_LOWER[lower];
  if (repl == null) return ch;
  return capitalizeRepl(ch, repl);
}

/** True when string contains Cyrillic or Hungarian extended letters. */
export function needsLatinTransliteration(text) {
  return /[\u0400-\u04FF\u1E00-\u1EFF]/.test(String(text || ''));
}

/** RU/UK Cyrillic + HU accents → Latin (ASCII-friendly). */
export function transliterateToLatin(input) {
  if (input == null) return input;
  let s = String(input);
  if (!s.trim()) return s;

  for (const [from, to] of Object.entries(HUNGARIAN)) {
    s = s.split(from).join(to);
  }

  // NFD strips most Latin accents (é→e if not in HUNGARIAN map).
  s = s.normalize('NFD').replace(/\p{M}/gu, '');

  let out = '';
  for (const ch of s) {
    out += transliterateCyrillicChar(ch);
  }

  return out
    .replace(/[^\x20-\x7E\u00A0-\u024F]/g, (ch) => transliterateCyrillicChar(ch))
    .replace(/\s+/g, ' ')
    .trim();
}

export function transliteratePersonName(name) {
  return transliterateToLatin(name);
}

export function transliterateAddressParts(parts) {
  if (!parts || typeof parts !== 'object') return parts;
  const out = { ...parts };
  for (const key of ['city', 'region', 'street', 'building', 'flat', 'block', 'note']) {
    if (out[key]) out[key] = transliterateToLatin(String(out[key]));
  }
  return out;
}
