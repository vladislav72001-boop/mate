/**
 * Orientative Nova Post transit bands from Hungary (business days).
 * Official NP: domestic from 1 BD, international from 5 BD — not guaranteed.
 */
export function deliveryEtaForCountry(toCountry) {
  const code = String(toCountry || '').trim().toUpperCase();
  if (!code || code === 'HU') {
    return { minDays: 1, maxDays: 3, zone: 'domestic' };
  }
  if (['SK', 'AT', 'CZ', 'PL', 'RO', 'SI', 'HR'].includes(code)) {
    return { minDays: 4, maxDays: 7, zone: 'near' };
  }
  if (['DE', 'IT', 'LT', 'LV', 'EE'].includes(code)) {
    return { minDays: 5, maxDays: 9, zone: 'core' };
  }
  if (['FR', 'NL', 'BE', 'ES', 'GB', 'PT', 'IE', 'UA', 'MD'].includes(code)) {
    return { minDays: 8, maxDays: 14, zone: 'far' };
  }
  return { minDays: 7, maxDays: 14, zone: 'far' };
}
