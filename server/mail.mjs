import nodemailer from 'nodemailer';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWaitingFromYouEmail } from './mail-waiting.mjs';
import {
  localeFromOrder,
  mailT,
  statusLabel,
  intlLocale,
  normalizeMailLocale,
} from './mail-i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outboxDir = path.join(__dirname, 'outbox');
const emailAssetDirs = [
  path.join(__dirname, '..', 'public', 'email'),
  path.join(__dirname, '..', 'dist', 'email'),
];

const BRAND = {
  lime: '#D2E84D',
  black: '#0B0B0B',
  ink: '#111111',
  muted: '#6B7280',
  soft: '#F4F5F1',
  line: '#E5E7EB',
  page: '#EDEEE9',
  white: '#FFFFFF',
};

/** Modern stack: Space Grotesk (display) + Plus Jakarta Sans (body). Fallbacks for Gmail/Outlook. */
const FONT = {
  display: "'Space Grotesk','Plus Jakarta Sans',Segoe UI,Helvetica Neue,Arial,sans-serif",
  body: "'Plus Jakarta Sans',Segoe UI,Helvetica Neue,Arial,sans-serif",
};

/** Kept for asset checks / legacy CID; templates no longer embed hero photos. */
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

function formatMoney(amount, currency = 'EUR', locale = 'ru') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(num);
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

function buildAttachments() {
  if (!useCidImages()) return [];
  const full = resolveAssetPath('logo-mark.png');
  if (!full) return [];
  return [{
    filename: 'logo-mark.png',
    path: full,
    cid: 'mate-logo',
    contentDisposition: 'inline',
  }];
}

function ctaButton(href, label) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 8px;">
      <tr>
        <td>
          <a href="${escapeHtml(href)}" style="display:block;padding:14px 16px;background:${BRAND.lime};color:${BRAND.black};text-decoration:none;border-radius:12px;font-family:${FONT.display};font-size:15px;font-weight:700;text-align:center;line-height:1.2;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function detailRow(label, value, { last = false, strong = false, dark = false } = {}) {
  const border = last ? 'none' : `1px solid ${dark ? '#2A2A2A' : BRAND.line}`;
  const labelColor = dark ? '#A1A1AA' : BRAND.muted;
  const valueColor = dark ? BRAND.white : BRAND.ink;
  const valueHtml = strong
    ? `<strong style="color:${valueColor};font-weight:700;font-family:${FONT.display};">${value}</strong>`
    : `<span style="font-family:${FONT.body};color:${valueColor};">${value}</span>`;
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:${border};font-family:${FONT.body};font-size:13px;color:${labelColor};width:40%;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:12px 0;border-bottom:${border};font-family:${FONT.body};font-size:14px;text-align:right;vertical-align:top;line-height:1.45;">${valueHtml}</td>
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

