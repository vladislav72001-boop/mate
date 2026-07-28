/**
 * Pixel-close transactional emails for status waiting_from_you
 * Matching MATE mockups: courier / branch / postamat.
 */

import { localeFromOrder, mailT, intlLocale } from './mail-i18n.mjs';

const BRAND = {
  lime: '#D2E84D',
  black: '#0B0B0B',
  ink: '#111111',
  muted: '#6B7280',
  soft: '#F4F5F1',
  line: '#E5E7EB',
  page: '#EDEEE9',
  white: '#FFFFFF',
  map: '#ECEDEA',
};

const FONT = {
  display: "'Space Grotesk','Plus Jakarta Sans',Segoe UI,Helvetica Neue,Arial,sans-serif",
  body: "'Plus Jakarta Sans',Segoe UI,Helvetica Neue,Arial,sans-serif",
};

const COUNTRY_NAMES = {
  HU: 'Budapest',
  SK: 'Bratislava',
  DE: 'Berlin',
  PL: 'Warsaw',
  CZ: 'Prague',
  AT: 'Vienna',
  FR: 'Paris',
  RO: 'Bucharest',
  UA: 'Kyiv',
  IT: 'Rome',
  ES: 'Madrid',
  NL: 'Amsterdam',
  BE: 'Brussels',
  GB: 'London',
  LT: 'Vilnius',
  LV: 'Riga',
  EE: 'Tallinn',
  MD: 'Chișinău',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appUrl() {
  return String(process.env.APP_URL || 'http://localhost:5011').replace(/\/$/, '');
}

function formatMoney(amount, currency = 'EUR', locale = 'ru') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  const intl = intlLocale(locale);
  try {
    if (String(currency).toUpperCase() === 'HUF') {
      return `${Math.round(num).toLocaleString(intl)} HUF`;
    }
    return new Intl.NumberFormat(intl, { style: 'currency', currency }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

export function normalizeMode(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'home' || raw === 'address' || raw === 'courier') return 'home';
  if (raw === 'branch' || raw === 'office') return 'branch';
  return 'locker';
}

export function pickupModeFromOrder(order) {
  const tariff = order?.payload?.tariff || {};
  return normalizeMode(tariff.pickupMode || tariff.pickupType);
}

function locationLabel(location, fallback, locale = 'ru') {
  const pending = mailT(locale, 'pendingLabel');
  if (!location || typeof location !== 'object') return fallback || pending;
  if (location.kind === 'address' && location.addressParts) {
    const p = location.addressParts;
    const line = [p.city, [p.street, p.building].filter(Boolean).join(' '), p.postCode]
      .filter(Boolean)
      .join(', ');
    return line || fallback || pending;
  }
  return (
    location.address
    || location.addressLine
    || location.name
    || location.provider
    || fallback
    || pending
  );
}

function mapsUrlForLocation(location, addressFallback) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const q = encodeURIComponent(addressFallback || '');
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function formatTrackDisplay(raw) {
  const clean = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!clean) return '—';
  if (clean.length >= 12) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8)}`;
  }
  return clean;
}

function lockerCodeFromOrder(order) {
  const snap = order?.npSnapshot || {};
  const fromSnap = String(snap.lockerCode || snap.cellCode || snap.pin || '').replace(/\D/g, '');
  if (fromSnap.length >= 6) return fromSnap.slice(0, 6);
  const fromPayload = String(order?.payload?.lockerCode || order?.payload?.cellCode || '').replace(/\D/g, '');
  if (fromPayload.length >= 6) return fromPayload.slice(0, 6);
  const digits = String(order?.npTtn || '').replace(/\D/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  return '';
}

function parsePickupTime(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
  if (m) return { start: m[1], end: m[2], label: `${m[1]}-${m[2]}` };
  return { start: '10:00', end: '11:30', label: text || '10:00-11:30' };
}

function formatRuDate(isoOrText, locale = 'ru') {
  const raw = String(isoOrText || '').trim();
  if (!raw) return mailT(locale, 'pendingLabel');
  if (/[а-яА-ЯіІїЇєЄёЁ]/.test(raw) && locale === 'ru') return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'long' });
}

function isTomorrow(isoOrText) {
  const d = new Date(isoOrText);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return d.getFullYear() === tomorrow.getFullYear()
    && d.getMonth() === tomorrow.getMonth()
    && d.getDate() === tomorrow.getDate();
}

function cityFromCountry(code, fallbackLine) {
  if (fallbackLine) {
    const first = String(fallbackLine).split(',')[0]?.trim();
    if (first) return first;
  }
  return COUNTRY_NAMES[String(code || '').toUpperCase()] || String(code || '—');
}

function orderContext(order) {
  const locale = localeFromOrder(order);
  const t = (key, vars) => mailT(locale, key, vars);
  const payload = order?.payload || {};
  const tariff = payload.tariff || {};
  const sender = payload.sender || {};
  const receiver = payload.receiver || {};
  const parcel = payload.parcel || {};
  const pickupMode = pickupModeFromOrder(order);
  const pickupLocation = tariff.pickupLocation || {};
  const deliveryLocation = tariff.deliveryLocation || {};
  const trackRaw = order?.npTtn || order?.orderNumber || '';
  const track = formatTrackDisplay(trackRaw);
  const time = parsePickupTime(tariff.pickupTime);
  const dateLabel = formatRuDate(tariff.pickupDate, locale);
  const tomorrow = isTomorrow(tariff.pickupDate);
  const senderName = sender.name || '—';
  const receiverName = [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || '—';
  const senderPhone = sender.phone || order?.senderPhone || '';
  const pickupAddress = locationLabel(pickupLocation, sender.line, locale);
  const pointName = pickupLocation.name
    || pickupLocation.provider
    || (pickupMode === 'branch' ? t('branchMate') : pickupMode === 'locker' ? t('locker') : '');
  const pointDetail = pickupLocation.address
    || pickupLocation.addressLine
    || (pickupAddress !== sender.line ? pickupAddress : '');
  const fromCity = cityFromCountry(tariff.fromCountry || sender.country || 'HU', sender.line);
  const toCity = cityFromCountry(tariff.toCountry || receiver.country || 'SK', receiver.destinationLine);
  const boxSize = parcel.boxSize || 'S';
  const weightKg = parcel.weightKg || 5;
  const contents = parcel.description || parcel.contents || '—';
  const declaredAmount = parcel.declaredValue != null ? parcel.declaredValue : 100;
  const declared = t('upToEur', { amount: declaredAmount });
  const amount = formatMoney(order?.amount, order?.currency || 'HUF', locale);
  const cardTailRaw = String(payload.paymentLast4 || payload.cardLast4 || '').replace(/\D/g, '');
  const cardTail = cardTailRaw.slice(-4);
  const lockerCode = lockerCodeFromOrder(order);
  const hasRealLockerCode = Boolean(
    String(payload.lockerCode || payload.cellCode || '').replace(/\D/g, '').length >= 6
    || order?.npSnapshot?.lockerCode
    || order?.npSnapshot?.cellCode,
  );
  const publicToken = order?.publicToken || '';
  const site = appUrl();
  const trackQuery = encodeURIComponent(order?.npTtn || order?.orderNumber || '');
  const trackUrl = trackQuery
    ? `${site}/?track=${trackQuery}`
    : `${site}/?cabinet=tracking`;
  const pdfUrl = publicToken
    ? `${site}/api/shipping/orders/${encodeURIComponent(publicToken)}/waybill.pdf`
    : trackUrl;
  const manageUrl = publicToken
    ? `${site}/?order=${encodeURIComponent(publicToken)}`
    : `${site}/?cabinet=shipments`;
  const dash = `${site}/?cabinet=shipments`;
  const mapsUrl = mapsUrlForLocation(pickupLocation, pickupAddress || pointName);
  const phoneHref = senderPhone ? `tel:${String(senderPhone).replace(/\s+/g, '')}` : dash;
  const pointPhone = pickupLocation.phone || '';

  return {
    order,
    locale,
    t,
    payload,
    tariff,
    sender,
    receiver,
    parcel,
    pickupMode,
    pickupLocation,
    deliveryLocation,
    track,
    trackRaw,
    time,
    dateLabel,
    tomorrow,
    senderName,
    receiverName,
    senderPhone,
    pickupAddress,
    pointName,
    pointDetail,
    fromCity,
    toCity,
    boxSize,
    weightKg,
    contents,
    declared,
    amount,
    cardTail,
    lockerCode,
    hasRealLockerCode,
    publicToken,
    trackUrl,
    pdfUrl,
    manageUrl,
    dash,
    mapsUrl,
    phoneHref,
    pointPhone,
  };
}

function btnPrimary(href, label) {
  return `
    <a href="${escapeHtml(href)}" style="display:block;padding:14px 16px;background:${BRAND.lime};color:${BRAND.black};text-decoration:none;border-radius:12px;font-family:${FONT.display};font-size:15px;font-weight:700;text-align:center;line-height:1.2;">
      ${escapeHtml(label)}
    </a>`;
}

function btnOutline(href, label) {
  return `
    <a href="${escapeHtml(href)}" style="display:block;padding:13px 16px;background:${BRAND.white};color:${BRAND.black};text-decoration:none;border-radius:12px;border:1.5px solid ${BRAND.black};font-family:${FONT.display};font-size:15px;font-weight:700;text-align:center;line-height:1.2;">
      ${escapeHtml(label)}
    </a>`;
}

function dualButtons(leftHref, leftLabel, rightHref, rightLabel, leftPrimary = true) {
  const left = leftPrimary ? btnPrimary(leftHref, leftLabel) : btnOutline(leftHref, leftLabel);
  const right = leftPrimary ? btnOutline(rightHref, rightLabel) : btnPrimary(rightHref, rightLabel);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
      <tr>
        <td style="width:50%;padding-right:6px;vertical-align:top;">${left}</td>
        <td style="width:50%;padding-left:6px;vertical-align:top;">${right}</td>
      </tr>
    </table>`;
}

