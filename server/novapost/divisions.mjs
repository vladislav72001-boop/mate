import {
  getNovaPostJwt,
  novaPostFetchJson,
  isNovaPostMock,
  markNovaPostUnavailable,
  novaPostAuthHeader,
} from './client.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

/** @typedef {'Postomat' | 'PUDO' | 'PostBranch'} DivisionCategory */

function cacheKey(parts) {
  return parts.map((p) => String(p || '').trim().toLowerCase()).join('|');
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function cityMatches(item, city) {
  const q = String(city || '').trim().toLowerCase();
  if (!q) return true;
  const settlement = String(item?.settlement?.name || '').toLowerCase();
  const name = String(item?.name || '').toLowerCase();
  const address = String(item?.address || '').toLowerCase();
  return (
    settlement === q
    || settlement.includes(q)
    || q.includes(settlement)
    || name.includes(q)
    || address.includes(q)
  );
}

/**
 * @param {{ countryCode: string, city?: string, categories?: DivisionCategory[], limit?: number }} opts
 */
export async function fetchNovaPostDivisions({
  countryCode,
  city = '',
  categories,
  limit = 50,
}) {
  if (isNovaPostMock()) return { items: [], total: 0, source: 'mock' };

  const country = String(countryCode || '').toUpperCase();
  if (!country) return { items: [], total: 0, source: 'none' };

  const key = cacheKey(['div', country, city, (categories || []).join(','), limit]);
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const jwt = await getNovaPostJwt();
    const qs = new URLSearchParams();
    qs.append('countryCodes[]', country);
    if (city.trim()) qs.append('textSearch', city.trim());
    qs.append('limit', String(Math.min(Math.max(limit, 1), 100)));
    if (categories?.length) {
      for (const cat of categories) qs.append('divisionCategories[]', cat);
    }

    const response = await novaPostFetchJson(`/divisions?${qs}`, {
      method: 'GET',
      headers: novaPostAuthHeader(jwt),
    });

    let items = Array.isArray(response.items) ? response.items : [];
    if (city.trim()) {
      items = items.filter((it) => cityMatches(it, city));
    }

    const total = items.length > 0
      ? (Number(response.totalItems ?? response.total ?? items.length) || items.length)
      : 0;
    return setCached(key, { items, total, source: 'novapost' });
  } catch (err) {
    console.error('[novapost] divisions:', err?.message || err);
    if (String(err?.message || '').includes('403') || String(err?.message || '').includes('circuit')) {
      markNovaPostUnavailable();
    }
    return { items: [], total: 0, source: 'error' };
  }
}

/**
 * Fast existence check (limit=1) per category group.
 * @param {string} countryCode
 * @param {string} city
 */
export async function countNovaPostCoverage(countryCode, city) {
  if (isNovaPostMock()) {
    return { postomat: 0, pudo: 0, postBranch: 0, source: 'mock' };
  }

  const key = cacheKey(['cov', countryCode, city]);
  const cached = getCached(key);
  if (cached) return cached;

  async function countCategory(categories) {
    const result = await fetchNovaPostDivisions({
      countryCode,
      city,
      categories,
      limit: 20,
    });
    if (result.source === 'error') return { count: 0, error: true };
    const matched = result.items;
    if (matched.length > 0) {
      return { count: Math.max(result.total, matched.length), error: false };
    }
    return { count: 0, error: false };
  }

  const [postomat, pudo, postBranch] = await Promise.all([
    countCategory(['Postomat']),
    countCategory(['PUDO']),
    countCategory(['PostBranch']),
  ]);

  const result = {
    postomat: postomat.count,
    pudo: pudo.count,
    postBranch: postBranch.count,
    source: (postomat.error || pudo.error || postBranch.error) ? 'error' : 'novapost',
  };

  return setCached(key, result);
}

export function mapDivisionToPoint(item) {
  const city = item?.settlement?.name || '';
  const provider = [item?.source, item?.shortName || item?.number]
    .filter(Boolean)
    .join(' · ') || item?.name || 'Nova Post';
  return {
    id: String(item.id),
    provider,
    address: item.displayAddress || item.address || item.name || '',
    city,
    country: String(item.countryCode || '').toUpperCase(),
    lat: Number(item.latitude) || 0,
    lng: Number(item.longitude) || 0,
    category: item.divisionCategory || null,
    source: item.source || null,
    externalId: item.externalId || item.number || null,
  };
}
