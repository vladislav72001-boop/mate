import type { CalcDraft } from './calcDraft';
import { PICKUP_COUNTRY, countryLabel } from '../../constants/shipping';

export function isMeaningfulCalcDraft(draft: CalcDraft): boolean {
  // Step 1 is country only — auto-filled cities there should not surface as "unfinished shipment".
  if (draft.step < 2) return false;
  if (draft.step > 2) return true;
  return Boolean(
    draft.destCity.trim()
    || draft.pickupCity.trim()
    || draft.senderPhone.trim()
    || draft.receiverPhone.trim()
    || draft.pickupAddressQuery.trim()
    || draft.pickupStreet.trim()
    || draft.destAddressQuery.trim()
    || draft.destStreet.trim(),
  );
}

export function calcDraftRouteLine(draft: CalcDraft, locale: string): string {
  const fromCity = draft.pickupCity.trim();
  const destCity = draft.destCity.trim();
  const from = fromCity || countryLabel(PICKUP_COUNTRY, locale);
  const to = destCity || countryLabel(draft.toCountry, locale);
  return `${from} → ${to}`;
}
