/** Decorative animated Europe coverage map for the About page. */
export function AboutEuropeMap() {
  const hub = { id: 'bp', x: 468, y: 392, label: 'Budapest' };

  const cities = [
    { id: 'li', x: 292, y: 248, label: 'London' },
    { id: 'am', x: 356, y: 268, label: 'Amsterdam' },
    { id: 'pa', x: 318, y: 348, label: 'Paris' },
    { id: 'be', x: 412, y: 278, label: 'Berlin' },
    { id: 'wa', x: 508, y: 268, label: 'Warsaw' },
    { id: 'pr', x: 444, y: 338, label: 'Prague' },
    { id: 'vi', x: 456, y: 368, label: 'Vienna' },
    { id: 'mi', x: 404, y: 428, label: 'Milan' },
    { id: 'ro', x: 428, y: 498, label: 'Rome' },
    { id: 'md', x: 198, y: 468, label: 'Madrid' },
    { id: 'bu', x: 556, y: 422, label: 'Bucharest' },
    { id: 'ky', x: 612, y: 312, label: 'Kyiv' },
    { id: 'st', x: 492, y: 148, label: 'Stockholm' },
  ] as const;

  return (
    <svg className="about-map-svg" viewBox="0 0 860 680" fill="none" aria-hidden>
      <defs>
        <pattern id="about-eu-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.15" fill="#122023" fillOpacity="0.09" />
        </pattern>
        <linearGradient id="about-eu-land" x1="180" y1="80" x2="700" y2="620" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F4FF8A" />
          <stop offset="45%" stopColor="#E1FF01" />
          <stop offset="100%" stopColor="#C6E400" />
        </linearGradient>
        <linearGradient id="about-eu-sea" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F7F9F8" />
          <stop offset="100%" stopColor="#EEF3F1" />
        </linearGradient>
        <radialGradient id="about-eu-glow" cx="0.52" cy="0.46" r="0.58">
          <stop offset="0%" stopColor="#E1FF01" stopOpacity="0.28" />
          <stop offset="55%" stopColor="#E1FF01" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#E1FF01" stopOpacity="0" />
        </radialGradient>
        <filter id="about-eu-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#122023" floodOpacity="0.12" />
        </filter>
      </defs>

      <rect width="860" height="680" rx="28" fill="url(#about-eu-sea)" />
      <rect width="860" height="680" rx="28" fill="url(#about-eu-grid)" />
      <ellipse cx="440" cy="340" rx="310" ry="250" fill="url(#about-eu-glow)" />

      <g className="about-map-land" filter="url(#about-eu-shadow)" fill="url(#about-eu-land)" stroke="#122023" strokeOpacity="0.16" strokeWidth="1.4" strokeLinejoin="round">
        <path d="M168 118c18-16 46-22 68-12 14 6 18 24 8 36-12 14-34 18-52 12-18-6-30-24-24-36z" />
        <path d="M214 268c12-22 36-30 54-18 10 8 10 24 0 34-14 14-36 16-50 4-10-8-12-12-4-20z" />
        <path d="M268 198c10-28 34-46 60-42 18 2 28 18 30 34 2 14-4 26 2 38 6 12 4 28-8 36-16 10-34 4-46-8-8-8-10-20-16-30-8-14-6-22-4-28 2-4 4-6 6-8 2-6 6-16 8-18 2-6-2-10-4-14-2-4-4-8-4-12 0-4 4-8 8-14 4-6 8-10 12-14 4-4 8-8 10-12 2-4 0-8-4-12-4-4-10-4-14 0-6 6-12 14-16 22-6 10-10 20-12 28-2 8-2 14 0 18z" />
        <path d="M292 318c8-6 20-4 26 4 4 6 2 14-6 18-10 4-20 0-24-8-4-6 0-12 4-14z" />
        <path d="M148 428c22-36 62-54 104-48 24 4 42 20 52 40 8 16 4 34-8 46-18 18-46 22-70 18-28-4-50-20-62-42-8-14-10-20-8-28 2-4 4-8 6-12 4-8 8-14 14-18 8-8 14-12 18-16 8-6 16-8 22-10 6-2 10-4 12-8-2 0-4 0-6 2-18 8-38 18-52 34-8 10-14 20-16 28-2 6-2 10 0 14z" />
        <path d="M268 348c28-42 74-66 124-62 28 2 52 16 72 36 14 14 22 34 20 54-2 18 4 34 16 46 10 10 12 26 4 38-10 14-28 18-44 14-12-4-22-2-32 6-14 12-34 16-52 10-20-6-34-22-36-42-2-12-10-20-22-24-18-6-34-20-40-38-6-16-4-28 2-38 4-8 8-12 14-16 6-4 12-8 18-12 8-6 14-10 18-14 6-6 10-10 12-14 4-6 4-12 2-18-2-6-6-10-12-12-8-4-16-2-22 4-8 8-16 18-22 28-8 12-14 24-18 36-4 10-6 18-6 24z" />
        <path d="M404 428c10 4 18 16 20 28 2 16 8 30 20 40 10 8 14 22 8 34-6 10-18 14-28 10-12-4-20-16-24-28-6-16-10-34-4-50 4-10 6-18 8-24 2-6 4-10 8-12 4-2 8-2 12-2 4 0 8 2 12 4z" />
        <path d="M388 448c-8 2-16 8-18 16-2 8 2 16 10 18 8 2 16-2 18-10 2-8-2-16-10-18v-6z" />
        <path d="M392 248c36-34 88-48 136-40 34 6 64 26 84 52 14 18 20 42 16 64-4 22 4 42 18 58 12 14 14 36 4 52-12 18-36 24-56 18-16-4-30 0-44 8-18 10-40 12-60 4-22-8-38-28-42-50-4-16-14-28-28-34-18-8-32-24-36-44-4-18 0-34 8-48 6-12 14-22 24-30 10-8 20-14 30-18 12-6 22-10 30-14 10-6 18-10 24-16 8-8 12-16 12-24-2 0-4 2-6 4-16 12-34 24-52 34-14 8-28 14-40 18-12 4-22 6-30 6-8 0-14 2-18 6-6 4-8 12-4 18 4 6 12 8 20 8 12 0 26-2 40-2z" />
        <path d="M500 448c18-8 38-4 52 8 10 10 14 26 8 40-4 10 0 22 8 30 8 8 8 22-2 28-12 8-26 4-34-6-8-10-14-24-12-38 2-12-2-22-10-30-8-8-12-18-10-28 2-4 4-6 8-6 4 0 8 2 12 2z" />
        <path d="M548 538c6-4 14-2 18 4 4 6 2 14-4 18-8 4-16 0-18-8-2-6 0-12 4-14z" />
        <path d="M420 78c28-34 78-48 122-34 28 10 46 36 46 66 0 22-10 40-26 54-14 12-18 30-12 46 6 14 2 30-10 40-14 10-32 8-44-2-10-8-14-22-10-34 4-12-2-24-12-32-14-12-24-30-26-50-2-18 2-36 10-50 6-12 12-22 18-30 8-10 14-18 18-26 6-10 8-18 6-24-4 0-8 4-12 10-12 14-26 30-38 46-10 14-18 28-22 42-4 12-4 22-2 30 2 8 0 14-4 18-6 6-14 6-20 0-6-6-6-16 0-24 8-10 18-22 28-34 12-14 24-28 34-42 10-14 18-26 24-36 6-10 10-18 12-24z" />
        <path d="M536 188c10-8 24-6 32 4 6 8 4 20-4 26-12 8-26 4-32-6-4-8-2-16 4-24z" />
      </g>

      <g fill="#122023" fillOpacity="0.04" stroke="none">
        <path d="M300 360c20-18 48-26 74-18 18 6 30 20 34 38 2 12-4 24-14 30-16 10-38 8-54-2-14-8-24-22-26-38-2-4-2-8-2-10z" />
        <path d="M430 300c22-14 50-18 74-8 16 6 28 20 30 36 2 14-6 28-18 34-18 10-42 8-58-4-14-10-24-26-22-42 0-6 2-12 4-16z" />
      </g>

      <g className="about-map-routes" stroke="#122023" strokeOpacity="0.22" strokeWidth="1.2" strokeLinecap="round" fill="none">
        {cities.map((city) => (
          <path
            key={`base-${city.id}`}
            d={`M${hub.x} ${hub.y} Q ${(hub.x + city.x) / 2} ${(hub.y + city.y) / 2 - 24}, ${city.x} ${city.y}`}
          />
        ))}
      </g>
      <g className="about-map-routes" stroke="#E1FF01" strokeWidth="2" strokeLinecap="round" fill="none">
        {cities.map((city, i) => (
          <path
            key={`flow-${city.id}`}
            className="about-map-route"
            style={{ animationDelay: `${i * 0.14}s` }}
            d={`M${hub.x} ${hub.y} Q ${(hub.x + city.x) / 2} ${(hub.y + city.y) / 2 - 24}, ${city.x} ${city.y}`}
          />
        ))}
      </g>

      <g className="about-map-packets">
        {[cities[0], cities[2], cities[3], cities[9], cities[11]].map((city, i) => (
          <circle key={`pkt-${city.id}`} r="2.6" fill="#122023">
            <animateMotion
              dur={`${2.8 + i * 0.35}s`}
              repeatCount="indefinite"
              path={`M${hub.x} ${hub.y} Q ${(hub.x + city.x) / 2} ${(hub.y + city.y) / 2 - 24}, ${city.x} ${city.y}`}
            />
          </circle>
        ))}
      </g>

      <g className="about-map-cities">
        {cities.map((city, i) => (
          <g key={city.id} transform={`translate(${city.x} ${city.y})`}>
            <circle className="about-map-pulse about-map-pulse--sm" r="10" style={{ animationDelay: `${i * 0.1}s` }} />
            <circle r="3.3" fill="#E1FF01" stroke="#122023" strokeWidth="1.1" strokeOpacity="0.35" />
          </g>
        ))}
        <g transform={`translate(${hub.x} ${hub.y})`}>
          <circle className="about-map-pulse about-map-pulse--lg" r="26" />
          <circle className="about-map-pulse" r="16" style={{ animationDelay: '0.35s' }} />
          <circle r="7" fill="#122023" stroke="#E1FF01" strokeWidth="2.4" />
          <circle r="2.4" fill="#E1FF01" />
        </g>
      </g>

      <text x={hub.x} y={hub.y + 24} textAnchor="middle" className="about-map-label about-map-label--hub">
        Budapest
      </text>
      <text x="292" y="236" textAnchor="middle" className="about-map-label">London</text>
      <text x="318" y="336" textAnchor="middle" className="about-map-label">Paris</text>
      <text x="412" y="266" textAnchor="middle" className="about-map-label">Berlin</text>
      <text x="198" y="456" textAnchor="middle" className="about-map-label">Madrid</text>
      <text x="612" y="300" textAnchor="middle" className="about-map-label">Kyiv</text>
      <text x="430" y="646" textAnchor="middle" className="about-map-caption">
        13+ countries · live carrier network
      </text>
    </svg>
  );
}
