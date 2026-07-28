/**
 * Professional QA: API matrix + Playwright UI click-test for Mate calculator.
 * Flow: country → cities → size → modes → sender → recipient → contents → value → pay
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.QA_BASE || 'https://www.matedelivery.com';
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'tmp-qa');
mkdirSync(OUT_DIR, { recursive: true });

const DEST_COUNTRIES = [
  { code: 'PL', city: 'Warsaw', cityRu: 'Варшава', label: 'Польша' },
  { code: 'DE', city: 'Berlin', cityRu: 'Берлин', label: 'Германия' },
  { code: 'FR', city: 'Paris', cityRu: 'Париж', label: 'Франция' },
  { code: 'ES', city: 'Madrid', cityRu: 'Мадрид', label: 'Испания' },
  { code: 'IT', city: 'Rome', cityRu: 'Рим', label: 'Италия' },
  { code: 'CZ', city: 'Prague', cityRu: 'Прага', label: 'Чехия' },
  { code: 'SK', city: 'Bratislava', cityRu: 'Братислава', label: 'Словакия' },
  { code: 'AT', city: 'Vienna', cityRu: 'Вена', label: 'Австрия' },
  { code: 'RO', city: 'Bucharest', cityRu: 'Бухарест', label: 'Румыния' },
  { code: 'UA', city: 'Kyiv', cityRu: 'Киев', label: 'Украина' },
  { code: 'LT', city: 'Vilnius', cityRu: 'Вильнюс', label: 'Литва' },
  { code: 'LV', city: 'Riga', cityRu: 'Рига', label: 'Латвия' },
  { code: 'EE', city: 'Tallinn', cityRu: 'Таллин', label: 'Эстония' },
  { code: 'NL', city: 'Amsterdam', cityRu: 'Амстердам', label: 'Нидерланды' },
  { code: 'BE', city: 'Brussels', cityRu: 'Брюссель', label: 'Бельгия' },
  { code: 'GB', city: 'London', cityRu: 'Лондон', label: 'Великобритания' },
  { code: 'MD', city: 'Chișinău', cityRu: 'Кишинёв', label: 'Молдова' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const SIZE_ALLOWED = {
  XS: ['locker', 'branch', 'home'],
  S: ['locker', 'branch', 'home'],
  M: ['locker', 'branch', 'home'],
  L: ['branch', 'home'],
  XL: ['home'],
  custom: ['home'],
};

const findings = [];
const pass = [];
const fail = [];

function ok(id, msg) {
  pass.push({ id, msg });
  console.log(`  ✅ ${id}: ${msg}`);
}
function bad(id, msg, extra) {
  fail.push({ id, msg, extra });
  findings.push({ severity: 'fail', id, msg, extra });
  console.log(`  ❌ ${id}: ${msg}${extra ? ` | ${JSON.stringify(extra)}` : ''}`);
}
function warn(id, msg, extra) {
  findings.push({ severity: 'warn', id, msg, extra });
  console.log(`  ⚠️  ${id}: ${msg}${extra ? ` | ${JSON.stringify(extra)}` : ''}`);
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  const data = json?.data ?? json;
  return { status: res.status, json, data, text: text.slice(0, 500) };
}

function isNumericId(id) {
  return /^\d+$/.test(String(id || ''));
}

async function runApiMatrix() {
  console.log('\n=== API MATRIX: coverage + points + quotes ===\n');
  const health = await api('/api/health');
  if (health.status !== 200 || !health.json?.ok) bad('api-health', 'Health check failed', health);
  else ok('api-health', 'ok');

  for (const dest of DEST_COUNTRIES) {
    const cov = await api(
      `/api/shipping/coverage?fromCountry=HU&fromCity=Budapest&toCountry=${dest.code}&toCity=${encodeURIComponent(dest.city)}`,
    );
    if (cov.status !== 200) {
      bad(`cov-${dest.code}`, `coverage HTTP ${cov.status}`, cov.text);
      continue;
    }
    const d = cov.data?.delivery || {};
    const p = cov.data?.pickup || {};
    const modes = {
      pickupLocker: !!p.locker?.available,
      pickupBranch: !!p.branch?.available,
      pickupHome: p.home?.available !== false,
      delLocker: !!d.locker?.available,
      delBranch: !!d.branch?.available,
      delHome: d.home?.available !== false,
    };
    ok(`cov-${dest.code}`, `${dest.city}: ${JSON.stringify(modes)}`);

    for (const kind of ['branch', 'locker']) {
      const pts = await api(
        `/api/shipping/points?country=${dest.code}&city=${encodeURIComponent(dest.city)}&kind=${kind}&side=delivery`,
      );
      if (pts.status !== 200) {
        bad(`pts-${dest.code}-${kind}`, `HTTP ${pts.status}`);
        continue;
      }
      const list = pts.data?.points || [];
      const badIds = list.filter((x) => !isNumericId(x.id));
      const src = pts.data?.source || 'unknown';
      if (!list.length) {
        if (kind === 'locker' && !modes.delLocker) {
          ok(`pts-${dest.code}-${kind}`, `empty (coverage off) src=${src}`);
        } else if (kind === 'branch' && !modes.delBranch) {
          ok(`pts-${dest.code}-${kind}`, `empty (coverage off) src=${src}`);
        } else {
          warn(`pts-${dest.code}-${kind}`, `empty list while coverage suggests available`, { src, modes });
        }
      } else if (badIds.length) {
        bad(`pts-${dest.code}-${kind}`, `${badIds.length}/${list.length} non-numeric IDs (cannot quote)`, {
          sample: badIds.slice(0, 3).map((x) => x.id),
          src,
        });
      } else {
        ok(`pts-${dest.code}-${kind}`, `${list.length} NP ids, src=${src}`);
      }
    }
  }

  // HU pickup points
  for (const kind of ['branch', 'locker']) {
    const pts = await api(`/api/shipping/points?country=HU&city=Budapest&kind=${kind}&side=pickup`);
    const list = pts.data?.points || [];
    const badIds = list.filter((x) => !isNumericId(x.id));
    if (!list.length) warn(`pts-HU-${kind}`, 'empty Budapest pickup list');
    else if (badIds.length) bad(`pts-HU-${kind}`, `non-numeric IDs`, { n: badIds.length });
    else ok(`pts-HU-${kind}`, `${list.length} quoteable points`);
  }

  // Size × mode quote smoke (DE Berlin, branch→branch / locker / home where allowed)
  console.log('\n=== API QUOTES: sizes × delivery modes (HU Budapest → DE Berlin) ===\n');
  const huBranch = await api('/api/shipping/points?country=HU&city=Budapest&kind=branch&side=pickup');
  const deBranch = await api('/api/shipping/points?country=DE&city=Berlin&kind=branch&side=delivery');
  const deLocker = await api('/api/shipping/points?country=DE&city=Berlin&kind=locker&side=delivery');
  const pickupId = (huBranch.data?.points || []).find((p) => isNumericId(p.id))?.id;
  const delBranchId = (deBranch.data?.points || []).find((p) => isNumericId(p.id))?.id;
  const delLockerId = (deLocker.data?.points || []).find((p) => isNumericId(p.id))?.id;

  if (!pickupId) bad('quote-setup', 'No HU branch for quotes');
  else {
    const presets = {
      XS: { lengthCm: 5, widthCm: 35, heightCm: 50, weightKg: 2 },
      S: { lengthCm: 12, widthCm: 36, heightCm: 57, weightKg: 5 },
      M: { lengthCm: 20, widthCm: 36, heightCm: 60, weightKg: 10 },
      L: { lengthCm: 38, widthCm: 36, heightCm: 60, weightKg: 20 },
      XL: { lengthCm: 60, widthCm: 40, heightCm: 60, weightKg: 31 },
    };
    for (const size of SIZES) {
      for (const mode of SIZE_ALLOWED[size]) {
        const dim = presets[size];
        let deliveryLocation;
        if (mode === 'branch') {
          if (!delBranchId) { warn(`q-${size}-${mode}`, 'no DE branch id'); continue; }
          deliveryLocation = { kind: 'division', countryCode: 'DE', divisionId: String(delBranchId) };
        } else if (mode === 'locker') {
          if (!delLockerId) { warn(`q-${size}-${mode}`, 'no DE locker id'); continue; }
          deliveryLocation = { kind: 'division', countryCode: 'DE', divisionId: String(delLockerId) };
        } else {
          deliveryLocation = {
            kind: 'address',
            countryCode: 'DE',
            addressParts: { city: 'Berlin', street: 'Friedrichstrasse', building: '1', postCode: '10117' },
          };
        }
        const body = {
          sizes: [{
            boxSize: size,
            lengthCm: dim.lengthCm,
            widthCm: dim.widthCm,
            heightCm: dim.heightCm,
            weightKg: dim.weightKg,
          }],
          fromCountry: 'HU',
          toCountry: 'DE',
          declaredValue: 50,
          pickupMode: 'branch',
          deliveryMode: mode,
          pickupLocation: { kind: 'division', countryCode: 'HU', divisionId: String(pickupId) },
          deliveryLocation,
        };
        const q = await api('/api/shipping/calculate-batch', { method: 'POST', body: JSON.stringify(body) });
        const quote = q.data?.quotes?.[size];
        const price = typeof quote === 'number' ? quote : quote?.total;
        const err = q.json?.error;
        if (q.status !== 200 || price == null) {
          bad(`q-${size}-${mode}`, `no price`, { status: q.status, err, snippet: q.text });
        } else {
          ok(`q-${size}-${mode}`, `€${price}`);
        }
      }
    }
  }
}

async function clickNext(page) {
  await page.locator('.calc-form__nav .btn-lime').click();
}

async function selectCountry(page, labelRu) {
  await page.locator('.calc-country-select .calc-option-trigger').click();
  const list = page.locator('.calc-option-list').last();
  await list.waitFor({ state: 'visible' });
  const item = list.locator('.calc-option-list__item').filter({ hasText: labelRu }).first();
  await item.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
  await item.click({ force: true });
}

async function resetCalc(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try {
      localStorage.setItem('mate-locale', 'ru');
      Object.keys(localStorage).forEach((k) => {
        if (/calc|draft/i.test(k)) localStorage.removeItem(k);
      });
    } catch { /* */ }
  });
  await page.reload({ waitUntil: 'networkidle' });
}

