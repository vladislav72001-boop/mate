/** Approximate country centers for map fallback (lat, lng). */
export const COUNTRY_COORDS: Record<string, [number, number]> = {
  HU: [47.4979, 19.0402],
  PL: [52.2297, 21.0122],
  DE: [52.52, 13.405],
  FR: [48.8566, 2.3522],
  ES: [40.4168, -3.7038],
  IT: [41.9028, 12.4964],
  CZ: [50.0755, 14.4378],
  SK: [48.1486, 17.1077],
  RO: [44.4268, 26.1025],
  UA: [50.4501, 30.5234],
  LT: [54.6872, 25.2797],
  LV: [56.9496, 24.1052],
  EE: [59.437, 24.7536],
  NL: [52.3676, 4.9041],
  GB: [51.5074, -0.1278],
  MD: [47.0105, 28.8638],
  AT: [48.2082, 16.3738],
  BE: [50.8503, 4.3517],
};

export async function geocodeAddress(query: string, countryCode: string): Promise<[number, number] | null> {
  const q = query.trim();
  if (q.length < 3) return null;
  try {
    const params = new URLSearchParams({
      q,
      countrycodes: countryCode.toLowerCase(),
      format: 'json',
      limit: '1',
      addressdetails: '1',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ lat?: string; lon?: string }>;
    const hit = data[0];
    if (!hit?.lat || !hit?.lon) return null;
    return [Number(hit.lat), Number(hit.lon)];
  } catch {
    return null;
  }
}

export async function resolveMapPoint(countryCode: string, addressLine?: string): Promise<[number, number]> {
  const cc = countryCode.toUpperCase();
  if (addressLine) {
    const geo = await geocodeAddress(addressLine, cc);
    if (geo) return geo;
  }
  return COUNTRY_COORDS[cc] || COUNTRY_COORDS.HU;
}
