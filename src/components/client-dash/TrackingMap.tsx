import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { countryLabel } from '../../constants/shipping';
import { resolveMapPoint } from '../../constants/geo';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Vite bundler fix for Leaflet default icons
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const limeIcon = L.divIcon({
  className: 'client-track-map__marker client-track-map__marker--from',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const destIcon = L.divIcon({
  className: 'client-track-map__marker client-track-map__marker--to',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

type Props = {
  fromCountry?: string;
  toCountry?: string;
  fromLine?: string;
  toLine?: string;
  active?: boolean;
};

export function TrackingMap({
  fromCountry = 'HU',
  toCountry = 'FR',
  fromLine,
  toLine,
  active = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const init = async () => {
      try {
        const [from, to] = await Promise.all([
          resolveMapPoint(fromCountry, fromLine),
          resolveMapPoint(toCountry, toLine),
        ]);
        if (cancelled) return;

        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }

        const map = L.map(el, {
          zoomControl: true,
          scrollWheelZoom: true,
          attributionControl: true,
        });
        mapRef.current = map;

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        const fromMarker = L.marker(from, { icon: limeIcon }).addTo(map);
        fromMarker.bindPopup(`<b>Отправление</b><br>${countryLabel(fromCountry)}`);

        const toMarker = L.marker(to, { icon: destIcon }).addTo(map);
        toMarker.bindPopup(`<b>Назначение</b><br>${countryLabel(toCountry)}`);

        L.polyline([from, to], {
          color: active ? '#7a9200' : '#122023',
          weight: 3,
          opacity: active ? 0.75 : 0.5,
          dashArray: active ? '10 8' : undefined,
        }).addTo(map);

        map.fitBounds(L.latLngBounds([from, to]).pad(0.35));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить карту');
          setLoading(false);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [fromCountry, toCountry, fromLine, toLine, active]);

  return (
    <div className={`client-track-map${active ? ' client-track-map--active' : ''}`}>
      <div ref={containerRef} className="client-track-map__leaflet" aria-label="Карта маршрута" />
      {loading && <div className="client-track-map__loading">Загрузка карты…</div>}
      {error && <div className="client-track-map__error">{error}</div>}
      <div className="client-track-map__labels">
        <span className="client-track-map__from">{countryLabel(fromCountry)}</span>
        <span className="client-track-map__arrow">→</span>
        <span className="client-track-map__to">{countryLabel(toCountry)}</span>
        {active && <span className="client-track-map__live">В пути</span>}
      </div>
    </div>
  );
}
