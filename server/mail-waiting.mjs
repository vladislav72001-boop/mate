/**
 * Pixel-close transactional emails for status waiting_from_you
 * Matching MATE mockups: courier / branch / postamat.
 */

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

function formatMoney(amount, currency = 'EUR') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  try {
    if (String(currency).toUpperCase() === 'HUF') {
      return `${Math.round(num).toLocaleString('hu-HU')} HUF`;
    }
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(num);
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

function locationLabel(location, fallback) {
  if (!location || typeof location !== 'object') return fallback || 'Уточняется';
  if (location.kind === 'address' && location.addressParts) {
    const p = location.addressParts;
    const line = [p.city, [p.street, p.building].filter(Boolean).join(' '), p.postCode]
      .filter(Boolean)
      .join(', ');
    return line || fallback || 'Уточняется';
  }
  return (
    location.address
    || location.addressLine
    || location.name
    || location.provider
    || fallback
    || 'Уточняется'
  );
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
  const fromPayload = String(order?.payload?.lockerCode || order?.payload?.cellCode || '').replace(/\D/g, '');
  if (fromPayload.length >= 6) return fromPayload.slice(0, 6);
  const digits = String(order?.npTtn || order?.orderNumber || order?.id || '')
    .replace(/\D/g, '');
  if (digits.length >= 6) return digits.slice(-6);
  let hash = 0;
  const seed = String(order?.id || order?.orderNumber || 'mate');
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1000000;
  }
  return String(418273 + (hash % 500000)).slice(0, 6);
}

function parsePickupTime(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
  if (m) return { start: m[1], end: m[2], label: `${m[1]}-${m[2]}` };
  return { start: '10:00', end: '11:30', label: text || '10:00-11:30' };
}

