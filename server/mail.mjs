import nodemailer from 'nodemailer';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outboxDir = path.join(__dirname, 'outbox');
const emailAssetDirs = [
  path.join(__dirname, '..', 'public', 'email'),
  path.join(__dirname, '..', 'dist', 'email'),
];

const BRAND = {
  lime: '#E1FF01',
  black: '#0B0B0B',
  ink: '#111111',
  muted: '#5C6570',
  soft: '#F3F4F0',
  line: '#E6E7E2',
  page: '#E8E9E4',
  white: '#FFFFFF',
};

/** Modern stack: Space Grotesk (display) + Plus Jakarta Sans (body). Fallbacks for Gmail/Outlook. */
const FONT = {
  display: "'Space Grotesk','Plus Jakarta Sans',Segoe UI,Helvetica Neue,Arial,sans-serif",
  body: "'Plus Jakarta Sans',Segoe UI,Helvetica Neue,Arial,sans-serif",
};

const STATUS_LABELS = {
  pending_payment: 'Ожидает оплаты',
  paid: 'Оплачено',
  submitted: 'Посылка в пути',
  cancelled: 'Отменён',
};

const HERO = {
  order: 'hero-boxes.png',
  welcome: 'hero-van.png',
  login: 'hero-container.png',
  status: 'hero-van-black.png',
  tracking: 'hero-van-black.png',
  security: 'hero-container.png',
};

let transporter = null;
let transporterPromise = null;
let transporterResolved = false;
const assetCache = new Map();

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production'
    || String(process.env.APP_URL || '').startsWith('https://');
}

function smtpPort() {
  return Number(process.env.SMTP_PORT || 587);
}

function smtpSecure(port = smtpPort()) {
  const raw = process.env.SMTP_SECURE;
  if (raw != null && String(raw).trim() !== '') {
    return raw === 'true' || raw === '1';
  }
  // GoDaddy / Secureserver: 465 = implicit TLS, 587 = STARTTLS
  return port === 465;
}

function resolveAssetPath(filename) {
  for (const dir of emailAssetDirs) {
    const full = path.join(dir, filename);
    if (existsSync(full)) return full;
  }
  return null;
}

/** Prefer hosted image URLs in production — CID attachments often fail/timeout on GoDaddy SMTP. */
function useCidImages() {
  if (process.env.MAIL_INLINE_IMAGES === 'true') return true;
  if (process.env.MAIL_INLINE_IMAGES === 'false') return false;
  return !isProductionRuntime();
}

function resendApiKey() {
  return String(process.env.RESEND_API_KEY || '').trim();
}

/**
 * Resend (HTTPS) is preferred when RESEND_API_KEY is set.
 * GoDaddy SMTP from Railway almost always fails with ETIMEDOUT on CONN.
 */
function preferResend() {
  const key = resendApiKey();
  if (!key) return false;
  const provider = String(process.env.EMAIL_PROVIDER || '').toLowerCase().trim();
  if (provider === 'smtp') return false;
  return true;
}

async function sendViaResend({ to, subject, html }) {
  const key = resendApiKey();
  const from = mailFrom();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.message || body?.error || JSON.stringify(body);
      throw new Error(`Resend ${res.status}: ${detail}`);
    }
    return { messageId: body?.id || null, preview: null, provider: 'resend' };
  } finally {
    clearTimeout(timer);
  }
}