async function selectDestCityByValue(page, cityLabel) {
  const selects = page.locator('.calc-city-select .calc-option-trigger');
  await selects.nth(1).click();
  const list = page.locator('.calc-option-list').last();
  await list.waitFor({ state: 'visible', timeout: 10000 });
  const opt = list.locator('.calc-option-list__item').filter({ hasText: cityLabel }).first();
  await opt.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
  await opt.click({ force: true });
}

async function selectSize(page, size) {
  if (size === 'custom') {
    await page.locator('.calc-form__size').filter({ hasText: /нестандарт|non-standard|egyedi|нестандартн/i }).click();
  } else {
    await page.locator(`.calc-form__size`).filter({ has: page.locator(`b:text-is("${size}")`) }).click();
  }
}

async function selectModeInGroup(page, groupLabelRe, modeLabelRe) {
  const group = page.locator('p.calc-form__group-label').filter({ hasText: groupLabelRe });
  await group.first().waitFor({ timeout: 15000 });
  const section = group.locator('xpath=following-sibling::div[contains(@class,"calc-form__options")][1]');
  const btn = section.locator('.calc-form__option').filter({ hasText: modeLabelRe }).first();
  await btn.waitFor({ timeout: 15000 });
  const disabled = await btn.evaluate((el) => el.classList.contains('is-disabled') || el.classList.contains('is-soon') || el.disabled);
  if (disabled) return { ok: false, disabled: true };
  await btn.click();
  return { ok: true, disabled: false };
}