function formatRuDate(isoOrText) {
  const raw = String(isoOrText || '').trim();
  if (!raw) return 'дата уточняется';
  if (/[а-яА-Я]/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
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
  const dateLabel = formatRuDate(tariff.pickupDate);
  const tomorrow = isTomorrow(tariff.pickupDate);
  const senderName = sender.name || '—';
  const receiverName = [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || '—';
  const senderPhone = sender.phone || order?.senderPhone || '';
  const pickupAddress = locationLabel(pickupLocation, sender.line);
  const pointName = pickupLocation.provider
    || pickupLocation.name
    || (pickupMode === 'branch' ? 'Отделение MATE' : pickupMode === 'locker' ? 'Постамат' : '');
  const fromCity = cityFromCountry(tariff.fromCountry || sender.country || 'HU', sender.line);
  const toCity = cityFromCountry(tariff.toCountry || receiver.country || 'SK', receiver.destinationLine);
  const boxSize = parcel.boxSize || 'S';
  const weightKg = parcel.weightKg || 5;
  const contents = parcel.description || parcel.contents || 'Одежда';
  const declared = parcel.declaredValue != null ? `до €${parcel.declaredValue}` : 'до €100';
  const amount = formatMoney(order?.amount, order?.currency || 'HUF');
  const cardTail = String(payload.paymentLast4 || payload.cardLast4 || '2729').slice(-4);
  const lockerCode = lockerCodeFromOrder(order);
  const dash = `${appUrl()}/#/cabinet`;
  const mapsQuery = encodeURIComponent(pickupAddress);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
  const phoneHref = senderPhone ? `tel:${String(senderPhone).replace(/\s+/g, '')}` : dash;
  const pointPhone = pickupLocation.phone || '+421 2 445 15 12';

  return {
    order,
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
    fromCity,
    toCity,
    boxSize,
    weightKg,
    contents,
    declared,
    amount,
    cardTail,
    lockerCode,
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

function mapBlock({ pinLabel, distanceLabel, fromLabel = 'Вы здесь' }) {
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

function routeBlock(fromCity, toCity, eta = '2–3 рабочих дня') {
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
  const rows = [
    ['Получатель', ctx.receiverName],
    ['Содержимое', `${ctx.contents} — ${ctx.declared}`],
    ['Размер', `${ctx.boxSize} — до ${ctx.weightKg} кг`],
    ['Оплата', `карта •••• ${ctx.cardTail}`],
  ];
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${BRAND.black};border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:14px 16px 8px;font-family:${FONT.body};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#A1A1AA;font-weight:700;">
          Итого заказа
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
          <div style="margin-top:4px;font-family:${FONT.body};font-size:11px;color:#8B9098;">включая налоги и сборы</div>
        </td>
      </tr>
    </table>`;
}

function footerSupport() {
  return `
    <p style="margin:8px 0 0;font-family:${FONT.body};font-size:12px;line-height:1.55;color:${BRAND.muted};">
      Вопросы по доставке — ответьте на это письмо или напишите в чат в кабинете.<br />
      Поддержка: +421 95 580 0110 · <a href="mailto:help@matedelivery.com" style="color:${BRAND.muted};">help@matedelivery.com</a>
    </p>`;
}

function sectionTitle(num, text) {
  return `
    <div style="margin:4px 0 12px;font-family:${FONT.body};font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.ink};">
      ${num ? `<span style="color:${BRAND.muted};margin-right:6px;">${escapeHtml(String(num))}</span>` : ''}${escapeHtml(text)}
    </div>`;
}

function timelineBar(start, end) {
  // Approximate day timeline 08:00–20:00 → highlight window
  const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
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
          <div style="font-family:${FONT.body};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};font-weight:700;margin-bottom:8px;">Окно приезда</div>
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

function hoursBars() {
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
      ${row('Пн–Пт', 8, 50, '08:00–20:00')}
      ${row('Суббота', 16, 34, '10:00–18:00')}
      ${row('Вс', 0, 100, 'выходной', true)}
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
                  <div style="font-family:${FONT.body};font-size:12px;line-height:1.45;color:${BRAND.ink};">${escapeHtml(it.text)}</div>
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

function lockerIllustration(code) {
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
            <div style="margin-top:10px;font-family:${FONT.body};font-size:10px;color:#9CA3AF;text-align:center;">экран постамата</div>
          </div>
        </td>
        <td style="padding:16px 16px 16px 0;vertical-align:middle;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>${cells.slice(0, 4).join('')}</tr>
            <tr>${cells.slice(4, 8).join('')}</tr>
            <tr>${cells.slice(8, 12).join('')}</tr>
          </table>
          <div style="margin-top:8px;font-family:${FONT.body};font-size:11px;color:${BRAND.lime};font-weight:700;">↑ ваша ячейка</div>
        </td>
      </tr>
    </table>`;
}

function buildCourierBody(ctx) {
  const dayLead = ctx.tomorrow ? 'Завтра' : 'Дата';
  const headline = `${dayLead}, ${ctx.dateLabel} • с ${ctx.time.start} до ${ctx.time.end}`;
  return `
    <h1 style="margin:0 0 8px;font-family:${FONT.display};font-size:26px;line-height:1.2;font-weight:700;color:${BRAND.ink};letter-spacing:-.02em;">
      ${escapeHtml(headline)}
    </h1>
    <p style="margin:0 0 12px;font-family:${FONT.body};font-size:14px;line-height:1.55;color:${BRAND.muted};">
      Никуда идти не нужно. Курьер позвонит примерно за 30 минут до приезда.
    </p>
    ${timelineBar(ctx.time.start, ctx.time.end)}
    ${dualButtons(ctx.dash, 'Перенести на другой день', ctx.dash, 'Отменить забор', true)}

    ${mapBlock({ pinLabel: 'Заберём здесь', distanceLabel: '4 мин', fromLabel: 'Курьер' })}
    <div style="font-family:${FONT.display};font-size:18px;font-weight:700;color:${BRAND.ink};margin:0 0 4px;">${escapeHtml(ctx.pickupAddress)}</div>
    <div style="font-family:${FONT.body};font-size:13px;color:${BRAND.muted};margin:0 0 8px;line-height:1.5;">
      ${escapeHtml(ctx.senderName)}${ctx.senderPhone ? ` · ${escapeHtml(ctx.senderPhone)}` : ''}
    </div>
    <div style="margin:0 0 12px;">
      ${pill('Подъезд', 'gray')}${pill('Домофон', 'gray')}${pill('Курьеру нужно позвонить', 'lime')}
    </div>
    <div style="margin:0 0 22px;">${btnOutline(ctx.dash, 'Изменить адрес, этаж или контакт')}</div>

    ${sectionTitle(null, 'Что нужно от вас')}
    ${checklist3([
      { icon: '📦', text: 'Упаковать посылку. Можно в любую коробку или пакет — главное, чтобы была чистая.' },
      { icon: '🏷', text: 'Наклейку не печатать. Курьер приедет со своей и сам наклеит.' },
      { icon: '💳', text: `Курьеру не платить. Доставка уже оплачена картой ••••${ctx.cardTail}.` },
    ])}

    ${sectionTitle(null, 'Как пройдёт забор')}
    ${numberedSteps([
      'Курьер позвонит примерно за 30 минут до приезда.',
      'Вы передаёте посылку — он наклеит этикетку на месте.',
      'После выезда статус обновится на «Принято».',
    ])}

    ${barcodeBlock({ title: 'Трек-номер — назовите курьеру', track: ctx.track })}
    ${routeBlock(ctx.fromCity, ctx.toCity, '2–3 рабочих дня')}
    ${orderTotalCard(ctx)}
    <div style="margin:0 0 10px;">${btnPrimary(ctx.dash, 'Отследить посылку')}</div>
    <div style="margin:0 0 8px;">${btnOutline(ctx.dash, 'Накладная PDF')}</div>
    ${footerSupport()}
  `;
}

function buildBranchBody(ctx) {
  const branchTitle = ctx.pointName
    ? `Принесите посылку в ${ctx.pointName}`
    : 'Принесите посылку в отделение';
  return `
    <h1 style="margin:0 0 8px;font-family:${FONT.display};font-size:24px;line-height:1.2;font-weight:700;color:${BRAND.ink};letter-spacing:-.02em;">
      ${escapeHtml(branchTitle)}
    </h1>
    <p style="margin:0 0 14px;font-family:${FONT.body};font-size:14px;line-height:1.55;color:${BRAND.muted};">
      Кода здесь нет — назовите на кассе трек-номер, остальное сделает оператор.
    </p>

    ${mapBlock({ pinLabel: ctx.pointName || 'Отделение', distanceLabel: '1.2 км' })}
    <div style="font-family:${FONT.display};font-size:17px;font-weight:700;color:${BRAND.ink};margin:0 0 4px;">
      ${escapeHtml(ctx.pointName || 'Отделение MATE')} · ${escapeHtml(ctx.pickupAddress)}
    </div>
    <div style="font-family:${FONT.body};font-size:13px;color:${BRAND.muted};margin:0 0 8px;line-height:1.5;">
      ${escapeHtml(ctx.pointPhone)}
    </div>
    <div style="margin:0 0 12px;">
      ${pill('1.2 км · ~15 мин', 'gray')}${pill('Открыто до 20:00', 'lime')}${pill('Есть упаковка', 'gray')}
    </div>
    ${dualButtons(ctx.mapsUrl, 'Маршрут', `tel:${String(ctx.pointPhone).replace(/\s+/g, '')}`, 'Позвонить', true)}

    ${sectionTitle(2, 'Когда открыто')}
    ${hoursBars()}
    <p style="margin:0 0 18px;font-family:${FONT.body};font-size:13px;line-height:1.5;color:${BRAND.muted};">
      Сдать нужно до ${escapeHtml(ctx.dateLabel)}. Приходите в рабочие часы отделения.
    </p>

    ${sectionTitle(3, 'Возьмите с собой')}
    ${checklist3([
      { icon: '🪪', text: 'Паспорт или ID. Оригинал, копия или документ из госуслуг — требование таможни.' },
      { icon: '☰', text: 'Трек-номер. Покажите на экране или назовите его оператору на кассе.' },
      { icon: '📦', text: 'Посылку. Упаковка любая; в отделении помогут упаковать и взвесить.' },
    ])}

    ${barcodeBlock({ title: 'Трек-номер · назовите на кассе', track: ctx.track })}
    ${routeBlock(ctx.fromCity, ctx.toCity, '4–6 рабочих дней')}
    ${orderTotalCard(ctx)}
    <div style="margin:0 0 10px;">${btnPrimary(ctx.dash, 'Отследить посылку')}</div>
    ${dualButtons(ctx.dash, 'Накладная PDF', ctx.dash, 'Сменить отделение', false)}
    ${footerSupport()}
  `;
}

function buildLockerBody(ctx) {
  const spaced = `${ctx.lockerCode.slice(0, 3)} ${ctx.lockerCode.slice(3)}`;
  return `
    <h1 style="margin:0 0 10px;font-family:${FONT.display};font-size:26px;line-height:1.2;font-weight:700;color:${BRAND.ink};letter-spacing:-.02em;">
      Код для ячейки — ${escapeHtml(spaced)}
    </h1>
    <p style="margin:0 0 12px;font-family:${FONT.body};font-size:14px;line-height:1.55;color:${BRAND.muted};">
      Введите этот код на экране постамата, чтобы открыть ячейку.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${BRAND.black};border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:16px 16px 8px;font-family:${FONT.body};font-size:12px;color:#C8CCD2;text-align:center;">
          Код активен — сдайте посылку до ${escapeHtml(ctx.dateLabel)}${ctx.time.label ? `, ${escapeHtml(ctx.time.end)}` : ''}
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:4px 8px 8px;">
          ${lockerCodeDigits(ctx.lockerCode)}
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 16px;font-family:${FONT.body};font-size:11px;color:#9CA3AF;text-align:center;">
          Хранение ограничено · после срока ячейка освободится
        </td>
      </tr>
    </table>

    ${mapBlock({ pinLabel: ctx.pointName || 'Постамат', distanceLabel: '250 м' })}
    <div style="font-family:${FONT.display};font-size:17px;font-weight:700;color:${BRAND.ink};margin:0 0 4px;">
      ${escapeHtml(ctx.pointName || 'Постамат')} · ${escapeHtml(ctx.pickupAddress)}
    </div>
    <div style="margin:0 0 12px;">
      ${pill('24/7', 'lime')}${pill('Рядом', 'lime')}${pill('Легко найти', 'lime')}
    </div>
    <div style="margin:0 0 18px;">${btnPrimary(ctx.mapsUrl, 'Открыть маршрут в картах')}</div>

    ${lockerIllustration(ctx.lockerCode)}
    <p style="margin:0 0 12px;font-family:${FONT.body};font-size:13px;line-height:1.5;color:${BRAND.muted};">
      Введите код на экране — откроется ячейка размера ${escapeHtml(ctx.boxSize)} в нижнем ряду.
    </p>
    ${numberedSteps([
      'На экране нажмите «Сдать посылку».',
      `Введите код ${spaced} или поднесите QR-код из письма к сканеру.`,
      'Положите посылку в ячейку и закройте дверцу до щелчка.',
      'Через ~15 минут в кабинете обновится статус.',
    ])}

    ${barcodeBlock({ title: 'Трек-номер (ТТН)', track: ctx.track })}
    ${routeBlock(ctx.fromCity, ctx.toCity, '1–2 рабочих дня')}
    ${orderTotalCard(ctx)}
    <div style="margin:0 0 10px;">${btnPrimary(ctx.dash, 'Отследить посылку')}</div>
    ${dualButtons(ctx.dash, 'Накладная PDF', ctx.dash, 'Изменить или отменить', false)}
    ${footerSupport()}
  `;
}

function methodBanner(mode) {
  if (mode === 'home') {
    return { icon: '🚚', text: 'Способ сдачи: Курьер заберёт с адреса' };
  }
  if (mode === 'branch') {
    return { icon: '🏪', text: 'Способ сдачи: Отделение · помогут упаковать и взвесить' };
  }
  return { icon: '▣', text: 'Способ сдачи: Постамат · круглосуточно, без очереди' };
}

function waitingShell({ track, mode, preheader, title, bodyHtml }) {
  const banner = methodBanner(mode);
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="ru">
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
                    ТРЕК: ${escapeHtml(track)}
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
  if (ctx.pickupMode === 'home') {
    return `Курьер приедет ${ctx.tomorrow ? 'завтра' : ctx.dateLabel}, с ${ctx.time.start} до ${ctx.time.end}`;
  }
  if (ctx.pickupMode === 'branch') {
    return `${ctx.pointName || 'Отделение'} — принесите посылку до ${ctx.dateLabel}`;
  }
  const spaced = `${ctx.lockerCode.slice(0, 3)} ${ctx.lockerCode.slice(3)}`;
  return `Код ${spaced} — сдайте посылку в постамат до ${ctx.dateLabel}`;
}

export function buildWaitingFromYouEmail(order) {
  const ctx = orderContext(order);
  let bodyHtml;
  let title;
  let preheader;

  if (ctx.pickupMode === 'home') {
    title = `Завтра, ${ctx.dateLabel} • с ${ctx.time.start} до ${ctx.time.end}`;
    preheader = 'Курьер заберёт посылку с адреса. Никуда идти не нужно.';
    bodyHtml = buildCourierBody(ctx);
  } else if (ctx.pickupMode === 'branch') {
    title = `Принесите посылку в ${ctx.pointName || 'отделение'}`;
    preheader = 'Назовите на кассе трек-номер — оператор сделает остальное.';
    bodyHtml = buildBranchBody(ctx);
  } else {
    const spaced = `${ctx.lockerCode.slice(0, 3)} ${ctx.lockerCode.slice(3)}`;
    title = `Код для ячейки — ${spaced}`;
    preheader = `Код ${spaced}. Сдайте посылку в постамат до ${ctx.dateLabel}.`;
    bodyHtml = buildLockerBody(ctx);
  }

  const html = waitingShell({
    track: ctx.track,
    mode: ctx.pickupMode,
    preheader,
    title,
    bodyHtml,
  });

  return {
    html,
    subject: getWaitingFromYouSubject(order),
    title,
    preheader,
    mode: ctx.pickupMode,
  };
}
