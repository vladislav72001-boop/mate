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

/** Extra phrasings so "Taksony 7" also finds "Taksony utca 7". */
function queryVariants(q, country, city) {
  const base = String(q || '').trim();
  if (!base) return [];
  const variants = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s && !variants.some((x) => foldText(x) === foldText(s))) variants.push(s);
  };

  add(base);
  add(buildSearchQuery(base, country, city));

  const houseMatch = base.match(/^(.+?)\s+(\d+[a-zA-Z]?)$/u);
  if (houseMatch) {
    const street = houseMatch[1].trim();
    const house = houseMatch[2].trim();
    const foldedStreet = foldText(street);
    const hasType = /(utca|ut|út|strasse|str\.|street|road|allee|weg|ulica|ul\.|rue|via)/i.test(street);
    if (!hasType) {
      if (country === 'HU') {
        add(`${street} utca ${house}`);
        add(buildSearchQuery(`${street} utca ${house}`, country, city));
        if (!foldedStreet.endsWith('ut')) add(`${street} út ${house}`);
      } else if (country === 'DE' || country === 'AT') {
        add(`${street} Straße ${house}`);
        add(buildSearchQuery(`${street} Str. ${house}`, country, city));
      } else if (country === 'PL') {
        add(`ul. ${street} ${house}`);
        add(buildSearchQuery(`ul. ${street} ${house}`, country, city));
      } else {
        add(`${street} ${house}`);
      }
    }
  }

  // Broader city-less pass helps suburbs / alternate spellings
  if (city && variants.length < 5) add(base);

  return variants.slice(0, 4);
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
      // Keep metro / suburb matches (e.g. near Budapest) instead of dropping them
      if (dist <= 25) score += 6;
      else if (dist <= 50) score += 3;
      else if (dist <= 80) score += 1;
      else score -= 2;
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

async function searchPhotonRaw(searchQ, country) {
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

async function searchNominatimRaw(searchQ, country) {
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

  const variants = queryVariants(query, cc, cityName);
  const jobs = [
    ...variants.map((variant) => searchPhotonRaw(variant, cc)),
    searchNominatimRaw(variants[0], cc),
  ];
  if (variants[1]) jobs.push(searchNominatimRaw(variants[1], cc));

  const settled = await Promise.allSettled(jobs);
  const merged = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const ranked = rankSuggestions(dedupeSuggestions(merged), query, cc, cityName);
  const strong = ranked.filter((s) => s._score > 0 || s._hasHouse || streetMatchScore(query, s.street) > 0);
  const picked = (strong.length ? strong : ranked).slice(0, 10);
  return picked.map(({ _score, _hasHouse, _source, ...suggestion }) => suggestion);
}
