import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

export type LockerOption = {
  id: string
  provider: string
  address: string
  city: string
  country: string
  lat: number
  lng: number
}

/** Approximate city centers for geolocation matching */
export const CITY_COORDS: Array<{ city: string; country: string; lat: number; lng: number }> = [
  { city: 'Budapest', country: 'HU', lat: 47.4979, lng: 19.0402 },
  { city: 'Debrecen', country: 'HU', lat: 47.5316, lng: 21.6273 },
  { city: 'Szeged', country: 'HU', lat: 46.253, lng: 20.1414 },
  { city: 'Pécs', country: 'HU', lat: 46.0727, lng: 18.2328 },
  { city: 'Győr', country: 'HU', lat: 47.6875, lng: 17.6504 },
  { city: 'Berlin', country: 'DE', lat: 52.52, lng: 13.405 },
  { city: 'Munich', country: 'DE', lat: 48.1351, lng: 11.582 },
  { city: 'Hamburg', country: 'DE', lat: 53.5511, lng: 9.9937 },
  { city: 'Frankfurt', country: 'DE', lat: 50.1109, lng: 8.6821 },
  { city: 'Cologne', country: 'DE', lat: 50.9375, lng: 6.9603 },
  { city: 'Warsaw', country: 'PL', lat: 52.2297, lng: 21.0122 },
  { city: 'Kraków', country: 'PL', lat: 50.0647, lng: 19.945 },
  { city: 'Paris', country: 'FR', lat: 48.8566, lng: 2.3522 },
  { city: 'Lyon', country: 'FR', lat: 45.764, lng: 4.8357 },
  { city: 'Prague', country: 'CZ', lat: 50.0755, lng: 14.4378 },
  { city: 'Bratislava', country: 'SK', lat: 48.1486, lng: 17.1077 },
  { city: 'Vienna', country: 'AT', lat: 48.2082, lng: 16.3738 },
  { city: 'Bucharest', country: 'RO', lat: 44.4268, lng: 26.1025 },
  { city: 'Kyiv', country: 'UA', lat: 50.4501, lng: 30.5234 },
  { city: 'Lviv', country: 'UA', lat: 49.8397, lng: 24.0297 },
  { city: 'Vilnius', country: 'LT', lat: 54.6872, lng: 25.2797 },
  { city: 'Riga', country: 'LV', lat: 56.9496, lng: 24.1052 },
  { city: 'Tallinn', country: 'EE', lat: 59.437, lng: 24.7536 },
  { city: 'Rome', country: 'IT', lat: 41.9028, lng: 12.4964 },
  { city: 'Milan', country: 'IT', lat: 45.4642, lng: 9.19 },
  { city: 'Madrid', country: 'ES', lat: 40.4168, lng: -3.7038 },
  { city: 'Amsterdam', country: 'NL', lat: 52.3676, lng: 4.9041 },
  { city: 'London', country: 'GB', lat: 51.5074, lng: -0.1278 },
  { city: 'Chișinău', country: 'MD', lat: 47.0105, lng: 28.8638 },
]

export const PICKUP_LOCKERS: LockerOption[] = [
  { id: 'foxpost_1', provider: 'Foxpost', address: 'Budapest, Váci út 1', city: 'Budapest', country: 'HU', lat: 47.4979, lng: 19.0402 },
  { id: 'gls_1', provider: 'GLS Locker', address: 'Budapest, Andrássy út 12', city: 'Budapest', country: 'HU', lat: 47.5025, lng: 19.0584 },
  { id: 'packeta_1', provider: 'Packeta', address: 'Budapest, Kossuth tér 5', city: 'Budapest', country: 'HU', lat: 47.507, lng: 19.0456 },
  { id: 'foxpost_deb', provider: 'Foxpost', address: 'Debrecen, Piac utca 10', city: 'Debrecen', country: 'HU', lat: 47.5316, lng: 21.6273 },
  { id: 'gls_szeged', provider: 'GLS Locker', address: 'Szeged, Kárász utca 5', city: 'Szeged', country: 'HU', lat: 46.253, lng: 20.1414 },
]

