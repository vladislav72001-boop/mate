/**
 * Professional in-process QA (Railway boot when RUN_CALC_QA_ON_BOOT=1).
 * Covers APIs, pricing, modes, pages/assets, i18n smoke, barcodes, geocode.
 * Logs: CALC_QA_RESULT {json}
 */
const PRESETS = {
  XS: { lengthCm: 35, widthCm: 25, heightCm: 2, weightKg: 0.2 },
  S: { lengthCm: 35, widthCm: 20, heightCm: 10, weightKg: 2 },
  M: { lengthCm: 40, widthCm: 30, heightCm: 30, weightKg: 10 },
  L: { lengthCm: 60, widthCm: 40, heightCm: 40, weightKg: 20 },
};

const CATALOG_ROUTES = ['HU', 'PL', 'DE', 'SK', 'CZ', 'AT', 'FR', 'IT', 'NL', 'RO', 'UA', 'ES', 'LT', 'LV', 'EE', 'BE', 'GB', 'MD'];
const CITY = {
  HU: 'Budapest', PL: 'Warsaw', DE: 'Berlin', SK: 'Bratislava', CZ: 'Prague', AT: 'Vienna',
  FR: 'Paris', IT: 'Rome', NL: 'Amsterdam', RO: 'Bucharest', UA: 'Kyiv', ES: 'Madrid',
  LT: 'Vilnius', LV: 'Riga', EE: 'Tallinn', BE: 'Brussels', GB: 'London', MD: 'Chisinau',
};

function goodSource(src) {
  return ['mate', 'mate-matrix', 'novapost', 'estimate'].includes(String(src || ''));
}

