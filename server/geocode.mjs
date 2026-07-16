/** City value + localized labels for canonical matching */
const CITY_ENTRIES = {
  HU: [
    { value: 'Budapest', labels: ['Будапешт', 'Budapest'] },
    { value: 'Debrecen', labels: ['Дебрецен', 'Debrecen'] },
    { value: 'Szeged', labels: ['Сегед', 'Szeged'] },
    { value: 'Pécs', labels: ['Печ', 'Pécs', 'Pecs'] },
    { value: 'Győr', labels: ['Дьёр', 'Győr', 'Gyor'] },
  ],
  DE: [
    { value: 'Berlin', labels: ['Берлин', 'Berlin'] },
    { value: 'Hamburg', labels: ['Гамбург', 'Hamburg'] },
    { value: 'Munich', labels: ['Мюнхен', 'Munich', 'München', 'Muenchen'] },
    { value: 'Cologne', labels: ['Кёльн', 'Cologne', 'Köln', 'Koln'] },
    { value: 'Frankfurt', labels: ['Франкфурт', 'Frankfurt', 'Frankfurt am Main'] },
  ],
  PL: [
    { value: 'Warsaw', labels: ['Варшава', 'Warsaw', 'Warszawa'] },
    { value: 'Kraków', labels: ['Краков', 'Kraków', 'Krakow'] },
  ],
  FR: [
    { value: 'Paris', labels: ['Париж', 'Paris'] },
    { value: 'Lyon', labels: ['Лион', 'Lyon'] },
  ],
  CZ: [
    { value: 'Prague', labels: ['Прага', 'Prague', 'Praha'] },
  ],
  SK: [
    { value: 'Bratislava', labels: ['Братислава', 'Bratislava'] },
  ],
  AT: [
    { value: 'Vienna', labels: ['Вена', 'Vienna', 'Wien'] },
  ],
  RO: [
    { value: 'Bucharest', labels: ['Бухарест', 'Bucharest', 'București'] },
  ],
  UA: [
    { value: 'Kyiv', labels: ['Киев', 'Kyiv', 'Kiev'] },
    { value: 'Lviv', labels: ['Львов', 'Lviv', 'Lvov'] },
  ],
  LT: [{ value: 'Vilnius', labels: ['Вильнюс', 'Vilnius'] }],
  LV: [{ value: 'Riga', labels: ['Рига', 'Riga'] }],
  EE: [{ value: 'Tallinn', labels: ['Таллин', 'Tallinn'] }],
  IT: [
    { value: 'Milan', labels: ['Милан', 'Milan', 'Milano'] },
    { value: 'Rome', labels: ['Рим', 'Rome', 'Roma'] },
  ],
  ES: [
    { value: 'Madrid', labels: ['Мадрид', 'Madrid'] },
    { value: 'Barcelona', labels: ['Барселона', 'Barcelona'] },
  ],
  NL: [{ value: 'Amsterdam', labels: ['Амстердам', 'Amsterdam'] }],
  GB: [{ value: 'London', labels: ['Лондон', 'London'] }],
  MD: [{ value: 'Chișinău', labels: ['Кишинёв', 'Chișinău', 'Chisinau'] }],
};

function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function canonicalCityValue(country, raw) {
  const q = foldText(raw);
  if (!q) return '';
  const entries = CITY_ENTRIES[country] || [];
  for (const entry of entries) {
    const names = [entry.value, ...entry.labels].map(foldText);
    if (names.some((name) => name === q)) return entry.value;
  }
  for (const entry of entries) {
    const names = [entry.value, ...entry.labels].map(foldText);
    if (names.some((name) => q.includes(name) || name.includes(q))) return entry.value;
  }
  return '';
}

const CITY_COORDS = {
  Berlin: { lat: 52.52, lng: 13.405, country: 'DE' },
  Budapest: { lat: 47.4979, lng: 19.0402, country: 'HU' },
  Munich: { lat: 48.1351, lng: 11.582, country: 'DE' },
  Hamburg: { lat: 53.5511, lng: 9.9937, country: 'DE' },
  Warsaw: { lat: 52.2297, lng: 21.0122, country: 'PL' },
  Prague: { lat: 50.0755, lng: 14.4378, country: 'CZ' },
  Paris: { lat: 48.8566, lng: 2.3522, country: 'FR' },
  Vienna: { lat: 48.2082, lng: 16.3738, country: 'AT' },
  Debrecen: { lat: 47.5316, lng: 21.6273, country: 'HU' },
};

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function cityCenter(country, city) {
  const canonical = canonicalCityValue(country, city) || city;
  return CITY_COORDS[canonical] || null;
}