async function getTransporter() {
  if (transporterResolved) return transporter;
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    // When Resend is active, skip SMTP init (avoids noisy verify timeouts on boot).
    if (preferResend()) {
      console.log('[mail] provider=resend (HTTPS) — SMTP skipped');
      transporter = null;
      return null;
    }

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const port = smtpPort();
      const secure = smtpSecure(port);
      const host = process.env.SMTP_HOST;
      transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: !secure && port === 587,
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 45_000,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          servername: host,
          minVersion: 'TLSv1.2',
        },
      });
      try {
        await Promise.race([
          transporter.verify(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('SMTP verify timed out')), 20_000);
          }),
        ]);
        console.log(`[mail] SMTP ready ${host}:${port} secure=${secure}`);
      } catch (err) {
        console.error(`[mail] SMTP verify FAILED (${host}:${port} secure=${secure}):`, err?.message || err);
        // Keep transporter — send may still work; verify is advisory for some hosts.
      }
      return transporter;
    }

    // Never block production checkout on Ethereal account creation
    if (isProductionRuntime() || process.env.MAIL_DISABLE === 'true') {
      console.warn('[mail] SMTP_* / RESEND_API_KEY not configured — emails are written to server/outbox only');
      transporter = null;
      return null;
    }

    const testAccount = await Promise.race([
      nodemailer.createTestAccount(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Ethereal createTestAccount timed out')), 8_000);
      }),
    ]);
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('[mail] Using Ethereal test SMTP. Set RESEND_API_KEY or SMTP_* for production.');
    return transporter;
  })()
    .then((value) => {
      transporter = value;
      transporterResolved = true;
      return value;
    })
    .catch((err) => {
      console.error('[mail] transporter init failed:', err?.message || err);
      transporter = null;
      transporterResolved = true;
      return null;
    })
    .finally(() => {
      transporterPromise = null;
    });

  return transporterPromise;
}

async function saveOutboxCopy(filename, html) {
  await mkdir(outboxDir, { recursive: true });
  await writeFile(path.join(outboxDir, filename), html, 'utf8');
}

function appUrl() {
  return String(process.env.APP_URL || 'http://localhost:5011').replace(/\/$/, '');
}

function assetBaseUrl() {
  return String(process.env.MAIL_ASSET_URL || process.env.APP_URL || 'http://localhost:5011').replace(/\/$/, '');
}

function assetUrl(filename) {
  return `${assetBaseUrl()}/email/${filename}`;
}

function mailFrom() {
  const raw = String(process.env.MAIL_FROM || '"MATE" <info@matedelivery.com>').trim();
  // Railway sometimes stores: "MATE" <addr>  or  MATE <addr>
  return raw || '"MATE" <info@matedelivery.com>';
}

function formatMoney(amount, currency = 'EUR') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function readAssetBuffer(filename) {
  if (assetCache.has(filename)) return assetCache.get(filename);
  const full = resolveAssetPath(filename);
  if (!full) return null;
  const buf = await readFile(full);
  assetCache.set(filename, buf);
  return buf;
}

function buildAttachments(heroFile) {
  if (!useCidImages()) return [];
  const files = [
    { filename: 'logo-mark.png', cid: 'mate-logo' },
    heroFile ? { filename: heroFile, cid: 'mate-hero' } : null,
  ].filter(Boolean);

  return files
    .map((file) => {
      const full = resolveAssetPath(file.filename);
      if (!full) return null;
      return {
        filename: file.filename,
        path: full,
        cid: file.cid,
        contentDisposition: 'inline',
      };
    })
    .filter(Boolean);
}

function logoImg(useCid) {
  const src = useCid ? 'cid:mate-logo' : assetUrl('logo-mark.png');
  return `<img src="${src}" width="48" height="48" alt="MATE" style="display:block;width:48px;height:48px;border:0;border-radius:50%;" />`;
}

function heroImg(heroFile, useCid) {
  if (!heroFile) return '';
  const src = useCid ? 'cid:mate-hero' : assetUrl(heroFile);
  return `
    <tr>
      <td style="padding:0;line-height:0;font-size:0;background:#F0F1EC;">
        <img src="${src}" width="600" alt="MATE logistics" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
      </td>
    </tr>`;
}

function statusBadge(label, tone = 'lime') {
  const styles = {
    lime: `background:${BRAND.lime};color:${BRAND.black};`,
    dark: `background:${BRAND.black};color:${BRAND.white};`,
    muted: `background:${BRAND.line};color:${BRAND.ink};`,
    danger: 'background:#FEE2E2;color:#991B1B;',
  };
  const style = styles[tone] || styles.lime;
  return `<span style="display:inline-block;padding:7px 14px;border-radius:999px;font-family:${FONT.body};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;${style}">${escapeHtml(label)}</span>`;
}

