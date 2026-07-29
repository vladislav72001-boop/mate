/** Decorative animated Europe coverage map for the About page. */
export function AboutEuropeMap() {
  const hubs = [
    { id: 'bp', x: 348, y: 268, r: 5.5, hub: true, label: 'Budapest' },
    { id: 'be', x: 292, y: 198, r: 3.6, label: 'Berlin' },
    { id: 'wa', x: 352, y: 198, r: 3.4, label: 'Warsaw' },
    { id: 'pr', x: 318, y: 228, r: 3.2, label: 'Prague' },
    { id: 'vi', x: 332, y: 252, r: 3.2, label: 'Vienna' },
    { id: 'am', x: 248, y: 188, r: 3.2, label: 'Amsterdam' },
    { id: 'pa', x: 228, y: 248, r: 3.4, label: 'Paris' },
    { id: 'mi', x: 298, y: 298, r: 3.2, label: 'Milan' },
    { id: 'ro', x: 318, y: 348, r: 3.2, label: 'Rome' },
    { id: 'md', x: 168, y: 348, r: 3.2, label: 'Madrid' },
    { id: 'bu', x: 398, y: 298, r: 3.4, label: 'Bucharest' },
    { id: 'ky', x: 438, y: 228, r: 3.4, label: 'Kyiv' },
    { id: 'vi2', x: 398, y: 168, r: 3.2, label: 'Vilnius' },
  ] as const;

  const routes = hubs.filter((h) => !h.hub);

  return (
    <svg className="about-map-svg" viewBox="0 0 640 460" fill="none" aria-hidden>
      <defs>
        <pattern id="about-eu-grid" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.2" fill="#122023" fillOpacity="0.1" />
        </pattern>
        <linearGradient id="about-eu-land" x1="120" y1="80" x2="520" y2="400" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E1FF01" stopOpacity="0.2" />
          <stop offset="55%" stopColor="#D4F000" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#B8D400" stopOpacity="0.22" />
        </linearGradient>
        <radialGradient id="about-eu-glow" cx="0.52" cy="0.48" r="0.55">
          <stop offset="0%" stopColor="#E1FF01" stopOpacity="0.35" />
          <stop offset="70%" stopColor="#E1FF01" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#E1FF01" stopOpacity="0" />
        </radialGradient>
        <filter id="about-eu-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="640" height="460" rx="24" fill="url(#about-eu-grid)" />
      <ellipse cx="340" cy="240" rx="230" ry="180" fill="url(#about-eu-glow)" />

      {/* Simplified but recognizable Europe landmass */}
      <g filter="url(#about-eu-soft)">
        <path
          className="about-map-land"
          fill="url(#about-eu-land)"
          stroke="#122023"
          strokeOpacity="0.18"
          strokeWidth="1.4"
          strokeLinejoin="round"
          d="M168 148c18-28 46-46 78-52 22-4 40 8 58 4 16-4 28-22 48-24 26-2 48 18 74 16 20-2 34-18 54-14 24 4 38 28 36 52-2 18 8 30 22 40 18 14 34 34 30 58-4 22-28 30-40 48-10 16-4 36 8 50 14 16 16 40 2 56-12 14-34 16-48 28-16 14-18 38-36 48-22 12-50 4-72 14-24 10-30 36-56 40-28 4-50-18-76-20-24-2-48 14-70 4-20-8-24-34-20-54 4-18-8-32-18-46-14-20-34-34-36-58-2-26 18-42 28-64 10-20 4-44 16-64z"
        />
        <path
          className="about-map-land about-map-land--isles"
          fill="#E1FF01"
          fillOpacity="0.28"
          stroke="#122023"
          strokeOpacity="0.14"
          strokeWidth="1"
          d="M198 128c10-14 28-18 40-10 8 6 6 20-4 26-12 8-28 2-36-8zM214 96c8-10 22-10 28-2 4 6-2 14-12 16-10 2-20-4-16-14z"
        />
        <path
          className="about-map-land about-map-land--scandi"
          fill="#E1FF01"
          fillOpacity="0.22"
          stroke="#122023"
          strokeOpacity="0.12"
          strokeWidth="1"
          d="M320 52c18-20 46-28 68-18 16 8 18 28 10 44-8 14-26 18-40 28-12 8-14 24-28 28-18 4-34-12-36-30-2-16 10-34 26-52z"
        />
        <path
          className="about-map-land about-map-land--iberia"
          fill="#E1FF01"
          fillOpacity="0.26"
          stroke="#122023"
          strokeOpacity="0.14"
          strokeWidth="1"
          d="M148 300c18-10 38-6 52 8 10 10 8 28-2 38-14 14-36 12-52 4-14-8-16-28-4-40 2-4 4-8 6-10z"
        />
        <path
          className="about-map-land about-map-land--italy"
          fill="#E1FF01"
          fillOpacity="0.26"
          stroke="#122023"
          strokeOpacity="0.14"
          strokeWidth="1"
          d="M308 300c8 4 14 16 12 28-2 14 4 28 14 36 6 4 4 14-4 14-12 0-22-14-28-26-8-14-12-32-4-44 4-6 6-10 10-8z"
        />
      </g>

      {/* Animated routes from Budapest */}
      <g className="about-map-routes" stroke="#E1FF01" strokeWidth="1.5" strokeLinecap="round" fill="none">
        {routes.map((city, i) => (
          <path
            key={`route-${city.id}`}
            className="about-map-route"
            style={{ animationDelay: `${i * 0.18}s` }}
            d={`M348 268 C ${(348 + city.x) / 2} ${268 - 28 + (i % 3) * 10}, ${(348 + city.x) / 2} ${(268 + city.y) / 2}, ${city.x} ${city.y}`}
          />
        ))}
      </g>

      {/* City markers */}
      <g className="about-map-cities">
        {hubs.map((city, i) => (
          <g key={city.id} transform={`translate(${city.x} ${city.y})`}>
            {city.hub && (
              <>
                <circle className="about-map-pulse about-map-pulse--lg" r="22" />
                <circle className="about-map-pulse" r="14" style={{ animationDelay: '0.4s' }} />
              </>
            )}
            {!city.hub && (
              <circle
                className="about-map-pulse about-map-pulse--sm"
                r="9"
                style={{ animationDelay: `${0.2 + i * 0.12}s` }}
              />
            )}
            <circle
              r={city.r}
              fill={city.hub ? '#122023' : '#E1FF01'}
              stroke={city.hub ? '#E1FF01' : '#122023'}
              strokeWidth={city.hub ? 2.2 : 1}
              strokeOpacity={city.hub ? 1 : 0.25}
            />
            {city.hub && <circle r="2.2" fill="#E1FF01" />}
          </g>
        ))}
      </g>

      <text x="348" y="292" textAnchor="middle" className="about-map-label about-map-label--hub">
        Budapest
      </text>
      <text x="320" y="428" textAnchor="middle" className="about-map-caption">
        13+ countries · live carrier network
      </text>
    </svg>
  );
}