function pill(text, tone = 'gray') {
  const bg = tone === 'lime' ? BRAND.lime : '#EEF0EA';
  const color = BRAND.black;
  return `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 10px;border-radius:999px;background:${bg};color:${color};font-family:${FONT.body};font-size:12px;font-weight:600;">${escapeHtml(text)}</span>`;
}

function mapBlock({ pinLabel, distanceLabel, fromLabel }) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;background:${BRAND.map};border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:22px 18px;height:150px;vertical-align:middle;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="28%" align="center" style="vertical-align:middle;">
                <div style="width:36px;height:36px;border-radius:50%;background:${BRAND.black};color:${BRAND.white};font-family:${FONT.body};font-size:10px;line-height:36px;text-align:center;">◉</div>
                <div style="margin-top:6px;font-family:${FONT.body};font-size:11px;color:${BRAND.muted};">${escapeHtml(fromLabel)}</div>
              </td>
              <td width="44%" align="center" style="vertical-align:middle;">
                <div style="border-top:2px dashed ${BRAND.lime};position:relative;margin:0 4px;">
                  <span style="display:inline-block;margin-top:-12px;padding:3px 8px;background:${BRAND.lime};border-radius:999px;font-family:${FONT.body};font-size:11px;font-weight:700;color:${BRAND.black};">${escapeHtml(distanceLabel)}</span>
                </div>
              </td>
              <td width="28%" align="center" style="vertical-align:middle;">
                <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:${BRAND.black};transform:rotate(-45deg);margin:0 auto 8px;"></div>
                <div style="font-family:${FONT.body};font-size:11px;color:${BRAND.ink};font-weight:700;">${escapeHtml(pinLabel)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function barcodeBlock({ title, track }) {
  let qrHtml = '';
  const seed = String(track || 'MATE');
  for (let y = 0; y < 9; y += 1) {
    qrHtml += '<tr>';
    for (let x = 0; x < 9; x += 1) {
      const corner = (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5);
      const on = corner || ((x * 3 + y * 5 + seed.charCodeAt(0)) % 4) !== 0;
      qrHtml += `<td style="width:4px;height:4px;background:${on ? BRAND.black : BRAND.white};font-size:0;line-height:0;">&nbsp;</td>`;
    }
    qrHtml += '</tr>';
  }

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:1px dashed ${BRAND.line};border-radius:14px;background:${BRAND.white};">
      <tr>
        <td style="padding:16px 16px 8px;font-family:${FONT.body};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};font-weight:700;">
          ${escapeHtml(title)}
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 10px;font-family:${FONT.display};font-size:26px;font-weight:700;letter-spacing:.06em;color:${BRAND.ink};">
          ${escapeHtml(track)}
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:middle;padding-right:12px;">
                <div style="height:46px;border-radius:4px;background:repeating-linear-gradient(90deg,#111 0 2px,#fff 2px 3px,#111 3px 5px,#fff 5px 7px,#111 7px 8px,#fff 8px 10px);"></div>
              </td>
              <td width="52" style="vertical-align:middle;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.black};padding:3px;">
                  ${qrHtml}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function routeBlock(fromCity, toCity, eta) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
      <tr>
        <td width="34%" style="font-family:${FONT.body};font-size:13px;color:${BRAND.ink};font-weight:700;">
          <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${BRAND.black};color:${BRAND.white};text-align:center;line-height:18px;font-size:10px;margin-right:6px;">A</span>${escapeHtml(fromCity)}
        </td>
        <td width="32%" align="center" style="font-family:${FONT.body};font-size:11px;color:${BRAND.muted};border-bottom:1px dashed ${BRAND.line};padding-bottom:4px;">
          ${escapeHtml(eta)}
        </td>
        <td width="34%" align="right" style="font-family:${FONT.body};font-size:13px;color:${BRAND.ink};font-weight:700;">
          ${escapeHtml(toCity)}<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${BRAND.lime};color:${BRAND.black};text-align:center;line-height:18px;font-size:10px;margin-left:6px;">B</span>
        </td>
      </tr>
    </table>`;
}

function orderTotalCard(ctx) {
  const t = ctx.t;
  const paymentLabel = ctx.cardTail
    ? t('cardMasked', { card: ctx.cardTail })
    : t('cardOnline');
  const rows = [
    [t('recipient'), ctx.receiverName],
    [t('contents'), `${ctx.contents} — ${ctx.declared}`],
    [t('size'), `${ctx.boxSize} — ${t('upToKg', { kg: ctx.weightKg })}`],
    [t('payment'), paymentLabel],
  ];
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${BRAND.black};border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:14px 16px 8px;font-family:${FONT.body};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#A1A1AA;font-weight:700;">
          ${escapeHtml(t('orderTotal'))}
        </td>
      </tr>
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding:6px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:${FONT.body};font-size:13px;color:#A1A1AA;">${escapeHtml(label)}</td>
                <td align="right" style="font-family:${FONT.body};font-size:13px;color:${BRAND.white};font-weight:600;">${escapeHtml(value)}</td>
              </tr>
            </table>
          </td>
        </tr>`).join('')}
      <tr>
        <td style="padding:12px 16px 16px;">
          <div style="font-family:${FONT.display};font-size:28px;font-weight:700;color:${BRAND.lime};line-height:1;">${escapeHtml(ctx.amount)}</div>
          <div style="margin-top:4px;font-family:${FONT.body};font-size:11px;color:#8B9098;">${escapeHtml(t('taxesIncluded'))}</div>
        </td>
      </tr>
    </table>`;
}

function footerSupport(locale = 'ru') {
  return `
    <p style="margin:8px 0 0;font-family:${FONT.body};font-size:12px;line-height:1.55;color:${BRAND.muted};">
      ${mailT(locale, 'supportFooter')}
    </p>`;
}

function sectionTitle(num, text) {
  return `
    <div style="margin:4px 0 12px;font-family:${FONT.body};font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.ink};">
      ${num ? `<span style="color:${BRAND.muted};margin-right:6px;">${escapeHtml(String(num))}</span>` : ''}${escapeHtml(text)}
    </div>`;
}

function timelineBar(start, end, locale = 'ru') {
  const toMin = (tm) => {
    const [h, m] = String(tm).split(':').map(Number);
    return (h * 60 + (m || 0)) - 8 * 60;
  };
  const total = 12 * 60;
  const s = Math.max(0, Math.min(total, toMin(start)));
  const e = Math.max(s + 30, Math.min(total, toMin(end)));
  const left = (s / total) * 100;
  const width = ((e - s) / total) * 100;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 14px;">
      <tr>
        <td style="padding:10px 12px;background:${BRAND.soft};border-radius:12px;">
          <div style="font-family:${FONT.body};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};font-weight:700;margin-bottom:8px;">${escapeHtml(mailT(locale, 'arrivalWindow'))}</div>
          <div style="position:relative;height:14px;background:#DFE1D8;border-radius:999px;overflow:hidden;">
            <div style="margin-left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;height:14px;background:${BRAND.lime};border-radius:999px;"></div>
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
            <tr>
              <td style="font-family:${FONT.body};font-size:11px;color:${BRAND.muted};">08:00</td>
              <td align="center" style="font-family:${FONT.body};font-size:11px;color:${BRAND.ink};font-weight:700;">${escapeHtml(start)}–${escapeHtml(end)}</td>
              <td align="right" style="font-family:${FONT.body};font-size:11px;color:${BRAND.muted};">20:00</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function hoursBars(locale = 'ru') {
  const t = (key) => mailT(locale, key);
  const row = (label, left, width, text, closed = false) => `
    <tr>
      <td width="54" style="padding:4px 0;font-family:${FONT.body};font-size:12px;color:${BRAND.muted};">${escapeHtml(label)}</td>
      <td style="padding:4px 0;">
        <div style="height:16px;background:#E8E9E3;border-radius:999px;overflow:hidden;position:relative;">
          <div style="margin-left:${left}%;width:${width}%;height:16px;background:${closed ? '#CFD1C8' : BRAND.lime};border-radius:999px;text-align:center;font-family:${FONT.body};font-size:10px;line-height:16px;font-weight:700;color:${BRAND.black};">${escapeHtml(text)}</div>
        </div>
      </td>
    </tr>`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">
      ${row(t('monFri'), 8, 50, '08:00–20:00')}
      ${row(t('saturday'), 16, 34, '10:00–18:00')}
      ${row(t('sunday'), 0, 100, t('dayOff'), true)}
    </table>`;
}