export const PICKUP_BRANCHES: LockerOption[] = [
  { id: 'mate_hu_1', provider: 'Budapest Center', address: 'Budapest, Andrássy út 20', city: 'Budapest', country: 'HU', lat: 47.502, lng: 19.058 },
  { id: 'mate_hu_2', provider: 'Budapest South', address: 'Budapest, Fehérvári út 97', city: 'Budapest', country: 'HU', lat: 47.473, lng: 19.049 },
  { id: 'mate_hu_3', provider: 'Budapest East', address: 'Budapest, Hungária körút 40', city: 'Budapest', country: 'HU', lat: 47.518, lng: 19.089 },
  { id: 'mate_hu_deb', provider: 'Debrecen', address: 'Debrecen, Egyetem tér 1', city: 'Debrecen', country: 'HU', lat: 47.553, lng: 21.621 },
  { id: 'mate_hu_szeged', provider: 'Szeged', address: 'Szeged, Dugonics tér 3', city: 'Szeged', country: 'HU', lat: 46.2535, lng: 20.148 },
]

export const DEST_LOCKERS: LockerOption[] = [
  { id: 'locker_1', provider: 'DHL Packstation', address: 'Berlin, Friedrichstraße 43', city: 'Berlin', country: 'DE', lat: 52.52, lng: 13.3889 },
  { id: 'locker_2', provider: 'Hermes Paketshop', address: 'Berlin, Alexanderplatz 1', city: 'Berlin', country: 'DE', lat: 52.5219, lng: 13.4132 },
  { id: 'locker_3', provider: 'GLS ParcelShop', address: 'Berlin, Potsdamer Platz 1', city: 'Berlin', country: 'DE', lat: 52.5096, lng: 13.376 },
  { id: 'locker_muc_1', provider: 'DHL Packstation', address: 'Munich, Marienplatz 1', city: 'Munich', country: 'DE', lat: 48.1374, lng: 11.5755 },
  { id: 'locker_ham_1', provider: 'Hermes Paketshop', address: 'Hamburg, Jungfernstieg 16', city: 'Hamburg', country: 'DE', lat: 53.5534, lng: 9.9925 },
  { id: 'locker_waw_1', provider: 'InPost Paczkomat', address: 'Warsaw, Marszałkowska 10', city: 'Warsaw', country: 'PL', lat: 52.2297, lng: 21.0122 },
  { id: 'locker_prg_1', provider: 'Zásilkovna', address: 'Prague, Wenceslas Square 1', city: 'Prague', country: 'CZ', lat: 50.081, lng: 14.427 },
  { id: 'locker_par_1', provider: 'Mondial Relay', address: 'Paris, Rue de Rivoli 50', city: 'Paris', country: 'FR', lat: 48.8606, lng: 2.3376 },
  { id: 'locker_vie_1', provider: 'DPD Pickup', address: 'Vienna, Mariahilfer Straße 20', city: 'Vienna', country: 'AT', lat: 48.198, lng: 16.35 },
  { id: 'locker_bts_1', provider: 'Packeta', address: 'Bratislava, Obchodná 10', city: 'Bratislava', country: 'SK', lat: 48.1486, lng: 17.1077 },
]

