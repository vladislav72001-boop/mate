import type { CalcDraft } from './calcDraft';
import { PICKUP_COUNTRY, countryLabel } from '../../constants/shipping';

export function isMeaningfulCalcDraft(draft: CalcDraft): boolean {
  if (draft.step > 1) return true;
  if (draft.destCity.trim()) return true;
  if (draft.senderPhone.trim() || draft.receiverPhone.trim()) return true;
  if (draft.pickupAddressQuery.trim() || draft.pickupStreet.trim()) return true;
  if (draft.destAddressQuery.trim() || draft.destStreet.trim()) return true;
  return false;
}

export function calcDraftRouteLine(draft: CalcDraft, locale: string): string {
  const fromCity = draft.pickupCity.trim();
  const destCity = draft.destCity.trim();
  const from = fromCity || countryLabel(PICKUP_COUNTRY, locale);
  const to = destCity || countryLabel(draft.toCountry, locale);
  return `${from} → ${to}`;
}