function checklist3(items) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
      <tr>
        ${items.map((it, idx) => `
          <td width="33%" style="vertical-align:top;padding:${idx === 0 ? '0 6px 0 0' : idx === 2 ? '0 0 0 6px' : '0 3px'};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-radius:12px;background:${BRAND.white};height:100%;">
              <tr>
                <td style="padding:12px 10px;">
                  <div style="width:28px;height:28px;border-radius:8px;border:1.5px solid ${BRAND.black};text-align:center;line-height:28px;font-size:14px;margin-bottom:8px;">${it.icon}</div>
                  ${it.title ? `<div style="font-family:${FONT.body};font-size:13px;font-weight:700;line-height:1.35;color:${BRAND.ink};margin-bottom:4px;">${escapeHtml(it.title)}</div>` : ''}
                  <div style="font-family:${FONT.body};font-size:12px;line-height:1.45;color:${BRAND.muted};">${escapeHtml(it.text)}</div>
                </td>
              </tr>
            </table>
          </td>`).join('')}
      </tr>
    </table>`;
}

function numberedSteps(steps) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:1px solid ${BRAND.line};border-radius:12px;">
      ${steps.map((step, i) => `
        <tr>
          <td style="padding:12px 14px;${i < steps.length - 1 ? `border-bottom:1px solid ${BRAND.line};` : ''}font-family:${FONT.body};font-size:13px;line-height:1.5;color:${BRAND.ink};">
            <span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${BRAND.lime};color:${BRAND.black};text-align:center;line-height:20px;font-size:11px;font-weight:800;margin-right:8px;">${i + 1}</span>${escapeHtml(step)}
          </td>
        </tr>`).join('')}
    </table>`;
}

