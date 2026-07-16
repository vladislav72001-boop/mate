/** Mate-owned branches used for «Наш филиал» availability. */

export const MATE_BRANCHES = [
  { id: 'mate_hu_1', provider: 'Budapest Center', address: 'Budapest, Andrássy út 20', city: 'Budapest', country: 'HU', lat: 47.502, lng: 19.058 },
  { id: 'mate_hu_2', provider: 'Budapest South', address: 'Budapest, Fehérvári út 97', city: 'Budapest', country: 'HU', lat: 47.473, lng: 19.049 },
  { id: 'mate_hu_3', provider: 'Budapest East', address: 'Budapest, Hungária körút 40', city: 'Budapest', country: 'HU', lat: 47.518, lng: 19.089 },
  { id: 'mate_hu_deb', provider: 'Debrecen', address: 'Debrecen, Egyetem tér 1', city: 'Debrecen', country: 'HU', lat: 47.553, lng: 21.621 },
  { id: 'mate_hu_szeged', provider: 'Szeged', address: 'Szeged, Dugonics tér 3', city: 'Szeged', country: 'HU', lat: 46.2535, lng: 20.148 },
  { id: 'mate_de_1', provider: 'Berlin Mitte', address: 'Berlin, Friedrichstraße 95', city: 'Berlin', country: 'DE', lat: 52.5208, lng: 13.3889 },
  { id: 'mate_de_2', provider: 'Berlin Kreuzberg', address: 'Berlin, Oranienstraße 25', city: 'Berlin', country: 'DE', lat: 52.503, lng: 13.412 },
  { id: 'mate_de_muc', provider: 'Munich', address: 'Munich, Sendlinger Straße 10', city: 'Munich', country: 'DE', lat: 48.135, lng: 11.57 },
  { id: 'mate_pl_1', provider: 'Warsaw', address: 'Warsaw, Nowy Świat 15', city: 'Warsaw', country: 'PL', lat: 52.232, lng: 21.02 },
  { id: 'mate_fr_1', provider: 'Paris Centre', address: 'Paris, Rue de Rivoli 100', city: 'Paris', country: 'FR', lat: 48.8606, lng: 2.3376 },
  { id: 'mate_cz_1', provider: 'Prague', address: 'Prague, Národní 10', city: 'Prague', country: 'CZ', lat: 50.0815, lng: 14.418 },
  { id: 'mate_sk_1', provider: 'Bratislava', address: 'Bratislava, Laurinská 5', city: 'Bratislava', country: 'SK', lat: 48.143, lng: 17.11 },
  { id: 'mate_at_1', provider: 'Vienna', address: 'Vienna, Kärntner Straße 12', city: 'Vienna', country: 'AT', lat: 48.207, lng: 16.372 },
];

/** Fallback lockers when Nova Post is unavailable (mock / offline). */
export const FALLBACK_LOCKERS = [
  { id: 'foxpost_1', provider: 'Foxpost', address: 'Budapest, Váci út 1', city: 'Budapest', country: 'HU', lat: 47.4979, lng: 19.0402 },
  { id: 'gls_1', provider: 'GLS Locker', address: 'Budapest, Andrássy út 12', city: 'Budapest', country: 'HU', lat: 47.5025, lng: 19.0584 },
  { id: 'packeta_1', provider: 'Packeta', address: 'Budapest, Kossuth tér 5', city: 'Budapest', country: 'HU', lat: 47.507, lng: 19.0456 },
  { id: 'foxpost_deb', provider: 'Foxpost', address: 'Debrecen, Piac utca 10', city: 'Debrecen', country: 'HU', lat: 47.5316, lng: 21.6273 },
  { id: 'gls_szeged', provider: 'GLS Locker', address: 'Szeged, Kárász utca 5', city: 'Szeged', country: 'HU', lat: 46.253, lng: 20.1414 },
  { id: 'locker_1', provider: 'DHL Packstation', address: 'Berlin, Friedrichstraße 43', city: 'Berlin', country: 'DE', lat: 52.52, lng: 13.3889 },
  { id: 'locker_2', provider: 'Hermes Paketshop', address: 'Berlin, Alexanderplatz 1', city: 'Berlin', country: 'DE', lat: 52.5219, lng: 13.4132 },
  { id: 'locker_muc_1', provider: 'DHL Packstation', address: 'Munich, Marienplatz 1', city: 'Munich', country: 'DE', lat: 48.1374, lng: 11.5755 },
  { id: 'locker_ham_1', provider: 'Hermes Paketshop', address: 'Hamburg, Jungfernstieg 16', city: 'Hamburg', country: 'DE', lat: 53.5534, lng: 9.9925 },
  { id: 'locker_waw_1', provider: 'InPost Paczkomat', address: 'Warsaw, Marszałkowska 10', city: 'Warsaw', country: 'PL', lat: 52.2297, lng: 21.0122 },
  { id: 'locker_prg_1', provider: 'Zásilkovna', address: 'Prague, Wenceslas Square 1', city: 'Prague', country: 'CZ', lat: 50.081, lng: 14.427 },
  { id: 'locker_par_1', provider: 'Mondial Relay', address: 'Paris, Rue de Rivoli 50', city: 'Paris', country: 'FR', lat: 48.8606, lng: 2.3376 },
  { id: 'locker_vie_1', provider: 'DPD Pickup', address: 'Vienna, Mariahilfer Straße 20', city: 'Vienna', country: 'AT', lat: 48.198, lng: 16.35 },
  { id: 'locker_bts_1', provider: 'Packeta', address: 'Bratislava, Obchodná 10', city: 'Bratislava', country: 'SK', lat: 48.1486, lng: 17.1077 },
];

export function filterCatalogPoints(points, country, city) {
  const cc = String(country || '').toUpperCase();
  const q = String(city || '').trim().toLowerCase();
  let list = cc ? points.filter((p) => p.country === cc) : points;
  if (!q) return list;
  return list.filter(
    (p) => p.city.toLowerCase() === q
      || p.city.toLowerCase().includes(q)
      || q.includes(p.city.toLowerCase())
      || p.address.toLowerCase().includes(q),
  );
}
