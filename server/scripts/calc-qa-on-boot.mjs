/**
 * In-process calculator QA (used on Railway boot when RUN_CALC_QA_ON_BOOT=1).
 * Logs a single JSON summary line prefixed with CALC_QA_RESULT.
 */
const PRESETS = {
  XS: { lengthCm: 35, widthCm: 25, heightCm: 2, weightKg: 0.2 },
  S: { lengthCm: 35, widthCm: 20, heightCm: 10, weightKg: 2 },
  M: { lengthCm: 40, widthCm: 30, heightCm: 30, weightKg: 10 },
  L: { lengthCm: 60, widthCm: 40, heightCm: 40, weightKg: 20 },
};

const ROUTES = ['HU', 'PL', 'DE', 'SK', 'CZ', 'AT', 'FR', 'IT', 'NL', 'RO', 'UA', 'ES'];

function goodSource(src) {
  return ['mate', 'mate-matrix', 'novapost', 'estimate'].includes(String(src || ''));
}

export async function runCalcQa(baseUrl) {
  const BASE = String(baseUrl || '').replace(/\/$/, '');
  const pass = [];
  const fail = [];
  const warn = [];

  const ok = (cond, msg) => (cond ? pass : fail).push(msg);
  const soft = (cond, msg) => (cond ? pass : warn).push(msg);

  async function req(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-mate-locale': 'ru',
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json };
    } catch (e) {
      return { status: 0, json: { error: String(e?.message || e) } };
    } finally {
      clearTimeout(timer);
    }
  }

  const get = (path) => req('GET', path);
  const post = (path, body) => req('POST', path, body);

  console.log(`[calc-qa] start base=${BASE}`);

  const health = await get('/api/health');
  ok(health.status === 200, `health HTTP ${health.status}`);

  const settings = await get('/api/shipping/quote-settings');
  ok(settings.status === 200, `quote-settings HTTP ${settings.status}`);
  ok(settings.json?.data?.currency === 'HUF', `currency=${settings.json?.data?.currency}`);

  const catalogTotals = {};
  for (const to of ROUTES) {
    const r = await post('/api/shipping/calculate-batch', {
      fromCountry: 'HU',
      toCountry: to,
      declaredValue: 100,
      pickupMode: 'branch',
      deliveryMode: 'locker',
      sizes: ['XS', 'S', 'M', 'L'].map((boxSize) => ({ boxSize, ...PRESETS[boxSize] })),
    });
    ok(r.status === 200, `catalog ${to} HTTP ${r.status} ${r.json?.error || ''}`);
    const q = r.json?.data?.quotes || {};
    const src = r.json?.data?.priceSource;
    soft(goodSource(src), `catalog ${to} source=${src}`);
    catalogTotals[to] = {};
    for (const key of ['XS', 'S', 'M', 'L']) {
      const total = q[key]?.total;
      ok(Number(total) > 0, `catalog ${to} ${key} total=${total}`);
      catalogTotals[to][key] = total;
    }
    if (q.XS?.total && q.S?.total) soft(q.XS.total <= q.S.total + 80, `catalog ${to} XS<=S`);
    if (q.S?.total && q.M?.total) soft(q.S.total <= q.M.total + 80, `catalog ${to} S<=M`);
    if (q.M?.total && q.L?.total) soft(q.M.total <= q.L.total + 80, `catalog ${to} M<=L`);
  }

  const czS = catalogTotals.CZ?.S;
  ok(czS > 0 && czS < 7000, `pricing fix CZ S=${czS} (expect <7000, was 7620)`);
  soft(czS >= 2000 && czS <= 5500, `pricing fix CZ S=${czS} in band`);

  for (const [cc, city] of Object.entries({ HU: 'Budapest', CZ: 'Prague', DE: 'Berlin', SK: 'Bratislava' })) {
    const cov = await get(`/api/shipping/coverage?fromCountry=HU&fromCity=Budapest&toCountry=${cc}&toCity=${encodeURIComponent(city)}`);
    ok(cov.status === 200, `coverage HU→${cc}/${city} HTTP ${cov.status}`);
    for (const kind of ['locker', 'branch', 'pudo']) {
      const pts = await get(`/api/shipping/points?country=${cc}&city=${encodeURIComponent(city)}&kind=${kind}`);
      ok(pts.status === 200, `points ${cc}/${city}/${kind} HTTP ${pts.status}`);
    }
  }

  const fromPts = await get('/api/shipping/points?country=HU&city=Budapest&kind=branch');
  const toPts = await get('/api/shipping/points?country=CZ&city=Prague&kind=locker');
  const fromId = fromPts.json?.data?.points?.[0]?.id;
  const toId = toPts.json?.data?.points?.[0]?.id;
  ok(Boolean(fromId), `Budapest branch id=${fromId}`);
  ok(Boolean(toId), `Prague locker id=${toId}`);

  if (fromId && toId) {
    const batch = await post('/api/shipping/calculate-batch', {
      fromCountry: 'HU',
      toCountry: 'CZ',
      declaredValue: 100,
      pickupMode: 'branch',
      deliveryMode: 'locker',
      pickupLocation: { kind: 'division', divisionId: Number(fromId), countryCode: 'HU' },
      deliveryLocation: { kind: 'division', divisionId: Number(toId), countryCode: 'CZ' },
      sizes: [{ boxSize: 'S', ...PRESETS.S }],
    });
    const bt = batch.json?.data?.quotes?.S?.total;
    ok(batch.status === 200 && bt > 0, `batch with divisions S=${bt}`);

    const fin = await post('/api/shipping/calculate-final', {
      fromCountry: 'HU',
      toCountry: 'CZ',
      pickupMode: 'branch',
      deliveryMode: 'locker',
      declaredValue: 100,
      pickupLocation: { kind: 'division', divisionId: Number(fromId), countryCode: 'HU' },
      deliveryLocation: { kind: 'division', divisionId: Number(toId), countryCode: 'CZ' },
      parcel: { boxSize: 'S', ...PRESETS.S, declaredValue: 100 },
    });
    const ft = fin.json?.data?.amount ?? fin.json?.data?.total;
    ok(fin.status === 200 && ft > 0, `final S=${ft} HTTP ${fin.status}`);
    if (bt > 0 && ft > 0) soft(Math.abs(bt - ft) <= 100, `batch≈final (${bt} vs ${ft})`);
    soft(
      fin.json?.data?.priceSource === 'mate' || fin.json?.data?.priceSource === 'novapost',
      `final source=${fin.json?.data?.priceSource}`,
    );
  }

  const dom = await post('/api/shipping/calculate-batch', {
    fromCountry: 'HU',
    toCountry: 'HU',
    declaredValue: 100,
    pickupMode: 'branch',
    deliveryMode: 'locker',
    sizes: [{ boxSize: 'S', ...PRESETS.S }],
  });
  ok(dom.status === 200 && dom.json?.data?.quotes?.S?.total > 0,
    `domestic HU→HU S=${dom.json?.data?.quotes?.S?.total}`);

  const addr = await post('/api/shipping/calculate-batch', {
    fromCountry: 'HU',
    toCountry: 'SK',
    declaredValue: 100,
    pickupMode: 'address',
    deliveryMode: 'address',
    pickupLocation: {
      kind: 'address',
      countryCode: 'HU',
      addressParts: { city: 'Budapest', street: 'Karinthy Frigyes ut', building: '7', postCode: '1117' },
    },
    deliveryLocation: {
      kind: 'address',
      countryCode: 'SK',
      addressParts: { city: 'Bratislava', street: 'Main', building: '1', postCode: '81101' },
    },
    sizes: [{ boxSize: 'S', ...PRESETS.S }],
  });
  ok(addr.status === 200 && addr.json?.data?.quotes?.S?.total > 0,
    `address HU→SK S=${addr.json?.data?.quotes?.S?.total}`);

  const fat = await post('/api/shipping/calculate-batch', {
    fromCountry: 'HU',
    toCountry: 'DE',
    declaredValue: 100,
    pickupMode: 'home',
    deliveryMode: 'home',
    sizes: [{ boxSize: 'custom', lengthCm: 80, widthCm: 80, heightCm: 80, weightKg: 80 }],
  });
  soft(
    fat.status >= 400 || fat.json?.data?.errors?.custom || !(fat.json?.data?.quotes?.custom?.total > 0),
    `overweight handled status=${fat.status}`,
  );

  const bc = await get('/api/shipping/barcode/code128/SHHU4116249021.png');
  const qr = await get('/api/shipping/barcode/qr/SHHU4116249021.png');
  ok(bc.status === 200, `barcode code128 HTTP ${bc.status}`);
  ok(qr.status === 200, `barcode qr HTTP ${qr.status}`);

  const report = {
    base: BASE,
    at: new Date().toISOString(),
    pass: pass.length,
    fail: fail.length,
    warn: warn.length,
    failures: fail,
    warnings: warn,
    catalogTotals,
  };
  console.log(`CALC_QA_RESULT ${JSON.stringify(report)}`);
  console.log(`[calc-qa] RESULT pass=${pass.length} fail=${fail.length} warn=${warn.length}`);
  return report;
}

const isCli = process.argv[1] && /calc-qa-on-boot\.mjs$/i.test(String(process.argv[1]).replace(/\\/g, '/'));
if (isCli) {
  const base = process.argv[2] || `http://127.0.0.1:${process.env.PORT || 8080}`;
  const report = await runCalcQa(base);
  process.exit(report.fail ? 1 : 0);
}
