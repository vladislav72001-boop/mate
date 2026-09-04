/**
 * Parcel limits.
 *
 * Official Nova Post (HU / EU parcels & documents):
 * - Documents: ≤35×25×2 cm, actual weight ≤1 kg
 * - Parcels: actual & volumetric weight ≤30 kg,
 *   longest side ≤120 cm, sum of three sides ≤150 cm
 * Source: https://novapost.com/en-hu/send/parcels-and-documents/
 *
 * Size tiers XS–XL are Mate UI buckets (locker/branch fit); CUSTOM uses NP rules.
 */
const PARCEL_LIMITS_BY_TIER = {
  XS: { maxLongestCm: 50, maxGirthCm: 180, maxWeightKg: 1 },
  S: { maxLongestCm: 60, maxGirthCm: 200, maxWeightKg: 5 },
  M: { maxLongestCm: 60, maxGirthCm: 220, maxWeightKg: 10 },
  L: { maxLongestCm: 60, maxGirthCm: 240, maxWeightKg: 20 },
  XL: { maxLongestCm: 120, maxGirthCm: 300, maxWeightKg: 30 },
  // Official NP parcel envelope (not girth — sum of sides).
  CUSTOM: { maxLongestCm: 120, maxSumSidesCm: 150, maxWeightKg: 30 },
};

/** Official Nova Post parcel hard caps (create + quote). */
export const NOVAPOST_PARCEL_RULES = {
  maxWeightKg: 30,
  maxLongestCm: 120,
  maxSumSidesCm: 150,
  documents: {
    lengthCm: 35,
    widthCm: 25,
    heightCm: 2,
    maxWeightKg: 1,
  },
};

export function sortedSidesCm(lengthCm, widthCm, heightCm) {
  const sides = [lengthCm, widthCm, heightCm]
    .map((cm) => Math.max(0.1, Number(cm) || 0.1))
    .sort((a, b) => b - a);
  return [sides[0], sides[1], sides[2]];
}