async function fillPerson(page, prefix, data) {
  await page.locator(`input[name="${prefix}_first_name"]`).fill(data.first);
  await page.locator(`input[name="${prefix}_last_name"]`).fill(data.last);
  await page.locator(`input[name="${prefix}_phone"]`).fill(data.phone);
  await page.locator(`input[name="${prefix}_email"]`).fill(data.email);
}

async function pickFirstLocker(page) {
  const empty = page.locator('.calc-locker').filter({ hasText: /нет точек|no points|nincs|немає/i });
  if (await empty.count()) return false;
  const item = page.locator('.calc-locker__item').first();
  await item.waitFor({ timeout: 45000 });
  await item.click();
  const active = page.locator('.calc-locker__item.active');
  return (await active.count()) > 0;
}

async function pickAddressApprox(page, name, street) {
  const input = page.locator(`input[name="${name}"]`);
  await input.fill(street);
  await page.waitForTimeout(800);
  const approx = page.locator('.calc-address__approx');
  const real = page.locator('.calc-address__list button').filter({ hasNot: page.locator('.calc-address__approx') }).first();
  if (await approx.count()) {
    await approx.click();
    return true;
  }
  if (await real.count()) {
    await real.click();
    return true;
  }
  // wait longer for search
  await page.waitForTimeout(1500);
  if (await approx.count()) { await approx.click(); return true; }
  if (await page.locator('.calc-address__list button').count()) {
    await page.locator('.calc-address__list button').first().click();
    return true;
  }
  return false;
}

