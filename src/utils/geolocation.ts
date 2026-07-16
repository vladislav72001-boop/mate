export type GeoErrorCode = 'unsupported' | 'insecure' | 'denied' | 'timeout' | 'unavailable';

export class GeoError extends Error {
  code: GeoErrorCode;

  constructor(code: GeoErrorCode, message: string) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
  }
}

export type GeoCoords = {
  lat: number;
  lng: number;
  /** gps = browser geolocation; ip = network estimate */
  source: 'gps' | 'ip';
  accuracyM?: number;
  city?: string;
  countryCode?: string;
};

function readPosition(
  enableHighAccuracy: boolean,
  timeout: number,
  maximumAge: number,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('unsupported'), { code: 0 }));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy,
      timeout,
      maximumAge,
    });
  });
}

function isValidCoords(lat: number, lng: number) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
    && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function pickCoords(data: Record<string, unknown> | null): GeoCoords | null {
  if (!data) return null;
  const lat = Number(data.latitude ?? data.lat);
  const lng = Number(data.longitude ?? data.lng ?? data.lon);
  if (!isValidCoords(lat, lng)) return null;
  const cityRaw = data.city ?? data.region ?? data.region_name;
  const city = typeof cityRaw === 'string' && cityRaw.trim() ? cityRaw.trim() : undefined;
  const ccRaw = data.country_code ?? data.country_code3 ?? data.country;
  const countryCode = typeof ccRaw === 'string' && /^[a-z]{2}$/i.test(ccRaw.trim())
    ? ccRaw.trim().toUpperCase()
    : undefined;
  return {
    lat,
    lng,
    source: 'ip',
    accuracyM: 25_000,
    city,
    countryCode,
  };
}

/** Approximate location from public IP (works when GPS times out on desktop). */
export async function getPositionFromIp(): Promise<GeoCoords> {
  const providers: Array<() => Promise<GeoCoords | null>> = [
    async () => pickCoords(await fetchJson('https://get.geojs.io/v1/ip/geo.json')),
    async () => pickCoords(await fetchJson('https://ipapi.co/json/')),
    async () => {
      const data = await fetchJson('/api/geo/approx');
      return pickCoords(data);
    },
  ];

  for (const provider of providers) {
    try {
      const hit = await provider();
      if (hit) return hit;
    } catch {
      /* try next */
    }
  }

  throw new GeoError(
    'unavailable',
    'Не удалось определить местоположение. Выберите город вручную или проверьте интернет.',
  );
}

async function getPositionFromGps(): Promise<GeoCoords> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new GeoError('unsupported', 'Геолокация недоступна в этом браузере');
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new GeoError(
      'insecure',
      'Геолокация работает только по HTTPS. Откройте сайт как https://www.matedelivery.com',
    );
  }

  // Keep GPS attempts short — desktop often never resolves; IP fallback is next
  const attempts: Array<[boolean, number, number]> = [
    [false, 3500, 600_000], // cached
    [false, 5000, 0],       // fresh low-accuracy
  ];

  let lastErr: unknown;
  for (const [high, timeout, maxAge] of attempts) {
    try {
      const pos = await readPosition(high, timeout, maxAge);
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (!isValidCoords(lat, lng)) continue;
      return {
        lat,
        lng,
        source: 'gps',
        accuracyM: pos.coords.accuracy,
      };
    } catch (err) {
      lastErr = err;
      const code = typeof err === 'object' && err && 'code' in err
        ? Number((err as GeolocationPositionError).code)
        : 0;
      if (code === 1) {
        throw new GeoError(
          'denied',
          'Доступ к геолокации запрещён. Разрешите местоположение для сайта или мы определим город по сети.',
        );
      }
    }
  }

  const code = typeof lastErr === 'object' && lastErr && 'code' in lastErr
    ? Number((lastErr as GeolocationPositionError).code)
    : 0;
  if (code === 3) {
    throw new GeoError('timeout', 'GPS не ответил вовремя');
  }
  throw new GeoError('unavailable', 'GPS недоступен');
}

/**
 * Best-effort location: browser GPS first, then IP geolocation.
 * Desktop browsers often time out on GPS even when "allowed" — IP covers that.
 */
export async function getCurrentPositionReliable(
  options: { allowIpFallback?: boolean } = {},
): Promise<GeoCoords> {
  const allowIp = options.allowIpFallback !== false;

  try {
    return await getPositionFromGps();
  } catch (gpsErr) {
    if (!allowIp) throw gpsErr;
    // Denied / timeout / unavailable → still try network estimate
    try {
      return await getPositionFromIp();
    } catch {
      if (gpsErr instanceof GeoError && gpsErr.code === 'denied') {
        throw new GeoError(
          'denied',
          'Доступ к геолокации запрещён, и определить город по сети не удалось. Выберите город вручную.',
        );
      }
      throw new GeoError(
        'timeout',
        'Не удалось определить местоположение. Выберите город вручную или включите службы геолокации Windows/браузера.',
      );
    }
  }
}