export function parcelGirthCm(lengthCm, widthCm, heightCm) {
  const [longest, middle, shortest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  return longest + 2 * (middle + shortest);
}

export function parcelSumSidesCm(lengthCm, widthCm, heightCm) {
  return sortedSidesCm(lengthCm, widthCm, heightCm)
    .reduce((sum, side) => sum + side, 0);
}

export function validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits) {
  const [longest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  if (longest > limits.maxLongestCm) {
    return `Longest side ${longest.toFixed(0)} cm exceeds limit ${limits.maxLongestCm} cm`;
  }
  if (limits.maxSumSidesCm != null) {
    const sum = parcelSumSidesCm(lengthCm, widthCm, heightCm);
    if (sum > limits.maxSumSidesCm) {
      return `Sum of sides ${sum.toFixed(0)} cm exceeds Nova Post limit ${limits.maxSumSidesCm} cm`;
    }
  }
  if (limits.maxGirthCm != null) {
    const girth = parcelGirthCm(lengthCm, widthCm, heightCm);
    if (girth > limits.maxGirthCm) {
      return `Girth ${girth.toFixed(0)} cm exceeds limit ${limits.maxGirthCm} cm`;
    }
  }
  return null;
}

/** Fail closed against official NP parcel rules (used at shipment create). */
/** Official NP documents: ≤35×25×2 cm and ≤1 kg (any boxSize key). */
export function isNovaPostDocumentsParcel(lengthCm, widthCm, heightCm, weightKg, boxSize) {
  const key = String(boxSize || '').toUpperCase();
  if (['XS', 'ENVELOPE', 'DOCUMENTS'].includes(key)) return true;
  const docs = NOVAPOST_PARCEL_RULES.documents;
  if (Number(weightKg) > docs.maxWeightKg) return false;
  const [longest, middle, shortest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  return longest <= docs.lengthCm
    && middle <= docs.widthCm
    && shortest <= docs.heightCm;
}

export function validateNovaPostParcelRules(lengthCm, widthCm, heightCm, weightKg) {
  const rules = NOVAPOST_PARCEL_RULES;
  if (weightKg > rules.maxWeightKg) {
    return `Weight ${weightKg} kg exceeds Nova Post limit ${rules.maxWeightKg} kg`;
  }
  return validateParcelDimensionsCm(lengthCm, widthCm, heightCm, {
    maxLongestCm: rules.maxLongestCm,
    maxSumSidesCm: rules.maxSumSidesCm,
  });
}

export function inferParcelTier(lengthCm, widthCm, heightCm, weightKg) {
  for (const tier of ['XS', 'S', 'M', 'L', 'XL']) {
    const limits = PARCEL_LIMITS_BY_TIER[tier];
    if (
      validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits) === null &&
      weightKg <= limits.maxWeightKg
    ) {
      return tier;
    }
  }
  if (
    validateParcelDimensionsCm(lengthCm, widthCm, heightCm, PARCEL_LIMITS_BY_TIER.CUSTOM) === null
    && weightKg <= PARCEL_LIMITS_BY_TIER.CUSTOM.maxWeightKg
  ) {
    return 'custom';
  }
  return 'custom';
}

export function resolveParcelLimits(lengthCm, widthCm, heightCm, weightKg, boxSize) {
  const tier = String(boxSize || '').toUpperCase().replace(/^CUSTOM:.*/, 'CUSTOM');
  const inferred = inferParcelTier(lengthCm, widthCm, heightCm, weightKg);
  const inferredLimits = inferred !== 'custom'
    ? PARCEL_LIMITS_BY_TIER[inferred]
    : PARCEL_LIMITS_BY_TIER.CUSTOM;

  // Explicit CUSTOM always uses official NP parcel rules (never fall back to a looser tier).
  if (tier === 'CUSTOM') {
    return PARCEL_LIMITS_BY_TIER.CUSTOM;
  }

  // Prefer explicit tier only when the parcel actually fits it (avoids S + 20 kg false rejects).
  if (tier in PARCEL_LIMITS_BY_TIER) {
    const explicit = PARCEL_LIMITS_BY_TIER[tier];
    const dimErr = validateParcelDimensionsCm(lengthCm, widthCm, heightCm, explicit);
    if (!dimErr && weightKg <= explicit.maxWeightKg) return explicit;
    return inferredLimits;
  }
  return inferredLimits;
}

export function normalizeParcelDimensionsMm(lengthCm, widthCm, heightCm) {
  const [longest, middle, shortest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  const toMm = (cm) => Math.max(1, Math.round(cm * 10));
  return { length: toMm(longest), width: toMm(middle), height: toMm(shortest) };
}

export function capParcelDimensionsMmForShipment(lengthCm, widthCm, heightCm) {
  const dims = normalizeParcelDimensionsMm(lengthCm, widthCm, heightCm);
  // Official NP max side = 120 cm. Defaults used to be 60 cm (wrong, like the old 20 kg cap).
  const maxLength = Number(process.env.NOVAPOST_MAX_LENGTH_MM ?? 1200);
  const maxWidth = Number(process.env.NOVAPOST_MAX_WIDTH_MM ?? 1200);
  const maxHeight = Number(process.env.NOVAPOST_MAX_HEIGHT_MM ?? 1200);
  const maxSorted = [maxLength, maxWidth, maxHeight].sort((a, b) => b - a);
  const sides = [dims.length, dims.width, dims.height];

  if (sides[0] <= maxSorted[0] && sides[1] <= maxSorted[1] && sides[2] <= maxSorted[2]) {
    return { ...dims, capped: false };
  }

  const scale = Math.min(
    maxSorted[0] / sides[0],
    maxSorted[1] / sides[1],
    maxSorted[2] / sides[2],
    1,
  );

  return {
    length: Math.max(1, Math.round(sides[0] * scale)),
    width: Math.max(1, Math.round(sides[1] * scale)),
    height: Math.max(1, Math.round(sides[2] * scale)),
    capped: scale < 1,
  };
}

/** Nova Post parcels: official max 30 kg. */
export function capWeightGramsForShipment(weightKg) {
  const maxKg = Number(process.env.NOVAPOST_MAX_WEIGHT_KG ?? NOVAPOST_PARCEL_RULES.maxWeightKg);
  const grams = Math.max(1, Math.round(Math.min(weightKg, maxKg) * 1000));
  return { grams, capped: weightKg > maxKg };
}
