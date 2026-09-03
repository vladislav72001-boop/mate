import { validateNovaPostParcelRules } from './novapost/parcel.mjs';

/** Returns Nova Post dimension/weight error text, or null when parcel fits official NP rules. */
export function novaPostParcelBlockedReason(lengthCm, widthCm, heightCm, weightKg) {
  return validateNovaPostParcelRules(lengthCm, widthCm, heightCm, weightKg);
}

/** Matrix fallback is only for NP API/network failures — never for out-of-spec parcels. */
export function allowMatrixFallback({ lengthCm, widthCm, heightCm, weightKg }) {
  return !novaPostParcelBlockedReason(lengthCm, widthCm, heightCm, weightKg);
}