function ctaButton(href, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;">
      <tr>
        <td style="border-radius:12px;background:${BRAND.lime};box-shadow:0 8px 24px rgba(225,255,1,.35);">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:15px 28px;font-family:${FONT.display};font-size:15px;font-weight:700;letter-spacing:.01em;line-height:1;color:${BRAND.black};text-decoration:none;border-radius:12px;">
            ${escapeHtml(label)}&nbsp;&nbsp;→
          </a>
        </td>
      </tr>
    </table>`;
}

function detailRow(label, value, { last = false, strong = false } = {}) {
  const border = last ? 'none' : `1px solid ${BRAND.line}`;
  const valueHtml = strong
    ? `<strong style="color:${BRAND.ink};font-weight:700;font-family:${FONT.display};">${value}</strong>`
    : `<span style="font-family:${FONT.body};">${value}</span>`;
  return `
    <tr>
      <td style="padding:13px 0;border-bottom:${border};font-family:${FONT.body};font-size:13px;color:${BRAND.muted};width:38%;vertical-align:top;letter-spacing:.01em;">${escapeHtml(label)}</td>
      <td style="padding:13px 0;border-bottom:${border};font-family:${FONT.body};font-size:14px;color:${BRAND.ink};text-align:right;vertical-align:top;line-height:1.45;">${valueHtml}</td>
    </tr>`;
}

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

function orderRouteLine(order) {
  const p = order.payload || {};
  const tariff = p.tariff || {};
  const sender = p.sender || {};
  const receiver = p.receiver || {};
  const from = tariff.fromCountry || sender.country || '—';
  const to = tariff.toCountry || receiver.country || '—';
  return `${from} → ${to}`;
}

function orderSummaryBlock(order, extraRows = '') {
  const receiver = order.payload?.receiver || {};
  const receiverName = [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || '—';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 10px;background:${BRAND.soft};border-radius:16px;border:1px solid ${BRAND.line};">
      <tr>
        <td style="padding:4px 0 0;background:${BRAND.lime};border-radius:16px 16px 0 0;height:4px;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="padding:16px 20px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT.body};">
            ${detailRow('Номер заказа', escapeHtml(order.orderNumber), { strong: true })}
            ${detailRow('Маршрут', escapeHtml(orderRouteLine(order)))}
            ${detailRow('Получатель', escapeHtml(receiverName))}
            ${detailRow('Сумма', escapeHtml(formatMoney(order.amount, order.currency)), { strong: true, last: !order.npTtn && !extraRows })}
            ${order.npTtn ? detailRow('ТТН', escapeHtml(order.npTtn), { strong: true, last: !extraRows }) : ''}
            ${extraRows}
          </table>
        </td>
      </tr>
    </table>`;
}

