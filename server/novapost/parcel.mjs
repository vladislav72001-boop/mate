const PARCEL_LIMITS_BY_TIER = {
  S: { maxLongestCm: 64, maxGirthCm: 200, maxWeightKg: 5 },
  M: { maxLongestCm: 64, maxGirthCm: 220, maxWeightKg: 10 },
  L: { maxLongestCm: 64, maxGirthCm: 240, maxWeightKg: 20 },
  XL: { maxLongestCm: 150, maxGirthCm: 300, maxWeightKg: 30 },
  XXL: { maxLongestCm: 250, maxGirthCm: 400, maxWeightKg: 100 },
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

export function validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits) {
  const [longest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  const girth = parcelGirthCm(lengthCm, widthCm, heightCm);
  if (longest > limits.maxLongestCm) {
    return `Longest side ${longest.toFixed(0)} cm exceeds limit ${limits.maxLongestCm} cm`;
  }
  if (girth > limits.maxGirthCm) {
    return `Girth ${girth.toFixed(0)} cm exceeds limit ${limits.maxGirthCm} cm`;
  }
  return null;
}

export function inferParcelTier(lengthCm, widthCm, heightCm, weightKg) {
  for (const tier of ['S', 'M', 'L', 'XL', 'XXL']) {
    const limits = PARCEL_LIMITS_BY_TIER[tier];
    if (
      validateParcelDimensionsCm(lengthCm, widthCm, heightCm, limits) === null &&
      weightKg <= limits.maxWeightKg
    ) {
      return tier;
    }
  }
  return 'custom';
}

export function resolveParcelLimits(lengthCm, widthCm, heightCm, weightKg, boxSize) {
  const tier = String(boxSize || '').toUpperCase();
  if (tier in PARCEL_LIMITS_BY_TIER) return PARCEL_LIMITS_BY_TIER[tier];
  const inferred = inferParcelTier(lengthCm, widthCm, heightCm, weightKg);
  if (inferred !== 'custom') return PARCEL_LIMITS_BY_TIER[inferred];
  return PARCEL_LIMITS_BY_TIER.XXL;
}

export function normalizeParcelDimensionsMm(lengthCm, widthCm, heightCm) {
  const [longest, middle, shortest] = sortedSidesCm(lengthCm, widthCm, heightCm);
  const toMm = (cm) => Math.max(1, Math.round(cm * 10));
  return { length: toMm(longest), width: toMm(middle), height: toMm(shortest) };
}

export function capParcelDimensionsMmForShipment(lengthCm, widthCm, heightCm) {
  const dims = normalizeParcelDimensionsMm(lengthCm, widthCm, heightCm);
  const maxLength = Number(process.env.NOVAPOST_MAX_LENGTH_MM ?? 600);
  const maxWidth = Number(process.env.NOVAPOST_MAX_WIDTH_MM ?? 600);
  const maxHeight = Number(process.env.NOVAPOST_MAX_HEIGHT_MM ?? 600);
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

/** Nova Post Sender API rejects >20 kg for typical international parcel tiers. */
export function capWeightGramsForShipment(weightKg) {
  const maxKg = Number(process.env.NOVAPOST_MAX_WEIGHT_KG ?? 20);
  const grams = Math.max(1, Math.round(Math.min(weightKg, maxKg) * 1000));
  return { grams, capped: weightKg > maxKg };
}
