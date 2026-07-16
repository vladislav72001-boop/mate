export type GeoErrorCode = 'unsupported' | 'insecure' | 'denied' | 'timeout' | 'unavailable';

export class GeoError extends Error {
  code: GeoErrorCode;

  constructor(code: GeoErrorCode, message: string) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
  }
}

export type GeoCoords = { lat: number; lng: number };

function readPosition(
  enableHighAccuracy: boolean,
  timeout: number,
  maximumAge: number,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy,
      timeout,
      maximumAge,
    });
  });
}

function mapGeoError(err: unknown): GeoError {
  const code = typeof err === 'object' && err && 'code' in err
    ? Number((err as GeolocationPositionError).code)
    : 0;

  if (code === 1) {
    return new GeoError(
      'denied',
      'Доступ к геолокации запрещён. Разрешите местоположение для этого сайта в настройках браузера и нажмите «Где я» снова.',
    );
  }
  if (code === 3) {
    return new GeoError(
      'timeout',
      'Не удалось определить местоположение вовремя. Проверьте GPS/Wi‑Fi и попробуйте ещё раз.',
    );
  }
  return new GeoError(
    'unavailable',
    'Геолокация временно недоступна. Попробуйте ещё раз или выберите город вручную.',
  );
}

/** Reliable getCurrentPosition: low-accuracy first, then high-accuracy fallback. */
export async function getCurrentPositionReliable(): Promise<GeoCoords> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new GeoError('unsupported', 'Геолокация недоступна в этом браузере');
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new GeoError(
      'insecure',
      'Геолокация работает только по HTTPS. Откройте сайт как https://www.matedelivery.com',
    );
  }

  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      if (status.state === 'denied') {
        throw new GeoError(
          'denied',
          'Доступ к геолокации запрещён. Разрешите местоположение для этого сайта в настройках браузера и нажмите «Где я» снова.',
        );
      }
    }
  } catch (err) {
    if (err instanceof GeoError) throw err;
    /* Permissions API may be unsupported — continue */
  }

  try {
    // Low accuracy first: faster and more reliable over Wi‑Fi / desktop
    const pos = await readPosition(false, 15000, 120_000);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (firstErr) {
    try {
      const pos = await readPosition(true, 20000, 0);
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (secondErr) {
      throw mapGeoError(secondErr ?? firstErr);
    }
  }
}