function lockerCodeDigits(code) {
  const digits = String(code).padStart(6, '0').slice(0, 6).split('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto;">
      <tr>
        ${digits.map((d) => `
          <td style="padding:0 4px;">
            <div style="width:42px;height:52px;border-radius:10px;background:${BRAND.lime};color:${BRAND.black};font-family:${FONT.display};font-size:28px;font-weight:700;text-align:center;line-height:52px;">${escapeHtml(d)}</div>
          </td>`).join('')}
      </tr>
    </table>`;
}

function lockerIllustration(code, locale = 'ru') {
  const cells = [];
  for (let i = 0; i < 12; i += 1) {
    const highlight = i === 9;
    cells.push(`
      <td style="padding:2px;">
        <div style="width:28px;height:34px;border-radius:4px;border:1px solid #333;background:${highlight ? BRAND.lime : '#2A2A2A'};"></div>
      </td>`);
  }
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;background:#1A1A1A;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:16px;width:42%;vertical-align:top;">
          <div style="background:#111;border-radius:10px;padding:12px;border:1px solid #333;">
            <div style="height:28px;background:#0A0A0A;border-radius:6px;color:${BRAND.lime};font-family:${FONT.display};font-size:16px;font-weight:700;text-align:center;line-height:28px;letter-spacing:.12em;">${escapeHtml(code)}</div>
            <div style="margin-top:10px;font-family:${FONT.body};font-size:10px;color:#9CA3AF;text-align:center;">${escapeHtml(mailT(locale, 'lockerScreen'))}</div>
          </div>
        </td>
        <td style="padding:16px 16px 16px 0;vertical-align:middle;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>${cells.slice(0, 4).join('')}</tr>
            <tr>${cells.slice(4, 8).join('')}</tr>
            <tr>${cells.slice(8, 12).join('')}</tr>
          </table>
          <div style="margin-top:8px;font-family:${FONT.body};font-size:11px;color:${BRAND.lime};font-weight:700;">${escapeHtml(mailT(locale, 'yourCell'))}</div>
        </td>
      </tr>
    </table>`;
}

function buildCourierBody(ctx) {
  const t = ctx.t;
  const dayLead = ctx.tomorrow ? t('tomorrow') : t('date');
  const fromPart = t('fromTime');
  const toPart = t('toTime');
  const headline = fromPart
    ? `${dayLead}, ${ctx.dateLabel} • ${fromPart} ${ctx.time.start} ${toPart} ${ctx.time.end}`
    : `${dayLead}, ${ctx.dateLabel} • ${ctx.time.start}${toPart}${ctx.time.end}`;
  return `
    <h1 style="margin:0 0 8px;font-family:${FONT.display};font-size:26px;line-height:1.2;font-weight:700;color:${BRAND.ink};letter-spacing:-.02em;">
      ${escapeHtml(headline)}
    </h1>
    <p style="margin:0 0 12px;font-family:${FONT.body};font-size:14px;line-height:1.55;color:${BRAND.muted};">
      ${escapeHtml(t('courierLead'))}
    </p>
    ${timelineBar(ctx.time.start, ctx.time.end, ctx.locale)}
    ${dualButtons(ctx.manageUrl, t('reschedule'), ctx.manageUrl, t('cancelPickup'), true)}

    ${mapBlock({ pinLabel: t('pickupHere'), distanceLabel: `4 ${t('minShort')}`, fromLabel: t('courier') })}
    <div style="font-family:${FONT.display};font-size:18px;font-weight:700;color:${BRAND.ink};margin:0 0 4px;">${escapeHtml(ctx.pickupAddress)}</div>
    <div style="font-family:${FONT.body};font-size:13px;color:${BRAND.muted};margin:0 0 8px;line-height:1.5;">
      ${escapeHtml(ctx.senderName)}${ctx.senderPhone ? ` · ${escapeHtml(ctx.senderPhone)}` : ''}
    </div>
    <div style="margin:0 0 12px;">
      ${pill(t('entrance'), 'gray')}${pill(t('intercom'), 'gray')}${pill(t('callCourier'), 'lime')}
    </div>
    <div style="margin:0 0 22px;">${btnOutline(ctx.manageUrl, t('changeAddress'))}</div>

    ${sectionTitle(null, t('needFromYou'))}
    ${checklist3([
      { icon: '📦', text: t('packParcel') },
      { icon: '🏷', text: t('noPrintLabel') },
      { icon: '💳', text: ctx.cardTail
        ? t('noPayCourierCard', { card: ctx.cardTail })
        : t('noPayCourierOnline') },
    ])}

    ${sectionTitle(null, t('howPickup'))}
    ${numberedSteps([
      t('stepCall'),
      t('stepHandOver'),
      t('stepAccepted'),
    ])}

    ${barcodeBlock({ title: t('trackTellCourier'), track: ctx.track })}
    ${routeBlock(ctx.fromCity, ctx.toCity, t('eta23'))}
    ${orderTotalCard(ctx)}
    <div style="margin:0 0 10px;">${btnPrimary(ctx.trackUrl, t('trackParcel'))}</div>
    <div style="margin:0 0 8px;">${btnOutline(ctx.pdfUrl, t('waybillPdf'))}</div>
    ${footerSupport(ctx.locale)}
  `;
}

function buildBranchBody(ctx) {
  const t = ctx.t;
  const branchTitle = ctx.pointName
    ? t('bringToBranchNamed', { name: ctx.pointName })
    : t('bringToBranch');
  const addressLine = ctx.pointDetail || ctx.pickupAddress;
  const callHref = ctx.pointPhone
    ? `tel:${String(ctx.pointPhone).replace(/\s+/g, '')}`
    : ctx.manageUrl;
  return `
    <h1 style="margin:0 0 8px;font-family:${FONT.display};font-size:24px;line-height:1.2;font-weight:700;color:${BRAND.ink};letter-spacing:-.02em;">
      ${escapeHtml(branchTitle)}
    </h1>
    <p style="margin:0 0 14px;font-family:${FONT.body};font-size:14px;line-height:1.55;color:${BRAND.muted};">
      ${escapeHtml(t('branchNoCode'))}
    </p>

    ${sectionTitle(1, t('branchWhere'))}
    ${mapBlock({ pinLabel: ctx.pointName || t('branch'), distanceLabel: '1.2 km', fromLabel: t('youAreHere') })}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;border:1px solid ${BRAND.line};border-radius:14px;background:${BRAND.white};">
      <tr>
        <td style="padding:14px 16px;">
          <div style="font-family:${FONT.display};font-size:17px;font-weight:700;color:${BRAND.ink};margin:0 0 4px;">
            ${escapeHtml(ctx.pointName || t('branchMate'))}
          </div>
          <div style="font-family:${FONT.body};font-size:13px;color:${BRAND.ink};margin:0 0 6px;line-height:1.45;">
            ${escapeHtml(addressLine)}
          </div>
          <div style="font-family:${FONT.body};font-size:13px;color:${BRAND.muted};margin:0 0 10px;line-height:1.5;">
            ${ctx.pointPhone ? escapeHtml(ctx.pointPhone) : escapeHtml(t('branchPhoneHint'))}
          </div>
          <div>
            ${pill(t('openUntil'), 'lime')}${pill(t('hasPackaging'), 'gray')}
          </div>
        </td>
      </tr>
    </table>
    ${dualButtons(ctx.mapsUrl, t('routeBtn'), callHref, t('callBtn'), true)}

    ${sectionTitle(2, t('whenOpen'))}
    ${hoursBars(ctx.locale)}
    <p style="margin:0 0 18px;font-family:${FONT.body};font-size:13px;line-height:1.5;color:${BRAND.muted};">
      ${escapeHtml(t('dropByDate', { date: ctx.dateLabel }))}
    </p>

    ${sectionTitle(3, t('takeWithYou'))}
    ${checklist3([
      { icon: '🪪', title: t('takeIdTitle'), text: t('takeId') },
      { icon: '☰', title: t('takeTrackTitle'), text: t('takeTrack') },
      { icon: '📦', title: t('takeParcelTitle'), text: t('takeParcel') },
    ])}

    ${barcodeBlock({ title: t('trackAtCounter'), track: ctx.track })}
    ${routeBlock(ctx.fromCity, ctx.toCity, t('eta46'))}
    ${orderTotalCard(ctx)}
    <div style="margin:0 0 10px;">${btnPrimary(ctx.trackUrl, t('trackParcel'))}</div>
    ${dualButtons(ctx.pdfUrl, t('waybillPdf'), ctx.manageUrl, t('changeBranch'), false)}
    ${footerSupport(ctx.locale)}
  `;
}

function buildLockerBody(ctx) {
  const t = ctx.t;
  const code = ctx.lockerCode || '';
  const spaced = code.length >= 6
    ? `${code.slice(0, 3)} ${code.slice(3)}`
    : (ctx.track || '—');
  const showDigits = code.length >= 6;
  const timeSuffix = ctx.time.label ? `, ${ctx.time.end}` : '';

  return `
    <h1 style="margin:0 0 10px;font-family:${FONT.display};font-size:26px;line-height:1.2;font-weight:700;color:${BRAND.ink};letter-spacing:-.02em;">
      ${showDigits
    ? escapeHtml(t('cellCodeTitle', { code: spaced }))
    : escapeHtml(t('lockerDropTrack', { track: ctx.track }))}
    </h1>
    <p style="margin:0 0 12px;font-family:${FONT.body};font-size:14px;line-height:1.55;color:${BRAND.muted};">
      ${escapeHtml(showDigits ? t('enterCode') : t('useTrackAtLocker'))}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${BRAND.black};border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:16px 16px 8px;font-family:${FONT.body};font-size:12px;color:#C8CCD2;text-align:center;">
          ${escapeHtml(showDigits
    ? t('codeActiveUntil', { date: ctx.dateLabel, time: timeSuffix })
    : t('dropUntilTrack', { date: ctx.dateLabel, track: ctx.track }))}
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:4px 8px 8px;">
          ${showDigits
    ? lockerCodeDigits(code)
    : `<div style="font-family:${FONT.display};font-size:22px;font-weight:700;color:${BRAND.lime};letter-spacing:.08em;padding:16px;">${escapeHtml(ctx.track)}</div>`}
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 16px;font-family:${FONT.body};font-size:11px;color:#9CA3AF;text-align:center;">
          ${escapeHtml(t('storageLimited'))}
        </td>
      </tr>
    </table>

    ${mapBlock({ pinLabel: ctx.pointName || t('locker'), distanceLabel: '250 m', fromLabel: t('youAreHere') })}
    <div style="font-family:${FONT.display};font-size:17px;font-weight:700;color:${BRAND.ink};margin:0 0 4px;">
      ${escapeHtml(ctx.pointName || t('locker'))}
    </div>
    <div style="font-family:${FONT.body};font-size:13px;color:${BRAND.muted};margin:0 0 8px;line-height:1.5;">
      ${escapeHtml(ctx.pointDetail || ctx.pickupAddress)}
    </div>
    <div style="margin:0 0 12px;">
      ${pill('24/7', 'lime')}${pill(t('nearby'), 'lime')}${pill(t('easyFind'), 'lime')}
    </div>
    <div style="margin:0 0 18px;">${btnPrimary(ctx.mapsUrl, t('openInMaps'))}</div>

    ${showDigits ? lockerIllustration(code, ctx.locale) : ''}
    <p style="margin:0 0 12px;font-family:${FONT.body};font-size:13px;line-height:1.5;color:${BRAND.muted};">
      ${escapeHtml(showDigits
    ? t('enterOpensSize', { size: ctx.boxSize })
    : t('useTrackOnScreen', { track: ctx.track }))}
    </p>
    ${numberedSteps([
      t('lockerStep1'),
      showDigits
        ? t('lockerStep2Code', { code: spaced })
        : t('lockerStep2Track'),
      t('lockerStep3'),
      t('lockerStep4'),
    ])}

    ${barcodeBlock({ title: t('trackTtn'), track: ctx.track })}
    ${routeBlock(ctx.fromCity, ctx.toCity, t('eta12'))}
    ${orderTotalCard(ctx)}
    <div style="margin:0 0 10px;">${btnPrimary(ctx.trackUrl, t('trackParcel'))}</div>
    ${dualButtons(ctx.pdfUrl, t('waybillPdf'), ctx.manageUrl, t('changeOrCancel'), false)}
    ${footerSupport(ctx.locale)}
  `;
}

function methodBanner(mode, locale = 'ru') {
  if (mode === 'home') {
    return { icon: '🚚', text: mailT(locale, 'methodCourier') };
  }
  if (mode === 'branch') {
    return { icon: '🏪', text: mailT(locale, 'methodBranch') };
  }
  return { icon: '▣', text: mailT(locale, 'methodLocker') };
}

function waitingShell({ track, mode, preheader, title, bodyHtml, locale = 'ru' }) {
  const banner = methodBanner(mode, locale);
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    body, table, td, a, p, h1, span, div { -webkit-font-smoothing: antialiased; }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};color:${BRAND.ink};font-family:${FONT.body};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${BRAND.white};border-radius:18px;overflow:hidden;border:1px solid ${BRAND.line};">
          <tr>
            <td style="background:${BRAND.black};padding:18px 22px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${FONT.display};font-size:22px;font-weight:700;color:${BRAND.white};letter-spacing:-.02em;">
                    MATE<span style="color:${BRAND.lime};">.</span>
                  </td>
                  <td align="right" style="font-family:${FONT.body};font-size:11px;color:#A8ADB4;letter-spacing:.04em;">
                    ${escapeHtml(mailT(locale, 'trackLabel'))}: ${escapeHtml(track)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.lime};padding:12px 22px;font-family:${FONT.body};font-size:13px;font-weight:700;color:${BRAND.black};">
              <span style="margin-right:8px;">${banner.icon}</span>${escapeHtml(banner.text)}
            </td>
          </tr>
          <tr>
            <td style="padding:26px 22px 10px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 22px 22px;font-family:${FONT.body};font-size:11px;color:#9CA3AF;">
              © ${year} MATE · matedelivery.com
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function getWaitingFromYouSubject(order) {
  const ctx = orderContext(order);
  const t = ctx.t;
  if (ctx.pickupMode === 'home') {
    return t('courierSubject', {
      when: ctx.tomorrow ? t('tomorrowWord') : ctx.dateLabel,
      start: ctx.time.start,
      end: ctx.time.end,
    });
  }
  if (ctx.pickupMode === 'branch') {
    const name = ctx.pointName || t('branch');
    const address = ctx.pointDetail || ctx.pickupAddress || '';
    return address
      ? t('branchSubject', { name, address, date: ctx.dateLabel })
      : t('branchSubjectShort', { name, date: ctx.dateLabel });
  }
  const spaced = ctx.lockerCode.length >= 6
    ? `${ctx.lockerCode.slice(0, 3)} ${ctx.lockerCode.slice(3)}`
    : '';
  return spaced
    ? t('lockerSubjectCode', { code: spaced, date: ctx.dateLabel })
    : t('lockerSubjectTrack', { date: ctx.dateLabel, track: ctx.track });
}

export function buildWaitingFromYouEmail(order) {
  const ctx = orderContext(order);
  const t = ctx.t;
  let bodyHtml;
  let title;
  let preheader;

  if (ctx.pickupMode === 'home') {
    const fromPart = t('fromTime');
    const toPart = t('toTime');
    const dayLead = ctx.tomorrow ? t('tomorrow') : t('date');
    title = fromPart
      ? `${dayLead}, ${ctx.dateLabel} • ${fromPart} ${ctx.time.start} ${toPart} ${ctx.time.end}`
      : `${dayLead}, ${ctx.dateLabel} • ${ctx.time.start}${toPart}${ctx.time.end}`;
    preheader = t('courierPre');
    bodyHtml = buildCourierBody(ctx);
  } else if (ctx.pickupMode === 'branch') {
    title = ctx.pointName
      ? t('bringToBranchNamed', { name: ctx.pointName })
      : t('bringToBranch');
    preheader = t('branchPre');
    bodyHtml = buildBranchBody(ctx);
  } else {
    const code = ctx.lockerCode || '';
    const spaced = code.length >= 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : '';
    title = spaced
      ? t('cellCodeTitle', { code: spaced })
      : t('lockerDropTrack', { track: ctx.track });
    preheader = spaced
      ? t('lockerPreCode', { code: spaced, date: ctx.dateLabel })
      : t('lockerPreTrack', { date: ctx.dateLabel, track: ctx.track });
    bodyHtml = buildLockerBody(ctx);
  }

  const html = waitingShell({
    track: ctx.track,
    mode: ctx.pickupMode,
    preheader,
    title,
    bodyHtml,
    locale: ctx.locale,
  });

  return {
    html,
    subject: getWaitingFromYouSubject(order),
    title,
    preheader,
    mode: ctx.pickupMode,
    locale: ctx.locale,
  };
}