function orderSummaryBlock(order, extraRows = '', locale = 'ru') {
  const receiver = order.payload?.receiver || {};
  const receiverName = [receiver.firstName, receiver.lastName].filter(Boolean).join(' ') || '—';
  const t = (key, vars) => mailT(locale, key, vars);
  const amount = formatMoney(order.amount, order.currency, locale);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 12px;background:${BRAND.black};border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:4px 16px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${detailRow(t('orderNumber'), escapeHtml(order.orderNumber), { strong: true, dark: true })}
            ${detailRow(t('route'), escapeHtml(orderRouteLine(order)), { dark: true })}
            ${detailRow(t('recipient'), escapeHtml(receiverName), { dark: true })}
            ${order.npTtn ? detailRow(t('ttn'), escapeHtml(order.npTtn), { strong: true, dark: true }) : ''}
            ${extraRows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 16px 16px;">
          <div style="font-family:${FONT.body};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8B9098;margin-bottom:4px;">${escapeHtml(t('amount'))}</div>
          <div style="font-family:${FONT.display};font-size:28px;font-weight:700;color:${BRAND.lime};line-height:1;">${escapeHtml(amount)}</div>
        </td>
      </tr>
    </table>`;
}

function baseTemplate({
  title,
  preheader = '',
  eyebrow = '',
  badge = '',
  banner = '',
  headerRight = '',
  bodyHtml,
  hero = null,
  locale = 'ru',
}) {
  void hero;
  void badge;
  const year = new Date().getFullYear();
  const site = appUrl();
  const t = (key, vars) => mailT(locale, key, vars);
  const bannerText = banner || eyebrow || '';

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
                    ${escapeHtml(headerRight || '')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${bannerText ? `
          <tr>
            <td data-mate-banner="1" style="background:${BRAND.lime};padding:12px 22px;font-family:${FONT.body};font-size:13px;font-weight:700;color:${BRAND.black};letter-spacing:.02em;text-transform:uppercase;">
              ${escapeHtml(bannerText)}
            </td>
          </tr>` : ''}
          <tr>
            <td style="padding:26px 22px 10px;font-family:${FONT.body};">
              <h1 style="margin:0 0 10px;font-family:${FONT.display};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-.02em;color:${BRAND.ink};">${escapeHtml(title)}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 22px 22px;font-family:${FONT.body};font-size:12px;line-height:1.55;color:${BRAND.muted};">
              ${escapeHtml(t('regards'))}<br />
              <strong style="color:${BRAND.ink};font-family:${FONT.display};">${escapeHtml(t('teamMate'))}</strong>
              <div style="margin-top:14px;font-size:11px;color:#9CA3AF;">© ${year} MATE · <a href="${escapeHtml(site)}" style="color:#9CA3AF;text-decoration:none;">matedelivery.com</a></div>
              <div style="margin-top:8px;font-size:11px;color:#9CA3AF;">${escapeHtml(t('autoNotice'))}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function receiverEmailFromOrder(order) {
  return String(order?.payload?.receiver?.email || '').trim().toLowerCase();
}

function orderMailParties(order) {
  const sender = String(order?.customerEmail || '').trim().toLowerCase();
  const receiver = receiverEmailFromOrder(order);
  const parties = [];
  if (sender) parties.push({ email: sender, role: 'sender' });
  if (receiver && receiver !== sender) parties.push({ email: receiver, role: 'recipient' });
  return parties;
}

function recipientNoticeHtml(locale) {
  const t = (key) => mailT(locale, key);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
      <tr>
        <td style="padding:12px 14px;background:${BRAND.lime};border-radius:12px;">
          <div style="font-family:${FONT.display};font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${BRAND.black};">
            ${escapeHtml(t('forRecipientBanner'))}
          </div>
          <div style="margin-top:4px;font-family:${FONT.body};font-size:13px;line-height:1.45;color:${BRAND.black};">
            ${escapeHtml(t('forRecipientNote'))}
          </div>
        </td>
      </tr>
    </table>`;
}

function markHtmlForRecipient(html, locale) {
  const notice = recipientNoticeHtml(locale);
  if (/<\/h1>/i.test(html)) {
    return html.replace(/<\/h1>/i, `</h1>${notice}`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${notice}`);
  }
  return `${notice}${html}`;
}

function softInfoCard(rowsHtml) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 18px;background:${BRAND.soft};border-radius:14px;border:1px solid ${BRAND.line};">
      <tr>
        <td style="padding:4px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rowsHtml}
          </table>
        </td>
      </tr>
    </table>`;
}

/** Send the same order email to sender and (if different) to receiver, labeled as recipient. */
async function deliverOrderMail({
  order,
  subject,
  html,
  hero = null,
  outboxName,
  skipRecipient = false,
  recipientHtml = null,
  recipientSubject = null,
}) {
  const locale = localeFromOrder(order);
  const parties = orderMailParties(order);
  if (!parties.length) {
    console.warn(`[mail] skipped send (no parties): ${subject}`);
    return { messageId: null, preview: null, skipped: true };
  }

  let last = null;
  for (const party of parties) {
    if (skipRecipient && party.role === 'recipient') continue;
    const isRecipient = party.role === 'recipient';
    const partySubject = isRecipient
      ? (recipientSubject || mailT(locale, 'forRecipientSubject', { subject }))
      : subject;
    const baseHtml = isRecipient && recipientHtml ? recipientHtml : html;
    const partyHtml = isRecipient ? markHtmlForRecipient(baseHtml, locale) : baseHtml;
    const partyOutbox = isRecipient && outboxName
      ? outboxName.replace(/\.html$/i, '-recipient.html')
      : outboxName;
    last = await deliver({
      to: party.email,
      subject: partySubject,
      html: partyHtml,
      hero,
      outboxName: partyOutbox,
    });
  }
  return last;
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

  const attachments = buildAttachments();
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

export async function sendWelcomeEmail(user, meta = {}) {
  const locale = normalizeMailLocale(meta.locale || user?.locale);
  const t = (key, vars) => mailT(locale, key, vars);
  const html = baseTemplate({
    title: t('welcomeTitle', { name: user.name }),
    preheader: t('welcomePre'),
    banner: t('welcomeEyebrow'),
    locale,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(t('welcomeBody'))}
      </p>
      ${softInfoCard(detailRow('Email', escapeHtml(user.email), { strong: true, last: true }))}
      ${ctaButton(appUrl(), t('welcomeCta'))}
    `,
  });

  return deliver({
    to: user.email,
    subject: t('welcomeSubject'),
    html,
    outboxName: `welcome-${user.id}.html`,
  });
}

export async function sendLoginEmail(user, meta = {}) {
  const locale = normalizeMailLocale(meta.locale || user?.locale);
  const t = (key, vars) => mailT(locale, key, vars);
  const when = new Date().toLocaleString(intlLocale(locale), { timeZone: 'Europe/Berlin' });
  const ip = normalizeIp(meta.ip);
  const html = baseTemplate({
    title: t('loginTitle'),
    preheader: t('loginPre', { when }),
    banner: t('loginEyebrow'),
    locale,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(t('loginBody', { name: user.name }))}
      </p>
      ${softInfoCard(`
        ${detailRow(t('loginTime'), escapeHtml(when), { strong: true, last: !ip })}
        ${ip ? detailRow(t('loginIp'), escapeHtml(ip), { last: true }) : ''}
      `)}
      <p style="margin:0 0 14px;font-family:${FONT.body};font-size:13px;line-height:1.6;color:${BRAND.muted};">
        ${escapeHtml(t('loginWarn'))}
      </p>
      ${ctaButton(appUrl(), t('loginCta'))}
    `,
  });

  return deliver({
    to: user.email,
    subject: t('loginSubject'),
    html,
    outboxName: `login-${user.id}-${Date.now()}.html`,
  });
}

export async function sendPasswordChangedEmail(user, meta = {}) {
  const locale = normalizeMailLocale(meta.locale || user?.locale);
  const t = (key, vars) => mailT(locale, key, vars);
  const when = new Date().toLocaleString(intlLocale(locale), { timeZone: 'Europe/Berlin' });
  const html = baseTemplate({
    title: t('passwordTitle'),
    preheader: t('passwordPre'),
    banner: t('securityEyebrow'),
    locale,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(t('passwordBody', { name: user.name }))}
      </p>
      ${softInfoCard(detailRow(t('loginTime'), escapeHtml(when), { strong: true, last: true }))}
      <p style="margin:0 0 14px;font-family:${FONT.body};font-size:13px;line-height:1.6;color:${BRAND.muted};">
        ${escapeHtml(t('passwordWarn'))}
      </p>
      ${ctaButton(appUrl(), t('passwordCta'))}
    `,
  });

  return deliver({
    to: user.email,
    subject: t('passwordSubject'),
    html,
    outboxName: `password-${user.id}-${Date.now()}.html`,
  });
}

export async function sendPasswordResetEmail(user, resetUrl, meta = {}) {
  const locale = normalizeMailLocale(meta.locale || user?.locale);
  const t = (key, vars) => mailT(locale, key, vars);
  const html = baseTemplate({
    title: t('resetTitle'),
    preheader: t('resetPre'),
    banner: t('securityEyebrow'),
    locale,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(t('resetBody', { name: user.name }))}
      </p>
      <p style="margin:0 0 14px;font-family:${FONT.body};font-size:13px;line-height:1.6;color:${BRAND.muted};">
        ${escapeHtml(t('resetWarn'))}
      </p>
      ${ctaButton(resetUrl, t('resetCta'))}
    `,
  });

  return deliver({
    to: user.email,
    subject: t('resetSubject'),
    html,
    outboxName: `password-reset-${user.id}-${Date.now()}.html`,
  });
}

export async function sendProfileUpdatedEmail(user, meta = {}) {
  const locale = normalizeMailLocale(meta.locale || user?.locale);
  const t = (key, vars) => mailT(locale, key, vars);
  const when = new Date().toLocaleString(intlLocale(locale), { timeZone: 'Europe/Berlin' });
  const html = baseTemplate({
    title: t('profileTitle'),
    preheader: t('profilePre'),
    banner: t('profileEyebrow'),
    locale,
    bodyHtml: `
      <p style="margin:0 0 8px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(t('profileBody', { name: user.name }))}
      </p>
      ${softInfoCard(`
        ${detailRow('Email', escapeHtml(user.email), { strong: true })}
        ${detailRow(t('profilePhone'), escapeHtml(user.phone))}
        ${detailRow(t('loginTime'), escapeHtml(when), { last: true })}
      `)}
      <p style="margin:0;font-family:${FONT.body};font-size:13px;line-height:1.6;color:${BRAND.muted};">
        ${escapeHtml(t('profileWarn'))}
      </p>
    `,
  });

  return deliver({
    to: user.email,
    subject: t('profileSubject'),
    html,
    outboxName: `profile-${user.id}-${Date.now()}.html`,
  });
}

export async function sendOrderCreatedEmail(order, meta = {}) {
  const locale = localeFromOrder(order);
  const t = (key, vars) => mailT(locale, key, vars);
  const payer = String(order?.payload?.tariff?.payer || meta.payer || 'sender').toLowerCase();
  const recipientPays = payer === 'receiver' || payer === 'recipient';
  // Durable app link — Stripe session URLs expire; /?pay=token creates a fresh session.
  const payUrl = meta.payUrl
    || (order?.publicToken ? `${appUrl()}/?pay=${encodeURIComponent(order.publicToken)}` : null)
    || meta.checkoutUrl
    || appUrl();
  const pending = statusLabel(locale, 'pending_payment');
  const summary = orderSummaryBlock(
    order,
    detailRow(t('status'), escapeHtml(pending), { strong: true, last: true, dark: true }),
    locale,
  );

  let html;
  let recipientHtml;
  let subject;
  let recipientSubject;

  if (recipientPays) {
    html = baseTemplate({
      title: t('orderCreatedTitle'),
      preheader: t('orderCreatedPreSenderAwaitingRecipient', { orderNumber: order.orderNumber }),
      banner: t('newShipment'),
      headerRight: order.orderNumber,
      locale,
      bodyHtml: `
        <p style="margin:0 0 4px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
          ${escapeHtml(t('orderCreatedBodySenderAwaitingRecipient', {
            email: receiverEmailFromOrder(order) || '—',
          }))}
        </p>
        ${summary}
        ${ctaButton(appUrl(), t('welcomeCta'))}
      `,
    });
    recipientHtml = baseTemplate({
      title: t('orderCreatedTitleRecipientPay'),
      preheader: t('orderCreatedPreRecipientPay', { orderNumber: order.orderNumber }),
      banner: t('newShipment'),
      headerRight: order.orderNumber,
      locale,
      bodyHtml: `
        <p style="margin:0 0 4px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
          ${escapeHtml(t('orderCreatedBodyRecipientPay'))}
        </p>
        ${summary}
        ${ctaButton(payUrl, t('payOrder'))}
      `,
    });
    subject = t('orderCreatedSubjectSenderAwaitingRecipient', { orderNumber: order.orderNumber });
    recipientSubject = t('orderCreatedSubjectRecipientPay', { orderNumber: order.orderNumber });
  } else {
    html = baseTemplate({
      title: t('orderCreatedTitle'),
      preheader: t('orderCreatedPre', { orderNumber: order.orderNumber }),
      banner: t('newShipment'),
      headerRight: order.orderNumber,
      locale,
      bodyHtml: `
        <p style="margin:0 0 4px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
          ${escapeHtml(t('orderCreatedBody'))}
        </p>
        ${summary}
        ${ctaButton(payUrl, t('payOrder'))}
      `,
    });
    recipientHtml = baseTemplate({
      title: t('orderCreatedTitleRecipient'),
      preheader: t('orderCreatedPreRecipient', { orderNumber: order.orderNumber }),
      banner: t('newShipment'),
      headerRight: order.orderNumber,
      locale,
      bodyHtml: `
        <p style="margin:0 0 4px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
          ${escapeHtml(t('orderCreatedBodyRecipient'))}
        </p>
        ${summary}
        ${ctaButton(appUrl(), t('trackShipment'))}
      `,
    });
    subject = t('orderCreatedSubject', { orderNumber: order.orderNumber });
    recipientSubject = t('orderCreatedSubjectRecipient', { orderNumber: order.orderNumber });
  }

  return deliverOrderMail({
    order,
    subject,
    html,
    recipientHtml,
    recipientSubject,
    outboxName: `order-created-${order.id}.html`,
  });
}

export async function sendOrderStatusEmail(order, previousStatus) {
  const status = order.status;

  if (status === 'waiting_from_you') {
    const built = buildWaitingFromYouEmail(order);
    // Drop-off instructions are for the sender only.
    return deliverOrderMail({
      order,
      subject: built.subject,
      html: built.html,
      hero: null,
      outboxName: `order-status-${order.id}-${status}-${built.mode}-${Date.now()}.html`,
      skipRecipient: true,
    });
  }

  const locale = localeFromOrder(order);
  const t = (key, vars) => mailT(locale, key, vars);
  const prevLabel = statusLabel(locale, previousStatus) || previousStatus;
  const nextLabel = statusLabel(locale, status) || status;

  let title;
  let intro;
  let subject;

  if (status === 'paid') {
    title = t('paidTitle');
    intro = t('paidIntro');
    subject = t('paidSubject', { orderNumber: order.orderNumber });
  } else if (status === 'submitted') {
    title = t('submittedTitle');
    intro = t('submittedIntro');
    subject = t('submittedSubject', { orderNumber: order.orderNumber });
  } else if (status === 'delivered') {
    title = t('deliveredTitle');
    intro = t('deliveredIntro');
    subject = t('deliveredSubject', { orderNumber: order.orderNumber });
  } else if (status === 'cancelled') {
    title = t('cancelledTitle');
    intro = t('cancelledIntro');
    subject = t('cancelledSubject', { orderNumber: order.orderNumber });
  } else if (status === 'pending_payment') {
    title = t('pendingTitle');
    intro = t('pendingIntro');
    subject = t('pendingSubject', { orderNumber: order.orderNumber });
  } else {
    title = t('statusChangedTitle');
    intro = t('statusChangedIntro', { prev: prevLabel, next: nextLabel });
    subject = t('statusChangedSubject', { orderNumber: order.orderNumber });
  }

  const html = baseTemplate({
    title,
    preheader: intro,
    banner: nextLabel,
    headerRight: order.orderNumber,
    locale,
    bodyHtml: `
      <p style="margin:0 0 4px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(intro)}
      </p>
      ${orderSummaryBlock(
        order,
        detailRow(t('status'), escapeHtml(nextLabel), { strong: true, last: true, dark: true }),
        locale,
      )}
      ${ctaButton(appUrl(), t('trackShipment'))}
    `,
  });

  return deliverOrderMail({
    order,
    subject,
    html,
    outboxName: `order-status-${order.id}-${status}-${Date.now()}.html`,
  });
}

export async function sendOrderTrackingEmail(order) {
  const locale = localeFromOrder(order);
  const t = (key, vars) => mailT(locale, key, vars);
  const html = baseTemplate({
    title: t('trackingTitle'),
    preheader: t('trackingPre', { ttn: order.npTtn, orderNumber: order.orderNumber }),
    banner: t('trackingEyebrow'),
    headerRight: order.npTtn || order.orderNumber,
    locale,
    bodyHtml: `
      <p style="margin:0 0 4px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(t('trackingBody'))}
      </p>
      ${orderSummaryBlock(
        order,
        detailRow(t('status'), escapeHtml(statusLabel(locale, order.status) || order.status), { strong: true, last: true, dark: true }),
        locale,
      )}
      ${ctaButton(appUrl(), t('trackParcel'))}
    `,
  });

  return deliverOrderMail({
    order,
    subject: t('trackingSubject', { orderNumber: order.orderNumber, ttn: order.npTtn }),
    html,
    outboxName: `order-tracking-${order.id}-${Date.now()}.html`,
  });
}

function deliveryPointContext(order) {
  const tariff = order?.payload?.tariff || {};
  const receiver = order?.payload?.receiver || {};
  const loc = tariff.deliveryLocation || {};
  const mode = String(tariff.deliveryMode || tariff.deliveryType || 'locker').toLowerCase();
  const placeTypeKey = mode === 'pudo'
    ? 'arrivedPlacePudo'
    : mode === 'branch'
      ? 'arrivedPlaceBranch'
      : 'arrivedPlaceLocker';
  const name = String(loc.name || loc.provider || '').trim();
  const address = String(loc.address || receiver.destinationLine || '').trim();
  return { mode, placeTypeKey, name, address };
}

/** Parcel waiting at Postomat / PUDO / branch — no PIN (NP sends that separately). */
export async function sendArrivedAtPointEmail(order) {
  const locale = localeFromOrder(order);
  const t = (key, vars) => mailT(locale, key, vars);
  const { placeTypeKey, name, address } = deliveryPointContext(order);
  const placeType = t(placeTypeKey);
  const ttn = String(order.npTtn || '').trim() || '—';
  const placeLine = [name, address].filter(Boolean).join(' · ') || placeType;

  const extraRows = [
    detailRow(t('arrivedPlaceLabel'), escapeHtml(placeType), { strong: true, dark: true }),
    name ? detailRow(t('arrivedPointName'), escapeHtml(name), { dark: true }) : '',
    address
      ? detailRow(t('arrivedAddress'), escapeHtml(address), { last: true, dark: true })
      : detailRow(t('status'), escapeHtml(t('arrivedBanner')), { strong: true, last: true, dark: true }),
  ].join('');

  const html = baseTemplate({
    title: t('arrivedTitle', { place: placeType }),
    preheader: t('arrivedPre', { place: placeType, ttn, orderNumber: order.orderNumber }),
    banner: t('arrivedBanner'),
    headerRight: order.npTtn || order.orderNumber,
    locale,
    bodyHtml: `
      <p style="margin:0 0 4px;font-family:${FONT.body};font-size:15px;line-height:1.65;color:${BRAND.muted};">
        ${escapeHtml(t('arrivedIntro', { place: placeType }))}
      </p>
      <p style="margin:10px 0 4px;font-family:${FONT.body};font-size:14px;line-height:1.6;color:${BRAND.muted};">
        ${escapeHtml(t('arrivedCodeNote'))}
      </p>
      ${orderSummaryBlock(order, extraRows, locale)}
      <p style="margin:0 0 14px;font-family:${FONT.body};font-size:13px;line-height:1.55;color:${BRAND.muted};">
        ${escapeHtml(t('arrivedPickupHint', { place: placeLine }))}
      </p>
      ${ctaButton(appUrl(), t('trackParcel'))}
    `,
  });

  return deliverOrderMail({
    order,
    subject: t('arrivedSubject', { orderNumber: order.orderNumber, place: placeType }),
    html,
    outboxName: `order-arrived-${order.id}-${Date.now()}.html`,
  });
}

/** Warm asset cache / validate brand files exist (optional startup check). */
export async function assertMailAssets() {
  const required = ['logo-mark.png'];
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
