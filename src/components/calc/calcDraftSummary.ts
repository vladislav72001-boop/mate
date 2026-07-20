import type { CalcDraft } from './calcDraft';
import { MIN_DRAFT_BANNER_STEP } from './calcDraft';
import { PICKUP_COUNTRY, countryLabel } from '../../constants/shipping';

export { MIN_DRAFT_BANNER_STEP };

export function isMeaningfulCalcDraft(draft: CalcDraft): boolean {
  return draft.step >= MIN_DRAFT_BANNER_STEP;
}

export function calcDraftRouteLine(draft: CalcDraft, locale: string): string {
  const fromCity = draft.pickupCity.trim();
  const destCity = draft.destCity.trim();
  const from = fromCity || countryLabel(PICKUP_COUNTRY, locale);
  const to = destCity || countryLabel(draft.toCountry, locale);
  return `${from} → ${to}`;
}