export const DEST_BRANCHES: LockerOption[] = [
  { id: 'mate_de_1', provider: 'Berlin Mitte', address: 'Berlin, Friedrichstraße 95', city: 'Berlin', country: 'DE', lat: 52.5208, lng: 13.3889 },
  { id: 'mate_de_2', provider: 'Berlin Kreuzberg', address: 'Berlin, Oranienstraße 25', city: 'Berlin', country: 'DE', lat: 52.503, lng: 13.412 },
  { id: 'mate_de_muc', provider: 'Munich', address: 'Munich, Sendlinger Straße 10', city: 'Munich', country: 'DE', lat: 48.135, lng: 11.57 },
  { id: 'mate_pl_1', provider: 'Warsaw', address: 'Warsaw, Nowy Świat 15', city: 'Warsaw', country: 'PL', lat: 52.232, lng: 21.02 },
  { id: 'mate_fr_1', provider: 'Paris Centre', address: 'Paris, Rue de Rivoli 100', city: 'Paris', country: 'FR', lat: 48.8606, lng: 2.3376 },
  { id: 'mate_cz_1', provider: 'Prague', address: 'Prague, Národní 10', city: 'Prague', country: 'CZ', lat: 50.0815, lng: 14.418 },
  { id: 'mate_sk_1', provider: 'Bratislava', address: 'Bratislava, Laurinská 5', city: 'Bratislava', country: 'SK', lat: 48.143, lng: 17.11 },
  { id: 'mate_at_1', provider: 'Vienna', address: 'Vienna, Kärntner Straße 12', city: 'Vienna', country: 'AT', lat: 48.207, lng: 16.372 },
]

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function filterPointsByCity(
  points: LockerOption[],
  city: string,
  country?: string,
): LockerOption[] {
  const fold = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const q = fold(city);
  let list = country ? points.filter((p) => p.country === country) : points;
  if (!q) return list;
  return list.filter(
    (p) => fold(p.city) === q || fold(p.address).includes(q),
  );
}

export function nearestCityFromCoords(
  lat: number,
  lng: number,
  country?: string,
): { city: string; country: string; distanceKm: number } | null {
  const pool = country ? CITY_COORDS.filter((c) => c.country === country) : CITY_COORDS
  if (!pool.length) return null
  let best = pool[0]
  let bestDist = haversineKm(lat, lng, best.lat, best.lng)
  for (let i = 1; i < pool.length; i++) {
    const d = haversineKm(lat, lng, pool[i].lat, pool[i].lng)
    if (d < bestDist) {
      best = pool[i]
      bestDist = d
    }
  }
  return { city: best.city, country: best.country, distanceKm: bestDist }
}

export function detectCityByGeolocation(country?: string): Promise<{ city: string; country: string }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Геолокация недоступна в этом браузере'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const match = nearestCityFromCoords(pos.coords.latitude, pos.coords.longitude, country)
        if (!match) {
          reject(new Error('Не удалось определить город'))
          return
        }
        resolve({ city: match.city, country: match.country })
      },
      () => reject(new Error('Не удалось получить геолокацию. Разрешите доступ к местоположению.')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60_000 },
    )
  })
}