function baseTemplate({
  title,
  preheader = '',
  eyebrow = '',
  badge = '',
  bodyHtml,
  hero = null,
  useCid = useCidImages(),
}) {
  const year = new Date().getFullYear();
  const site = appUrl();

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap');
    body, table, td, a, p, h1, h2, span, div { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  </style>
  <!--[if mso]>
  <style>
    body, table, td, a, p, h1 { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${BRAND.page};color:${BRAND.ink};font-family:${FONT.body};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${BRAND.white};border-radius:22px;overflow:hidden;border:1px solid ${BRAND.line};box-shadow:0 22px 48px rgba(11,11,11,.10);">
          <tr>
            <td style="background:${BRAND.black};padding:24px 28px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;width:56px;">
                    ${logoImg(useCid)}
                  </td>
                  <td style="vertical-align:middle;padding-left:14px;">
                    <div style="font-family:${FONT.display};font-size:28px;font-weight:700;letter-spacing:-.02em;color:${BRAND.white};line-height:1;">
                      MATE<span style="color:${BRAND.lime};">.</span>
                    </div>
                    <div style="font-family:${FONT.body};font-size:12px;font-weight:500;color:#A8ADB4;margin-top:5px;letter-spacing:.04em;">
                      Express logistics across Europe
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:5px;line-height:5px;font-size:0;background:linear-gradient(90deg,${BRAND.lime} 0%,#9BFF3D 55%,${BRAND.black} 100%);background-color:${BRAND.lime};">&nbsp;</td>
          </tr>
          ${heroImg(hero, useCid)}
          <tr>
            <td style="padding:34px 30px 10px;font-family:${FONT.body};">
              ${badge ? `<div style="margin-bottom:16px;">${badge}</div>` : ''}
              ${eyebrow ? `<div style="margin:0 0 10px;font-family:${FONT.body};font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${BRAND.muted};">${escapeHtml(eyebrow)}</div>` : ''}
              <h1 style="margin:0 0 6px;font-family:${FONT.display};font-size:30px;line-height:1.15;font-weight:700;letter-spacing:-.03em;color:${BRAND.ink};">${escapeHtml(title)}</h1>
              <div style="width:42px;height:3px;background:${BRAND.lime};border-radius:2px;margin:0 0 18px;font-size:0;line-height:0;">&nbsp;</div>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:10px 30px 30px;font-family:${FONT.body};">
              <p style="margin:0;font-size:14px;line-height:1.65;color:${BRAND.muted};font-weight:500;">
                С уважением,<br />
                <strong style="color:${BRAND.ink};font-family:${FONT.display};font-weight:700;">Команда MATE</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.black};padding:26px 30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${FONT.body};font-size:13px;line-height:1.55;color:#C8CCD2;font-weight:500;">
                    Delivery, Moving &amp; Storage Made Simple<br />
                    <a href="${escapeHtml(site)}" style="color:${BRAND.lime};text-decoration:none;font-weight:700;font-family:${FONT.display};letter-spacing:.01em;">matedelivery.com</a>
                  </td>
                  <td align="right" style="font-family:${FONT.body};font-size:12px;color:#8B9098;vertical-align:bottom;font-weight:500;">
                    © ${year} MATE
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-family:${FONT.body};font-size:11px;line-height:1.55;color:#8B9098;max-width:600px;font-weight:500;">
          Это автоматическое уведомление MATE. Если письмо пришло по ошибке — просто проигнорируйте его.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function deliver({ to, subject, html, outboxName, hero = null }) {
  if (!to) {
    console.warn(`[mail] skipped send (no recipient): ${subject}`);
    return { messageId: null, preview: null, skipped: true };
  }

  if (outboxName) {
    try {
      let outboxHtml = html;
      const logoBuf = await readAssetBuffer('logo-mark.png');
      if (logoBuf) {
        const logoData = `data:image/png;base64,${logoBuf.toString('base64')}`;
        outboxHtml = outboxHtml
          .replace(/cid:mate-logo/g, logoData)
          .replace(new RegExp(escapeRegExp(assetUrl('logo-mark.png')), 'g'), logoData);
      }
      if (hero) {
        const heroBuf = await readAssetBuffer(hero);
        if (heroBuf) {
          const heroData = `data:image/png;base64,${heroBuf.toString('base64')}`;
          outboxHtml = outboxHtml
            .replace(/cid:mate-hero/g, heroData)
            .replace(new RegExp(escapeRegExp(assetUrl(hero)), 'g'), heroData);
        }
      }
      await saveOutboxCopy(outboxName, outboxHtml);
    } catch (err) {
      console.error('[mail] outbox write failed:', err?.message || err);
    }
  }

  const transport = await getTransporter();
  if (preferResend()) {
    try {
      const result = await sendViaResend({ to, subject, html });
      console.log(`[mail] sent OK (resend) → ${to} | ${subject} | id=${result.messageId || 'n/a'}`);
      return result;
    } catch (err) {
      console.error(`[mail] send FAILED (resend) → ${to} | ${subject}:`, err?.message || err);
      throw err;
    }
  }

  if (!transport) {
    console.warn(`[mail] skipped send (no SMTP/Resend): ${subject} → ${to}`);
    return { messageId: null, preview: null, skipped: true };
  }

  const attachments = buildAttachments(hero);
  try {
    const info = await Promise.race([
      transport.sendMail({
        from: mailFrom(),
        to,
        subject,
        html,
        attachments: attachments.length ? attachments : undefined,
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('SMTP send timed out after 45s')), 45_000);
      }),
    ]);
    const preview = nodemailer.getTestMessageUrl(info);
    console.log(`[mail] sent OK (smtp) → ${to} | ${subject} | id=${info.messageId || 'n/a'}`);
    if (preview) console.log(`[mail] Preview (${subject}): ${preview}`);
    return { messageId: info.messageId, preview };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[mail] send FAILED (smtp) → ${to} | ${subject}:`, msg);
    if (/timeout|ETIMEDOUT|ECONNREFUSED|CONN/i.test(msg)) {
      console.error(
        '[mail] GoDaddy/SMTP is unreachable from Railway. '
        + 'Add RESEND_API_KEY + EMAIL_PROVIDER=resend in Railway Variables, '
        + 'verify matedelivery.com in Resend, set MAIL_FROM="MATE <info@matedelivery.com>". '
        + 'Mailbox on GoDaddy ≠ SMTP access from cloud hosts.',
      );
    }
    throw err;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function sendWelcomeEmail(user) {
  const hero = HERO.welcome;
  const html = baseTemplate({
    title: `Добро пожаловать, ${user.name}!`,
    preheader: 'Ваш аккаунт MATE создан — доставка по Европе стала проще.',
    eyebrow: 'Аккаунт создан',
    badge: statusBadge('Welcome', 'lime'),
    hero,
    bodyHtml: `
      <p style="margin:0 0 16px;font-family:${FONT.body};font-size:16px;line-height:1.65;font-weight:500;color:${BRAND.muted};">
        Ваш аккаунт MATE успешно создан. Считайте стоимость, оформляйте отправления и отслеживайте посылки в одном кабинете.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background:${BRAND.soft};border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT.body};">
              ${detailRow('Email', escapeHtml(user.email), { strong: true, last: true })}
            </table>
          </td>
        </tr>
      </table>
      ${ctaButton(appUrl(), 'Перейти в личный кабинет')}
    `,
  });

  return deliver({
    to: user.email,
    subject: 'Добро пожаловать в MATE — аккаунт создан',
    html,
    hero,
    outboxName: `welcome-${user.id}.html`,
  });
}

export async function sendLoginEmail(user, meta = {}) {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' });
  const ip = normalizeIp(meta.ip);
  const hero = HERO.login;
  const html = baseTemplate({
    title: 'Вход в ваш аккаунт',
    preheader: `Успешный вход в MATE — ${when}`,
    eyebrow: 'Безопасность',
    badge: statusBadge('Login', 'dark'),
    hero,
    bodyHtml: `
      <p style="margin:0 0 16px;font-family:${FONT.body};font-size:16px;line-height:1.65;font-weight:500;color:${BRAND.muted};">
        Здравствуйте, ${escapeHtml(user.name)}! Вы успешно вошли в личный кабинет MATE.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background:${BRAND.soft};border-radius:16px;border:1px solid ${BRAND.line};">
        <tr>
          <td style="padding:4px 0 0;background:${BRAND.lime};border-radius:16px 16px 0 0;height:4px;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:16px 20px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT.body};">
              ${detailRow('Время', escapeHtml(when), { strong: true, last: !ip })}
              ${ip ? detailRow('IP', escapeHtml(ip), { last: true }) : ''}
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 18px;font-family:${FONT.body};font-size:13px;line-height:1.6;font-weight:500;color:${BRAND.muted};">
        Если это были не вы — немедленно смените пароль в настройках аккаунта.
      </p>
      ${ctaButton(appUrl(), 'Открыть личный кабинет')}
    `,
  });

  return deliver({
    to: user.email,
    subject: 'Вход в аккаунт MATE',
    html,
    hero,
    outboxName: `login-${user.id}-${Date.now()}.html`,
  });
}

export async function sendPasswordChangedEmail(user) {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' });
  const hero = HERO.security;
  const html = baseTemplate({
    title: 'Пароль обновлён',
    preheader: 'Пароль вашего аккаунта MATE был изменён.',
    eyebrow: 'Безопасность',
    badge: statusBadge('Security', 'dark'),
    hero,
    bodyHtml: `
      <p style="margin:0 0 16px;font-family:${FONT.body};font-size:16px;line-height:1.65;font-weight:500;color:${BRAND.muted};">
        Здравствуйте, ${escapeHtml(user.name)}! Пароль вашего аккаунта MATE был успешно изменён.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background:${BRAND.soft};border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT.body};">
              ${detailRow('Время', escapeHtml(when), { strong: true, last: true })}
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 18px;font-family:${FONT.body};font-size:13px;line-height:1.6;font-weight:500;color:${BRAND.muted};">
        Если вы не меняли пароль — свяжитесь с поддержкой и смените пароль в настройках.
      </p>
      ${ctaButton(appUrl(), 'Открыть личный кабинет')}
    `,
  });

  return deliver({
    to: user.email,
    subject: 'Пароль аккаунта MATE изменён',
    html,
    hero,
    outboxName: `password-${user.id}-${Date.now()}.html`,
  });
}

export async function sendProfileUpdatedEmail(user) {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' });
  const hero = HERO.security;
  const html = baseTemplate({
    title: 'Данные профиля обновлены',
    preheader: 'В личном кабинете MATE изменены данные профиля.',
    eyebrow: 'Профиль',
    badge: statusBadge('Updated', 'muted'),
    hero,
    bodyHtml: `
      <p style="margin:0 0 16px;font-family:${FONT.body};font-size:16px;line-height:1.65;font-weight:500;color:${BRAND.muted};">
        Здравствуйте, ${escapeHtml(user.name)}! Ваши данные в личном кабинете MATE были изменены.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background:${BRAND.soft};border-radius:14px;">
        <tr>
          <td style="padding:18px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT.body};">
              ${detailRow('Email', escapeHtml(user.email), { strong: true })}
              ${detailRow('Телефон', escapeHtml(user.phone))}
              ${detailRow('Время', escapeHtml(when), { last: true })}
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-family:${FONT.body};font-size:13px;line-height:1.6;font-weight:500;color:${BRAND.muted};">
        Если это были не вы — свяжитесь с поддержкой.
      </p>
    `,
  });

  return deliver({
    to: user.email,
    subject: 'Профиль MATE обновлён',
    html,
    hero,
    outboxName: `profile-${user.id}-${Date.now()}.html`,
  });
}

export async function sendOrderCreatedEmail(order, meta = {}) {
  const payUrl = meta.checkoutUrl || appUrl();
  const payLabel = meta.checkoutUrl ? 'Оплатить заказ' : 'Перейти к оплате';
  const hero = HERO.order;
  const html = baseTemplate({
    title: 'Заказ создан',
    preheader: `Заказ ${order.orderNumber} оформлен и ожидает оплаты.`,
    eyebrow: 'Новое отправление',
    badge: statusBadge(STATUS_LABELS.pending_payment, 'lime'),
    hero,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:16px;line-height:1.65;font-weight:500;color:${BRAND.muted};">
        Ваш заказ на доставку успешно оформлен и ожидает оплаты. После оплаты мы сразу начнём обработку отправления.
      </p>
      ${orderSummaryBlock(
        order,
        detailRow('Статус', escapeHtml(STATUS_LABELS.pending_payment), { strong: true, last: true }),
      )}
      ${ctaButton(payUrl, payLabel)}
    `,
  });

  return deliver({
    to: order.customerEmail,
    subject: `MATE — заказ ${order.orderNumber} создан, ожидает оплаты`,
    html,
    hero,
    outboxName: `order-created-${order.id}.html`,
  });
}