async function readNavError(page) {
  const alert = page.locator('.calc-form__error--nav, .calc-form__error[role="alert"]');
  if (await alert.count()) return (await alert.first().innerText()).trim();
  return null;
}

async function goToPayStep(page, { countryLabel, destCityLabel, size, pickupMode, deliveryMode }) {
  // Step 1
  await selectCountry(page, countryLabel);
  await clickNext(page);

  // Step 2 — leave Budapest default (not touched → branch list without address)
  await selectDestCityByValue(page, destCityLabel);
  await clickNext(page);

  // Step 3 size — wait for quotes
  await page.locator('.calc-form__sizes').waitFor();
  await page.waitForTimeout(1500);
  await selectSize(page, size);
  // Wait until selected size shows a price if possible
  await page.waitForTimeout(800);
  await clickNext(page);

  // Step 4 modes
  await page.locator('.calc-form__group-label').first().waitFor();
  // Wait coverage
  const waitHint = page.locator('.calc-form__hint--wait');
  if (await waitHint.count()) {
    await waitHint.first().waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
  }

  const pickupRe = /забрать|откуда|pickup|feladás|звідки/i;
  const deliverRe = /доставить|куда|deliver|kézbesítés|куди/i;
  const modeMap = {
    home: /домашн|home address|otthoni|домашня/i,
    branch: /филиал|branch|fiok|fiók|філіал/i,
    locker: /постамат|locker|automata|поштомат|csomagautomata/i,
  };

  const p = await selectModeInGroup(page, pickupRe, modeMap[pickupMode]);
  if (!p.ok) throw new Error(`Pickup mode ${pickupMode} disabled`);
  const d = await selectModeInGroup(page, deliverRe, modeMap[deliveryMode]);
  if (!d.ok) throw new Error(`Delivery mode ${deliveryMode} disabled`);
  await clickNext(page);

  // Step 5 sender
  await fillPerson(page, 'sender', {
    first: 'Test',
    last: 'Sender',
    phone: '301234567',
    email: 'qa-sender@matedelivery.com',
  });
  if (pickupMode === 'branch' || pickupMode === 'locker') {
    const picked = await pickFirstLocker(page);
    if (!picked) throw new Error(`No pickup ${pickupMode} points`);
  } else {
    const okAddr = await pickAddressApprox(page, 'sender_address', 'Andrássy út 20');
    if (!okAddr) throw new Error('Pickup address suggest failed');
    // postal may auto-fill
    const postal = page.locator('input[name="sender_postal"]');
    if (await postal.count() && !(await postal.inputValue())) {
      await postal.fill('1061');
    }
  }
  await clickNext(page);
  let err = await readNavError(page);
  if (err) throw new Error(`Step5 blocked: ${err}`);

  // Step 6 recipient
  await fillPerson(page, 'receiver', {
    first: 'Test',
    last: 'Receiver',
    phone: '15123456789',
    email: 'qa-receiver@matedelivery.com',
  });
  if (deliveryMode === 'branch' || deliveryMode === 'locker') {
    const picked = await pickFirstLocker(page);
    if (!picked) throw new Error(`No delivery ${deliveryMode} points`);
  } else {
    const name = await page.locator('input[name="receiver_address"]').count()
      ? 'receiver_address'
      : 'receiver_address_home';
    // home uses receiver_address typically
    const homeName = (await page.locator('input[name="receiver_address"]').count())
      ? 'receiver_address'
      : (await page.locator('input[name^="receiver_"]').all()).map(async () => {}).length;
    const addrName = (await page.locator('input[name="receiver_address"]').count())
      ? 'receiver_address'
      : null;
    // find address input on home
    const addrInput = page.locator('.calc-address input[type="text"]').first();
    await addrInput.fill('Friedrichstrasse 1');
    await page.waitForTimeout(1000);
    if (await page.locator('.calc-address__approx').count()) {
      await page.locator('.calc-address__approx').click();
    } else if (await page.locator('.calc-address__list button').count()) {
      await page.locator('.calc-address__list button').first().click();
    } else {
      throw new Error('Delivery address suggest failed');
    }
    const destPostal = page.locator('input[name="receiver_postal"], input[name="dest_postal"], input[autocomplete="postal-code"]').last();
    if (await destPostal.count() && !(await destPostal.inputValue())) {
      await destPostal.fill('10117');
    }
    void name; void homeName; void addrName;
  }
  await clickNext(page);
  err = await readNavError(page);
  if (err) throw new Error(`Step6 blocked: ${err}`);

  // Step 7 contents — default first option ok
  await clickNext(page);

  // Step 8 value/payer
  await clickNext(page);

  // Step 9 pay
  await page.locator('.calc-form__nav .btn-lime').filter({ hasText: /оплат|pay|fizet/i }).waitFor({ timeout: 30000 });
  const payBtn = page.locator('.calc-form__nav .btn-lime').filter({ hasText: /оплат|pay|fizet/i });
  const text = await payBtn.innerText();
  const totalVisible = page.locator('text=/€|Ft|грн/').first();
  return { payText: text, hasTotal: await totalVisible.count() > 0 };
}