const userLocationIcon = L.divIcon({
  className: 'calc-user-loc',
  html: '<span class="calc-user-loc__pulse"></span><span class="calc-user-loc__dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

const addressFocusIcon = L.divIcon({
  className: 'calc-addr-loc',
  html: '<span class="calc-addr-loc__pin"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function isValidCoord(lat: number, lng: number) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) > 0.01
    && Math.abs(lng) > 0.01
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
}

type Props = {
  lockers: LockerOption[]
  selected: string
  onSelect: (id: string) => void
  showMap?: boolean
  showUserLocation?: boolean
  /** Preferred sort/center point (e.g. recipient address) */
  focusPos?: { lat: number; lng: number } | null
}

export function LockerPicker({
  lockers,
  selected,
  onSelect,
  showMap = true,
  showUserLocation = true,
  focusPos = null,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])
  const userMarkerRef = useRef<L.Marker | null>(null)
  const focusMarkerRef = useRef<L.Marker | null>(null)
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null)
  const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'ok' | 'denied'>('idle')

  const mapLockers = useMemo(
    () => lockers.filter((l) => isValidCoord(l.lat, l.lng)),
    [lockers],
  )

  const sortOrigin = useMemo(() => {
    if (focusPos && isValidCoord(focusPos.lat, focusPos.lng)) return focusPos
    return userPos
  }, [focusPos, userPos])

  const sortedLockers = useMemo(() => {
    if (!sortOrigin) return lockers
    return [...lockers].sort(
      (a, b) =>
        haversineKm(sortOrigin.lat, sortOrigin.lng, a.lat, a.lng)
        - haversineKm(sortOrigin.lat, sortOrigin.lng, b.lat, b.lng),
    )
  }, [lockers, sortOrigin])

  const fitAround = useCallback((lat: number, lng: number) => {
    const map = leafletRef.current
    if (!map || !isValidCoord(lat, lng)) return
    const nearby = mapLockers.filter((l) => haversineKm(lat, lng, l.lat, l.lng) <= 120)
    if (nearby.length) {
      const bounds = L.latLngBounds([
        ...nearby.map((l) => [l.lat, l.lng] as [number, number]),
        [lat, lng],
      ])
      map.fitBounds(bounds.pad(0.35))
    } else {
      map.setView([lat, lng], 14)
    }
  }, [mapLockers])

  const placeFocusMarker = useCallback((lat: number, lng: number, fit = true) => {
    const map = leafletRef.current
    if (!map || !isValidCoord(lat, lng)) return

    if (focusMarkerRef.current) {
      focusMarkerRef.current.setLatLng([lat, lng])
    } else {
      const marker = L.marker([lat, lng], {
        icon: addressFocusIcon,
        zIndexOffset: 900,
        interactive: true,
      })
      marker.bindPopup('<b>Адрес получателя</b>')
      marker.addTo(map)
      focusMarkerRef.current = marker
    }
    if (fit) fitAround(lat, lng)
  }, [fitAround])

  const placeUserMarker = useCallback((lat: number, lng: number, fit = true) => {
    const map = leafletRef.current
    if (!map || !isValidCoord(lat, lng)) return

    userPosRef.current = { lat, lng }
    setUserPos({ lat, lng })
    setGeoStatus('ok')

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([lat, lng])
    } else {
      const marker = L.marker([lat, lng], {
        icon: userLocationIcon,
        zIndexOffset: 1000,
        interactive: true,
      })
      marker.bindPopup('<b>Вы здесь</b>')
      marker.addTo(map)
      userMarkerRef.current = marker
    }

    // Prefer address focus for framing when present
    if (!fit) return
    if (focusPos && isValidCoord(focusPos.lat, focusPos.lng)) return
    fitAround(lat, lng)
  }, [fitAround, focusPos])

  const requestUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus('denied')
      return
    }
    setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => placeUserMarker(pos.coords.latitude, pos.coords.longitude, true),
      () => setGeoStatus('denied'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15_000 },
    )
  }, [placeUserMarker])

  useEffect(() => {
    if (!showMap || !mapRef.current || !mapLockers.length) return undefined

    const container = mapRef.current
    let cancelled = false
    let watchId: number | null = null

    const initMap = () => {
      if (cancelled || !container) return

      if (leafletRef.current) {
        leafletRef.current.remove()
        leafletRef.current = null
        markersRef.current = []
        userMarkerRef.current = null
        focusMarkerRef.current = null
      }

      const map = L.map(container, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false,
      })
      leafletRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(map)

      const bounds = L.latLngBounds(mapLockers.map((l) => [l.lat, l.lng] as [number, number]))
      mapLockers.forEach((locker) => {
        const marker = L.marker([locker.lat, locker.lng])
        marker.bindPopup(`<b>${locker.provider}</b><br>${locker.address}`)
        marker.addTo(map)
        marker.on('click', () => onSelectRef.current(locker.id))
        markersRef.current.push(marker)
      })

      const focusOk = focusPos && isValidCoord(focusPos.lat, focusPos.lng)
      if (focusOk) {
        placeFocusMarker(focusPos.lat, focusPos.lng, true)
      } else {
        map.fitBounds(bounds.pad(0.2))
      }
      requestAnimationFrame(() => {
        map.invalidateSize()
        if (focusOk) placeFocusMarker(focusPos.lat, focusPos.lng, true)
        else map.fitBounds(bounds.pad(0.2))
      })

      if (userPosRef.current) {
        placeUserMarker(userPosRef.current.lat, userPosRef.current.lng, !focusOk)
      } else if (showUserLocation && navigator.geolocation) {
        setGeoStatus('loading')
        navigator.geolocation.getCurrentPosition(
          (pos) => placeUserMarker(pos.coords.latitude, pos.coords.longitude, !focusOk),
          () => setGeoStatus('denied'),
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 30_000 },
        )
        watchId = navigator.geolocation.watchPosition(
          (pos) => placeUserMarker(pos.coords.latitude, pos.coords.longitude, false),
          () => {},
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 30_000 },
        )
      }
    }

    const timer = window.setTimeout(initMap, 80)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (watchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId)
      }
      userMarkerRef.current = null
      focusMarkerRef.current = null
      if (leafletRef.current) {
        leafletRef.current.remove()
        leafletRef.current = null
      }
      markersRef.current = []
    }
  }, [mapLockers, showMap, showUserLocation, placeUserMarker, placeFocusMarker, focusPos])

  useEffect(() => {
    if (!focusPos || !isValidCoord(focusPos.lat, focusPos.lng)) return
    if (!leafletRef.current) return
    placeFocusMarker(focusPos.lat, focusPos.lng, true)
  }, [focusPos, placeFocusMarker])

  useEffect(() => {
    const map = leafletRef.current
    if (!map) return
    const idx = mapLockers.findIndex((l) => l.id === selected)
    if (idx >= 0 && markersRef.current[idx]) {
      markersRef.current[idx].openPopup()
      const locker = mapLockers[idx]
      map.panTo([locker.lat, locker.lng], { animate: true })
    }
  }, [selected, mapLockers])

  if (!lockers.length) {
    return (
      <div className="calc-locker">
        <p className="calc-form__hint">В этом городе пока нет точек. Выберите другой город или укажите адрес.</p>
      </div>
    )
  }

  return (
    <div className="calc-locker">
      {showMap && mapLockers.length > 0 && (
        <div className="calc-locker__map-wrap">
          <div className="calc-locker__map" ref={mapRef} />
          <button
            type="button"
            className="calc-locker__locate"
            onClick={requestUserLocation}
            disabled={geoStatus === 'loading'}
            title="Показать моё местоположение"
          >
            {geoStatus === 'loading' ? '…' : '◎'}
            <span>{geoStatus === 'ok' ? 'Вы на карте' : 'Где я'}</span>
          </button>
          {geoStatus === 'denied' && (
            <p className="calc-locker__geo-hint">Разрешите геолокацию в браузере, чтобы увидеть себя на карте</p>
          )}
          {geoStatus === 'ok' && (
            <p className="calc-locker__geo-hint calc-locker__geo-hint--ok">Синяя точка — ваше местоположение</p>
          )}
        </div>
      )}
      <div className="calc-locker__list-wrap">
        <div className="calc-locker__list-head">
          <span>Точки рядом</span>
          <small>{sortedLockers.length}</small>
        </div>
        <div className="calc-locker__list" role="listbox" aria-label="Список постаматов">
          {sortedLockers.map((locker, i) => {
            const dist = sortOrigin && isValidCoord(locker.lat, locker.lng)
              ? haversineKm(sortOrigin.lat, sortOrigin.lng, locker.lat, locker.lng)
              : null
            return (
              <button
                key={locker.id}
                type="button"
                role="option"
                aria-selected={locker.id === selected}
                className={`calc-locker__item${locker.id === selected ? ' active' : ''}`}
                onClick={() => onSelect(locker.id)}
              >
                <span className="calc-locker__num">{i + 1}</span>
                <span className="calc-locker__meta">
                  <b>{locker.provider}</b>
                  <em>{locker.address}</em>
                  {dist != null && (
                    <em className="calc-locker__dist">
                      {dist < 1 ? `${Math.round(dist * 1000)} м` : `${dist.toFixed(1)} км`}
                    </em>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