export async function runCalcQa(baseUrl) {
  const BASE = String(baseUrl || '').replace(/\/$/, '');
  const pass = [];
  const fail = [];
  const warn = [];
  const notes = {};

  const ok = (cond, msg) => (cond ? pass : fail).push(msg);
  const soft = (cond, msg) => (cond ? pass : warn).push(msg);

  async function req(method, path, body, { expectJson = true, accept } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          accept: accept || (expectJson ? 'application/json' : '*/*'),
          'content-type': 'application/json',
          'x-mate-locale': 'ru',
        },
        body: method === 'POST' || method === 'PUT' ? JSON.stringify(body ?? {}) : undefined,
        signal: ctrl.signal,
        redirect: 'manual',
      });
      const ct = res.headers.get('content-type') || '';
      let json = {};
      let text = '';
      if (expectJson && ct.includes('json')) {
        json = await res.json().catch(() => ({}));
      } else {
        const buf = await res.arrayBuffer();
        text = Buffer.from(buf).toString('utf8').slice(0, 4000);
        json = { bytes: buf.byteLength, contentType: ct, textSnippet: text.slice(0, 1500) };
      }
      return { status: res.status, json, contentType: ct, headers: res.headers };
    } catch (e) {
      return { status: 0, json: { error: String(e?.message || e) }, contentType: '', headers: null };
    } finally {
      clearTimeout(timer);
    }
  }

  const get = (path, opts) => req('GET', path, undefined, opts);
  const post = (path, body, opts) => req('POST', path, body, opts);

  console.log(`[calc-qa] PRO start base=${BASE}`);

  // ── 1. Infra / settings ──────────────────────────────────────────
  const health = await get('/api/health');
  ok(health.status === 200, `health HTTP ${health.status}`);
  soft(health.json?.ok === true || health.json?.status === 'ok' || health.status === 200, 'health body ok');

  const settings = await get('/api/shipping/quote-settings');
  ok(settings.status === 200, `quote-settings HTTP ${settings.status}`);
  ok(settings.json?.data?.currency === 'HUF', `currency=${settings.json?.data?.currency}`);
  soft(Number(settings.json?.data?.vatPercent) === 27, `vatPercent=${settings.json?.data?.vatPercent}`);

  const authCfg = await get('/api/auth/config');
  soft(authCfg.status === 200, `auth/config HTTP ${authCfg.status}`);

  // ── 2. SPA pages + brand assets (visual shell) ───────────────────
  for (const path of ['/', '/cabinet', '/admin', '/about', '/services']) {
    const r = await get(path, { expectJson: false, accept: 'text/html' });
    ok(r.status === 200, `page ${path} HTTP ${r.status}`);
    if (path === '/') {
      soft(/mate|Mate|MATE/i.test(String(r.json?.textSnippet || '') + String(JSON.stringify(r.json || '')).slice(0, 800)), 'home HTML mentions Mate');
      soft((r.json?.contentType || '').includes('text/html'), 'home content-type html');
    }
  }
  for (const asset of ['/favicon.ico', '/favicon.svg', '/site.webmanifest', '/og-mate-hungary.png']) {
    const r = await get(asset, { expectJson: false, accept: '*/*' });
    soft(r.status === 200 && (r.json?.bytes || 0) > 20, `asset ${asset} HTTP ${r.status} bytes=${r.json?.bytes}`);
  }
  {
    const missing = await get('/definitely-missing-asset-qa.png', { expectJson: false });
    soft(missing.status === 404, `missing asset 404 got ${missing.status}`);
  }

  // ── 3. Full catalog quotes (all destinations) ────────────────────
  const catalogTotals = {};
  for (const to of CATALOG_ROUTES) {
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
    soft(goodSource(r.json?.data?.priceSource), `catalog ${to} source=${r.json?.data?.priceSource}`);
    catalogTotals[to] = {};
    for (const key of ['XS', 'S', 'M', 'L']) {
      const total = q[key]?.total;
      // L may be unavailable for locker on some routes — soft if missing
      if (key === 'L' && !(Number(total) > 0)) {
        soft(false, `catalog ${to} L total=${total} (locker may disallow L)`);
      } else {
        ok(Number(total) > 0, `catalog ${to} ${key} total=${total}`);
      }
      catalogTotals[to][key] = total;
    }
    if (q.XS?.total && q.S?.total) soft(q.XS.total <= q.S.total + 120, `catalog ${to} XS<=S`);
    if (q.S?.total && q.M?.total) soft(q.S.total <= q.M.total + 120, `catalog ${to} S<=M`);
  }
  notes.catalogTotals = catalogTotals;

  // Markup 30% + no double VAT
  const czS = catalogTotals.CZ?.S;
  ok(czS > 0 && czS < 7000, `pricing CZ S=${czS} (<7000, no double VAT)`);
  soft(czS >= 4000 && czS <= 5200, `pricing CZ S=${czS} band for 30% markup (~4660)`);

  // Domestic
  ok(Number(catalogTotals.HU?.S) > 0, `domestic HU→HU S=${catalogTotals.HU?.S}`);

  // ── 4. Coverage + points (key cities) ────────────────────────────
  const pointCities = [
    ['HU', 'Budapest'], ['CZ', 'Prague'], ['DE', 'Berlin'], ['SK', 'Bratislava'],
    ['PL', 'Warsaw'], ['AT', 'Vienna'],
  ];
  for (const [cc, city] of pointCities) {
    const cov = await get(`/api/shipping/coverage?fromCountry=HU&fromCity=Budapest&toCountry=${cc}&toCity=${encodeURIComponent(city)}`);
    ok(cov.status === 200, `coverage HU→${cc}/${city} HTTP ${cov.status}`);
    const delivery = cov.json?.data?.delivery || {};
    soft(
      Boolean(delivery.home?.available || delivery.locker?.available || delivery.branch?.available || delivery.pudo?.available),
      `coverage ${cc} has a delivery mode`,
    );
    for (const kind of ['locker', 'branch', 'pudo']) {
      const pts = await get(`/api/shipping/points?country=${cc}&city=${encodeURIComponent(city)}&kind=${kind}`);
      ok(pts.status === 200, `points ${cc}/${city}/${kind} HTTP ${pts.status}`);
      const list = pts.json?.data?.points || [];
      soft(Array.isArray(list), `points ${cc}/${kind} array`);
    }
  }

  // ── 5. Batch/final with real divisions + mode matrix ─────────────
  const fromPts = await get('/api/shipping/points?country=HU&city=Budapest&kind=branch');
  const toLocker = await get('/api/shipping/points?country=CZ&city=Prague&kind=locker');
  const toBranch = await get('/api/shipping/points?country=CZ&city=Prague&kind=branch');
  const fromId = fromPts.json?.data?.points?.[0]?.id;
  const lockerId = toLocker.json?.data?.points?.[0]?.id;
  const branchId = toBranch.json?.data?.points?.[0]?.id;
  ok(Boolean(fromId), `Budapest branch id=${fromId}`);
  ok(Boolean(lockerId), `Prague locker id=${lockerId}`);

  let batchLocker = 0;
  let batchBranch = 0;
  if (fromId && lockerId) {
    const batch = await post('/api/shipping/calculate-batch', {
      fromCountry: 'HU', toCountry: 'CZ', declaredValue: 100,
      pickupMode: 'branch', deliveryMode: 'locker',
      pickupLocation: { kind: 'division', divisionId: Number(fromId), countryCode: 'HU' },
      deliveryLocation: { kind: 'division', divisionId: Number(lockerId), countryCode: 'CZ' },
      sizes: [{ boxSize: 'S', ...PRESETS.S }],
    });
    batchLocker = batch.json?.data?.quotes?.S?.total || 0;
    ok(batch.status === 200 && batchLocker > 0, `batch divisions locker S=${batchLocker}`);

    const fin = await post('/api/shipping/calculate-final', {
      fromCountry: 'HU', toCountry: 'CZ',
      pickupMode: 'branch', deliveryMode: 'locker', declaredValue: 100,
      pickupLocation: { kind: 'division', divisionId: Number(fromId), countryCode: 'HU' },
      deliveryLocation: { kind: 'division', divisionId: Number(lockerId), countryCode: 'CZ' },
      parcel: { boxSize: 'S', ...PRESETS.S, declaredValue: 100 },
    });
    const ft = fin.json?.data?.amount ?? fin.json?.data?.total;
    ok(fin.status === 200 && ft > 0, `final S=${ft} HTTP ${fin.status}`);
    if (batchLocker > 0 && ft > 0) soft(Math.abs(batchLocker - ft) <= 100, `batch≈final (${batchLocker} vs ${ft})`);
    soft(goodSource(fin.json?.data?.priceSource), `final source=${fin.json?.data?.priceSource}`);
    notes.finalBreakdown = {
      priceSource: fin.json?.data?.priceSource,
      markupPercent: fin.json?.data?.markupPercent,
      amount: ft,
    };
    soft(
      Number(fin.json?.data?.markupPercent) === 30
      || String(JSON.stringify(fin.json?.data?.breakdown || [])).includes('30'),
      `markup 30% visible (markupPercent=${fin.json?.data?.markupPercent})`,
    );
  }

  if (fromId && branchId) {
    const batch = await post('/api/shipping/calculate-batch', {
      fromCountry: 'HU', toCountry: 'CZ', declaredValue: 100,
      pickupMode: 'branch', deliveryMode: 'branch',
      pickupLocation: { kind: 'division', divisionId: Number(fromId), countryCode: 'HU' },
      deliveryLocation: { kind: 'division', divisionId: Number(branchId), countryCode: 'CZ' },
      sizes: [{ boxSize: 'S', ...PRESETS.S }],
    });
    batchBranch = batch.json?.data?.quotes?.S?.total || 0;
    ok(batch.status === 200 && batchBranch > 0, `batch divisions branch S=${batchBranch}`);
    if (batchLocker > 0 && batchBranch > 0) {
      soft(batchBranch + 50 >= batchLocker, `branch≥locker (${batchBranch} vs ${batchLocker})`);
    }
  }

  // Address mode
  const addr = await post('/api/shipping/calculate-batch', {
    fromCountry: 'HU', toCountry: 'SK', declaredValue: 100,
    pickupMode: 'address', deliveryMode: 'address',
    pickupLocation: {
      kind: 'address', countryCode: 'HU',
      addressParts: { city: 'Budapest', street: 'Karinthy Frigyes ut', building: '7', postCode: '1117' },
    },
    deliveryLocation: {
      kind: 'address', countryCode: 'SK',
      addressParts: { city: 'Bratislava', street: 'Main', building: '1', postCode: '81101' },
    },
    sizes: [{ boxSize: 'S', ...PRESETS.S }],
  });
  ok(addr.status === 200 && addr.json?.data?.quotes?.S?.total > 0,
    `address HU→SK S=${addr.json?.data?.quotes?.S?.total}`);

  // Mode rank: address should be >= locker catalog for same route (soft)
  const skLocker = catalogTotals.SK?.S;
  const skAddr = addr.json?.data?.quotes?.S?.total;
  if (skLocker && skAddr) soft(skAddr + 80 >= skLocker, `address≥locker SK (${skAddr} vs ${skLocker})`);

  // ── 6. Validation / edge cases ───────────────────────────────────
  const fat = await post('/api/shipping/calculate-batch', {
    fromCountry: 'HU', toCountry: 'DE', declaredValue: 100,
    pickupMode: 'home', deliveryMode: 'home',
    sizes: [{ boxSize: 'custom', lengthCm: 80, widthCm: 80, heightCm: 80, weightKg: 80 }],
  });
  soft(
    fat.status >= 400 || fat.json?.data?.errors?.custom || !(fat.json?.data?.quotes?.custom?.total > 0),
    `overweight handled status=${fat.status}`,
  );

  const oversize = await post('/api/shipping/calculate-batch', {
    fromCountry: 'HU', toCountry: 'DE', declaredValue: 100,
    pickupMode: 'home', deliveryMode: 'home',
    sizes: [{ boxSize: 'custom', lengthCm: 130, widthCm: 40, heightCm: 40, weightKg: 10 }],
  });
  soft(
    oversize.status >= 400 || oversize.json?.data?.errors?.custom || !(oversize.json?.data?.quotes?.custom?.total > 0),
    `oversize handled status=${oversize.status}`,
  );

  const badCountry = await post('/api/shipping/calculate-batch', {
    fromCountry: 'HU', toCountry: 'XX', declaredValue: 100,
    pickupMode: 'branch', deliveryMode: 'locker',
    sizes: [{ boxSize: 'S', ...PRESETS.S }],
  });
  soft(
    badCountry.status >= 400 || !(badCountry.json?.data?.quotes?.S?.total > 0),
    `invalid country handled status=${badCountry.status}`,
  );

  // Promo preview (invalid code should not crash)
  const promo = await post('/api/shipping/promo/preview', {
    fromCountry: 'HU', toCountry: 'CZ',
    pickupMode: 'branch', deliveryMode: 'locker',
    declaredValue: 100,
    promoCode: 'QA-INVALID-CODE-XYZ',
    parcel: { boxSize: 'S', ...PRESETS.S, declaredValue: 100 },
    pickupLocation: fromId ? { kind: 'division', divisionId: Number(fromId), countryCode: 'HU' } : undefined,
    deliveryLocation: lockerId ? { kind: 'division', divisionId: Number(lockerId), countryCode: 'CZ' } : undefined,
  });
  soft(promo.status === 200 || promo.status === 400 || promo.status === 422,
    `promo preview HTTP ${promo.status}`);

  // Geocode
  const geo = await get('/api/shipping/geocode?q=Andrassy&country=HU&city=Budapest&lang=ru');
  soft(geo.status === 200, `geocode HTTP ${geo.status}`);
  soft(Array.isArray(geo.json?.data?.suggestions || geo.json?.data || []) || geo.status === 200,
    'geocode returns data');

  // Track unknown TTN — should not 500
  const track = await get('/api/shipping/track/SHHU0000000000');
  soft(track.status === 200 || track.status === 404 || track.status === 400,
    `track unknown HTTP ${track.status}`);

  // Order status unknown token — should not 500
  const ost = await get('/api/shipping/orders/status/qa-missing-token');
  soft(ost.status === 404 || ost.status === 400 || ost.status === 200,
    `order status missing HTTP ${ost.status}`);

  // ── 7. Barcodes (email visuals) ──────────────────────────────────
  const bc = await get('/api/shipping/barcode/code128/SHHU4116249021.png', { expectJson: false, accept: 'image/png' });
  const qr = await get('/api/shipping/barcode/qr/SHHU4116249021.png', { expectJson: false, accept: 'image/png' });
  ok(bc.status === 200 && (bc.json?.bytes || 0) > 50, `barcode code128 HTTP ${bc.status} bytes=${bc.json?.bytes}`);
  ok(qr.status === 200 && (qr.json?.bytes || 0) > 50, `barcode qr HTTP ${qr.status} bytes=${qr.json?.bytes}`);
  soft((bc.json?.contentType || '').includes('image'), `barcode ct=${bc.json?.contentType}`);

  // ── 8. Fragile / insurance extras via final ──────────────────────
  if (fromId && lockerId) {
    const withExtras = await post('/api/shipping/calculate-final', {
      fromCountry: 'HU', toCountry: 'CZ',
      pickupMode: 'branch', deliveryMode: 'locker', declaredValue: 50000,
      fragile: true, insurance: true,
      pickupLocation: { kind: 'division', divisionId: Number(fromId), countryCode: 'HU' },
      deliveryLocation: { kind: 'division', divisionId: Number(lockerId), countryCode: 'CZ' },
      parcel: { boxSize: 'S', ...PRESETS.S, declaredValue: 50000 },
    });
    const base = withExtras.json?.data?.amount ?? withExtras.json?.data?.total;
    const extrasOk = withExtras.status === 200 && base > 0;
    ok(extrasOk, `final+fragile+insurance HTTP ${withExtras.status} total=${base}`);
    if (batchLocker > 0 && base > 0) soft(base >= batchLocker, `extras ≥ base (${base} vs ${batchLocker})`);
  }

  const report = {
    suite: 'pro',
    base: BASE,
    at: new Date().toISOString(),
    pass: pass.length,
    fail: fail.length,
    warn: warn.length,
    failures: fail,
    warnings: warn,
    notes,
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
