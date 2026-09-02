/**
 * Orientative Nova Post transit bands from Hungary.
 * NP offer: domestic from 1 BD, international from 5 BD — not guaranteed.
 * Far West (FR/ES/GB/…) often runs longer in practice (~10+ calendar days).
 */
export type DeliveryEtaBand = {
  minDays: number;
  maxDays: number;
  zone: 'domestic' | 'near' | 'core' | 'far';
};

const NEAR = new Set(['SK', 'AT', 'CZ', 'PL', 'RO', 'SI', 'HR']);
const CORE = new Set(['DE', 'IT', 'LT', 'LV', 'EE']);
const FAR = new Set(['FR', 'NL', 'BE', 'ES', 'GB', 'PT', 'IE', 'UA', 'MD']);

export function deliveryEtaForCountry(toCountry?: string | null): DeliveryEtaBand {
  const code = String(toCountry || '').trim().toUpperCase();
  if (code === 'RU') {
    return { minDays: 10, maxDays: 20, zone: 'far' };
  }
  if (!code || code === 'HU') {
    return { minDays: 1, maxDays: 3, zone: 'domestic' };
  }
  if (NEAR.has(code)) {
    return { minDays: 4, maxDays: 7, zone: 'near' };
  }
  if (CORE.has(code)) {
    return { minDays: 5, maxDays: 9, zone: 'core' };
  }
  if (FAR.has(code)) {
    return { minDays: 8, maxDays: 14, zone: 'far' };
  }
  // Unknown international destination — stay conservative.
  return { minDays: 7, maxDays: 14, zone: 'far' };
}