function tokenize(value) {
  return foldText(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function streetMatchScore(query, street) {
  const qTokens = tokenize(query);
  const sTokens = tokenize(street);
  if (!qTokens.length || !sTokens.length) return 0;
  let score = 0;
  for (const qt of qTokens) {
    if (sTokens.some((st) => st === qt || st.startsWith(qt) || qt.startsWith(st))) {
      score += 2;
    }
  }
  if (foldText(street).includes(foldText(query))) score += 3;
  return score;
}

function buildSearchQuery(q, country, city) {
  const canonicalCity = canonicalCityValue(country, city) || city.trim();
  const foldedQ = foldText(q);
  const foldedCity = foldText(canonicalCity);
  if (canonicalCity && foldedCity && !foldedQ.includes(foldedCity)) {
    return `${q.trim()}, ${canonicalCity}`;
  }
  return q.trim();
}

function mapPhotonFeature(feature, country) {
  const props = feature?.properties || {};
  const coords = feature?.geometry?.coordinates || [];
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  const road = String(props.street || props.name || '').trim();
  const house = String(props.housenumber || '').trim();
  const street = [road, house].filter(Boolean).join(' ').trim();
  const rawCity = String(props.city || props.locality || props.town || props.district || '').trim();
  const cc = String(props.countrycode || '').toUpperCase();
  const resolvedCountry = cc || country;
  const city = canonicalCityValue(resolvedCountry, rawCity) || rawCity;
  const postal = String(props.postcode || '').trim();
  const labelParts = [street || props.name, city, postal, props.country].filter(Boolean);
  return {
    id: `photon:${props.osm_type || 'node'}:${props.osm_id || `${lat},${lng}`}`,
    label: labelParts.join(', '),
    street: street || road,
    city,
    postal,
    country: resolvedCountry,
    lat,
    lng,
    _score: 0,
    _hasHouse: Boolean(house),
    _source: 'photon',
  };
}

function mapNominatimRow(row, country) {
  const addr = row?.address || {};
  const rawCity = String(
    addr.city
    || addr.town
    || addr.village
    || addr.municipality
    || addr.city_district
    || addr.suburb
    || addr.county
    || '',
  ).trim();
  const road = String(addr.road || addr.pedestrian || addr.residential || addr.footway || '').trim();
  const house = String(addr.house_number || '').trim();
  const street = [road, house].filter(Boolean).join(' ').trim();
  const cc = String(addr.country_code || country || '').toUpperCase();
  const city = canonicalCityValue(cc, rawCity) || rawCity;
  const postal = String(addr.postcode || '').trim();
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  return {
    id: `nominatim:${row.place_id || `${lat},${lng}`}`,
    label: String(row.display_name || '').trim(),
    street: street || String(row.display_name || '').split(',')[0]?.trim() || '',
    city,
    postal,
    country: cc,
    lat,
    lng,
    _score: 0,
    _hasHouse: Boolean(house),
    _source: 'nominatim',
  };
}

function rankSuggestions(items, q, country, city) {
  const canonicalCity = canonicalCityValue(country, city) || city.trim();
  const foldedCity = foldText(canonicalCity);
  const center = cityCenter(country, canonicalCity);
  return items.map((item) => {
    let score = item._hasHouse ? 4 : 0;
    score += streetMatchScore(q, item.street);
    if (country && item.country === country) score += 3;
    if (foldedCity) {
      const itemCity = foldText(item.city);
      if (itemCity === foldedCity) score += 5;
      else if (itemCity.includes(foldedCity) || foldedCity.includes(itemCity)) score += 2;
      else score -= 4;
    }
    if (center && Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
      const dist = haversineKm(center.lat, center.lng, item.lat, item.lng);
      if (dist <= 25) score += 6;
      else if (dist <= 45) score += 2;
      else score -= 5;
    }
    if (item._source === 'photon') score += 1;
    return { ...item, _score: score };
  }).sort((a, b) => b._score - a._score);
}

function dedupeSuggestions(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.street}|${item.city}|${item.postal}|${Math.round(item.lat * 1000)}|${Math.round(item.lng * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function searchPhoton(q, country, city) {
  const searchQ = buildSearchQuery(q, country, city);
  const params = new URLSearchParams({
    q: searchQ,
    limit: '12',
    lang: 'en',
  });
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  return features
    .map((f) => mapPhotonFeature(f, country))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && (s.street || s.label))
    .filter((s) => !country || !s.country || s.country === country);
}

async function searchNominatim(q, country, city) {
  const searchQ = buildSearchQuery(q, country, city);
  const params = new URLSearchParams({
    format: 'json',
    q: searchQ,
    addressdetails: '1',
    limit: '10',
    'accept-language': 'en',
  });
  if (country) params.set('countrycodes', country.toLowerCase());

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MateDelivery/1.0 (shipping calculator; contact@mate.delivery)',
      },
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => mapNominatimRow(row, country))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.label);
}

export async function geocodeAddressSuggestions({ q, country = '', city = '' }) {
  const query = String(q || '').trim();
  const cc = String(country || '').toUpperCase().replace(/[^A-Z]/g, '');
  const cityName = String(city || '').trim();
  if (query.length < 3) return [];

  const [photon, nominatim] = await Promise.allSettled([
    searchPhoton(query, cc, cityName),
    searchNominatim(query, cc, cityName),
  ]);

  const merged = [
    ...(photon.status === 'fulfilled' ? photon.value : []),
    ...(nominatim.status === 'fulfilled' ? nominatim.value : []),
  ];

  const ranked = rankSuggestions(dedupeSuggestions(merged), query, cc, cityName);
  return ranked
    .filter((s) => s._score > 0 || s._hasHouse)
    .slice(0, 8)
    .map(({ _score, _hasHouse, _source, ...suggestion }) => suggestion);
}