async function runUiTests() {
  console.log('\n=== PLAYWRIGHT UI CLICK-TEST ===\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Clear draft
  await resetCalc(page);

  // Open calculator — look for CTA
  const openCalc = page.locator('a, button').filter({ hasText: /рассчит|calculate|kalkul|розрахув|отправ/i }).first();
  if (await openCalc.count()) {
    await openCalc.click().catch(() => {});
  }
  // Calculator may be inline on home
  await page.locator('.calc-form, .shipment-calculator, [class*="calc"]').first().waitFor({ timeout: 20000 }).catch(() => {});

  // Ensure we see step 1
  const step1 = page.locator('.calc-country-select, .calc-country-static');
  if (!(await step1.count())) {
    // try scrolling to calculator
    await page.locator('#calculator, #calc, .calc-wrap').first().scrollIntoViewIfNeeded().catch(() => {});
  }
  if (!(await page.locator('.calc-country-select').count())) {
    bad('ui-open', 'Calculator country select not found on homepage');
    await page.screenshot({ path: join(OUT_DIR, 'ui-open-fail.png'), fullPage: true });
    await browser.close();
    return;
  }
  ok('ui-open', 'Calculator visible');

  // --- A) All countries reach size step with quotes ---
  console.log('\n-- Countries → cities → size quotes --\n');
  for (const dest of DEST_COUNTRIES) {
    await resetCalc(page);
    try {
      await selectCountry(page, dest.label);
      await clickNext(page);
      await selectDestCityByValue(page, dest.cityRu);
      await clickNext(page);
      await page.locator('.calc-form__sizes').waitFor({ timeout: 30000 });
      // wait for at least one price on XS/S/M
      let priced = 0;
      for (let i = 0; i < 20; i++) {
        priced = await page.locator('.calc-form__size em').count();
        if (priced >= 3) break;
        await page.waitForTimeout(500);
      }
      if (priced < 1) {
        bad(`ui-country-${dest.code}`, 'No size prices after cities', { city: dest.city });
        await page.screenshot({ path: join(OUT_DIR, `country-${dest.code}.png`) });
      } else {
        ok(`ui-country-${dest.code}`, `${priced} size prices shown`);
      }

      // Size mode chips: L no locker, XL only home
      await selectSize(page, 'L');
      const lModes = await page.locator('.calc-form__size.active .calc-form__size-mode').allTextContents();
      if (lModes.some((m) => /постамат|locker|поштомат/i.test(m))) {
        bad(`ui-size-L-${dest.code}`, 'L shows locker chip', { lModes });
      } else {
        ok(`ui-size-L-${dest.code}`, `modes: ${lModes.join(',')}`);
      }
      await selectSize(page, 'XL');
      const xlModes = await page.locator('.calc-form__size.active .calc-form__size-mode').allTextContents();
      if (xlModes.length !== 1 || !/адрес|home|cíм|адрес/i.test(xlModes[0] || '')) {
        // XL should only home/address
        if (!xlModes.some((m) => /адрес|Address|Cím|Адреса/i.test(m)) || xlModes.length > 1) {
          warn(`ui-size-XL-${dest.code}`, `unexpected chips`, { xlModes });
        } else ok(`ui-size-XL-${dest.code}`, `modes: ${xlModes.join(',')}`);
      } else {
        ok(`ui-size-XL-${dest.code}`, `modes: ${xlModes.join(',')}`);
      }

      // Step 4: check delivery modes for M
      await selectSize(page, 'M');
      await clickNext(page);
      await page.locator('.calc-form__group-label').first().waitFor();
      await page.waitForTimeout(2000);
      const waitHint = page.locator('.calc-form__hint--wait');
      if (await waitHint.count()) {
        await waitHint.first().waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
      }

      const deliverLabel = page.locator('p.calc-form__group-label').filter({ hasText: /доставить|куда|deliver|kézbesítés|куди/i });
      const deliverOpts = deliverLabel.locator('xpath=following-sibling::div[contains(@class,"calc-form__options")][1]');
      const modes = {
        locker: deliverOpts.locator('.calc-form__option').filter({ hasText: /постамат|locker|automata|поштомат/i }).first(),
        branch: deliverOpts.locator('.calc-form__option').filter({ hasText: /филиал|branch|fiók|філіал/i }).first(),
        home: deliverOpts.locator('.calc-form__option').filter({ hasText: /домашн|home address|otthoni|домашня/i }).first(),
      };
      const state = {};
      for (const [k, loc] of Object.entries(modes)) {
        if (!(await loc.count())) { state[k] = 'missing'; continue; }
        state[k] = await loc.evaluate((el) => (
          el.classList.contains('is-disabled') || el.classList.contains('is-soon') ? 'disabled' : 'enabled'
        ));
      }
      ok(`ui-modes-${dest.code}`, JSON.stringify(state));

      // Pickup locker should be soon/disabled
      const pickupLabel = page.locator('p.calc-form__group-label').filter({ hasText: /забрать|откуда|pickup|feladás|звідки/i });
      const pickupOpts = pickupLabel.locator('xpath=following-sibling::div[contains(@class,"calc-form__options")][1]');
      const pickupLocker = pickupOpts.locator('.calc-form__option').filter({ hasText: /постамат|locker|automata|поштомат/i }).first();
      if (await pickupLocker.count()) {
        const pl = await pickupLocker.evaluate((el) => ({
          disabled: el.classList.contains('is-disabled') || el.classList.contains('is-soon'),
          soon: el.classList.contains('is-soon') || /скоро|soon|hamarosan|скоро/i.test(el.textContent || ''),
        }));
        if (!pl.disabled) bad(`ui-pickup-locker-${dest.code}`, 'Pickup locker should be disabled/soon');
        else ok(`ui-pickup-locker-${dest.code}`, 'disabled/soon');
      }
    } catch (e) {
      bad(`ui-country-${dest.code}`, String(e.message || e));
      await page.screenshot({ path: join(OUT_DIR, `fail-${dest.code}.png`) }).catch(() => {});
    }
  }

  // --- B) Full path to pay: DE × delivery modes ---
  console.log('\n-- Full path to payment (DE) × delivery modes --\n');
  for (const deliveryMode of ['branch', 'locker', 'home']) {
    await resetCalc(page);
    try {
      const result = await goToPayStep(page, {
        countryLabel: 'Германия',
        destCityLabel: 'Берлин',
        size: 'M',
        pickupMode: 'branch',
        deliveryMode,
      });
      ok(`ui-full-DE-${deliveryMode}`, `reached pay: ${result.payText.replace(/\s+/g, ' ').slice(0, 80)}`);
      await page.screenshot({ path: join(OUT_DIR, `pay-DE-${deliveryMode}.png`) });
      // Do NOT click pay (would create real checkout)
    } catch (e) {
      bad(`ui-full-DE-${deliveryMode}`, String(e.message || e));
      await page.screenshot({ path: join(OUT_DIR, `pay-fail-DE-${deliveryMode}.png`) }).catch(() => {});
      const err = await readNavError(page);
      if (err) warn(`ui-full-DE-${deliveryMode}-nav`, err);
    }
  }

  // --- C) Size gate: XL only home on step 4 ---
  console.log('\n-- Size gates L/XL --\n');
  await resetCalc(page);
  try {
    await selectCountry(page, 'Польша');
    await clickNext(page);
    await selectDestCityByValue(page, 'Варшава');
    await clickNext(page);
    await selectSize(page, 'XL');
    await clickNext(page);
    await page.waitForTimeout(2000);
    const deliverLabel = page.locator('p.calc-form__group-label').filter({ hasText: /доставить|куда|deliver|kézbesítés|куди/i });
    const deliverOpts = deliverLabel.locator('xpath=following-sibling::div[contains(@class,"calc-form__options")][1]');
    for (const [name, re] of [['locker', /постамат|locker/i], ['branch', /филиал|branch/i]]) {
      const btn = deliverOpts.locator('.calc-form__option').filter({ hasText: re }).first();
      const disabled = await btn.evaluate((el) => el.classList.contains('is-disabled'));
      if (!disabled) bad(`ui-XL-gate-${name}`, 'should be disabled for XL');
      else ok(`ui-XL-gate-${name}`, 'disabled');
    }
    const home = deliverOpts.locator('.calc-form__option').filter({ hasText: /домашн|home/i }).first();
    const homeDis = await home.evaluate((el) => el.classList.contains('is-disabled'));
    if (homeDis) bad('ui-XL-gate-home', 'home should be enabled');
    else ok('ui-XL-gate-home', 'enabled');
  } catch (e) {
    bad('ui-XL-gate', String(e.message || e));
  }

  // Spot-check PL branch full path
  console.log('\n-- Full path PL branch --\n');
  await resetCalc(page);
  try {
    const result = await goToPayStep(page, {
      countryLabel: 'Польша',
      destCityLabel: 'Варшава',
      size: 'S',
      pickupMode: 'branch',
      deliveryMode: 'branch',
    });
    ok('ui-full-PL-branch', `reached pay: ${result.payText.replace(/\s+/g, ' ').slice(0, 80)}`);
  } catch (e) {
    bad('ui-full-PL-branch', String(e.message || e));
    await page.screenshot({ path: join(OUT_DIR, 'pay-fail-PL-branch.png') }).catch(() => {});
  }

  if (consoleErrors.length) {
    warn('ui-console', `${consoleErrors.length} console errors`, consoleErrors.slice(0, 8));
  } else {
    ok('ui-console', 'no page errors');
  }

  await browser.close();
}

async function main() {
  console.log(`QA target: ${BASE}`);
  await runApiMatrix();
  await runUiTests();

  const report = {
    base: BASE,
    at: new Date().toISOString(),
    pass: pass.length,
    fail: fail.length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    fails: fail,
    findings,
  };
  writeFileSync(join(OUT_DIR, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}  WARN: ${report.warnings}`);
  console.log(`Report: ${join(OUT_DIR, 'qa-report.json')}`);
  if (fail.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