export async function sendOrderStatusEmail(order, previousStatus) {
  const status = order.status;
  const prevLabel = STATUS_LABELS[previousStatus] || previousStatus;
  const nextLabel = STATUS_LABELS[status] || status;
  const hero = HERO.status;

  let title;
  let intro;
  let subject;
  let badgeTone = 'lime';

  if (status === 'paid') {
    title = 'Оплата получена';
    intro = 'Оплата вашего заказа успешно получена. Мы начинаем обработку отправления.';
    subject = `MATE — оплата по заказу ${order.orderNumber} получена`;
    badgeTone = 'lime';
  } else if (status === 'submitted') {
    if (previousStatus === 'pending_payment') {
      title = 'Оплата получена — посылка в пути';
      intro = 'Оплата прошла успешно. Ваше отправление принято и передано в доставку.';
      subject = `MATE — посылка ${order.orderNumber} в пути`;
    } else {
      title = 'Посылка в пути';
      intro = 'Ваше отправление принято перевозчиком и находится в пути.';
      subject = `MATE — посылка ${order.orderNumber} в пути`;
    }
    badgeTone = 'dark';
  } else if (status === 'cancelled') {
    title = 'Заказ отменён';
    intro = 'Ваш заказ был отменён. Если оплата уже проходила, мы свяжемся с вами по возврату.';
    subject = `MATE — заказ ${order.orderNumber} отменён`;
    badgeTone = 'danger';
  } else if (status === 'pending_payment') {
    title = 'Требуется оплата';
    intro = 'Статус заказа изменён: требуется оплата для продолжения отправки.';
    subject = `MATE — заказ ${order.orderNumber} ожидает оплаты`;
    badgeTone = 'lime';
  } else {
    title = 'Статус заказа изменён';
    intro = `Статус вашего заказа обновлён: ${prevLabel} → ${nextLabel}.`;
    subject = `MATE — статус заказа ${order.orderNumber} обновлён`;
    badgeTone = 'muted';
  }

  const html = baseTemplate({
    title,
    preheader: intro,
    eyebrow: 'Обновление заказа',
    badge: statusBadge(nextLabel, badgeTone),
    hero,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:16px;line-height:1.65;font-weight:500;color:${BRAND.muted};">
        ${escapeHtml(intro)}
      </p>
      ${orderSummaryBlock(
        order,
        detailRow('Статус', escapeHtml(nextLabel), { strong: true, last: true }),
      )}
      ${ctaButton(appUrl(), 'Отследить отправление')}
    `,
  });

  return deliver({
    to: order.customerEmail,
    subject,
    html,
    hero,
    outboxName: `order-status-${order.id}-${status}-${Date.now()}.html`,
  });
}

export async function sendOrderTrackingEmail(order) {
  const hero = HERO.tracking;
  const html = baseTemplate({
    title: 'Номер для отслеживания',
    preheader: `ТТН ${order.npTtn} для заказа ${order.orderNumber}`,
    eyebrow: 'Трекинг',
    badge: statusBadge('Tracking', 'lime'),
    hero,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:16px;line-height:1.65;font-weight:500;color:${BRAND.muted};">
        Для вашего отправления доступен номер отслеживания (ТТН). Используйте его, чтобы проверить статус доставки.
      </p>
      ${orderSummaryBlock(
        order,
        detailRow('Статус', escapeHtml(STATUS_LABELS[order.status] || order.status), { strong: true, last: true }),
      )}
      ${ctaButton(appUrl(), 'Отследить посылку')}
    `,
  });

  return deliver({
    to: order.customerEmail,
    subject: `MATE — трекинг ${order.orderNumber}: ${order.npTtn}`,
    html,
    hero,
    outboxName: `order-tracking-${order.id}-${Date.now()}.html`,
  });
}

/** Warm asset cache / validate brand files exist (optional startup check). */
export async function assertMailAssets() {
  const required = ['logo-mark.png', ...new Set(Object.values(HERO))];
  const missing = [];
  for (const file of required) {
    if (!(await readAssetBuffer(file))) missing.push(file);
  }
  if (missing.length) {
    console.warn(`[mail] missing email assets: ${missing.join(', ')}`);
  } else {
    console.log(`[mail] email assets OK (${emailAssetDirs.filter((d) => existsSync(d)).join(' | ') || 'none'})`);
  }
  return missing;
}

/** Probe mail provider from production (visible in Railway logs). */
export async function probeSmtp() {
  if (preferResend()) {
    return {
      ok: true,
      provider: 'resend',
      from: mailFrom(),
      note: 'HTTPS API — works from Railway (unlike GoDaddy SMTP)',
    };
  }
  const transport = await getTransporter();
  if (!transport) return { ok: false, error: 'Neither RESEND_API_KEY nor SMTP_* configured' };
  await transport.verify();
  return {
    ok: true,
    provider: 'smtp',
    host: process.env.SMTP_HOST,
    port: smtpPort(),
    secure: smtpSecure(),
    from: mailFrom(),
  };
}
