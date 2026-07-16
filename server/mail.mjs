import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outboxDir = path.join(__dirname, 'outbox');

const STATUS_LABELS = {
  pending_payment: 'Ожидает оплаты',
  paid: 'Оплачено',
  submitted: 'Посылка в пути',
  cancelled: 'Отменён',
};

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  }

  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
  console.log('[mail] Using Ethereal test SMTP. Set SMTP_* env vars for production.');
  return transporter;
}

async function saveOutboxCopy(filename, html) {
  await mkdir(outboxDir, { recursive: true });
  await writeFile(path.join(outboxDir, filename), html, 'utf8');
}

function appUrl() {
  return process.env.APP_URL || 'http://localhost:5011';
}

function mailFrom() {
  return process.env.MAIL_FROM || '"MATE" <info@matedelivery.com>';
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

function baseTemplate(title, body) {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Arial,sans-serif;background:#f3f3f1;padding:24px;color:#122023">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e8e8e8">
    <div style="font-weight:900;font-size:24px;letter-spacing:.04em;margin-bottom:18px">MATE<span style="color:#8fa300">.</span></div>
    ${body}
    <p style="margin-top:24px;font-size:13px;color:#7b7b7b">С уважением,<br>Команда MATE</p>
  </div>
</body>
</html>`;
}

function ctaButton(href, label) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:16px;background:#E1FF01;color:#122023;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">${escapeHtml(label)}</a>`;
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
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px;line-height:1.5;color:#5a6068">
      <tr><td style="padding:6px 0;color:#7b7b7b;width:140px">Номер заказа</td><td style="padding:6px 0"><strong>${escapeHtml(order.orderNumber)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#7b7b7b">Маршрут</td><td style="padding:6px 0">${escapeHtml(orderRouteLine(order))}</td></tr>
      <tr><td style="padding:6px 0;color:#7b7b7b">Получатель</td><td style="padding:6px 0">${escapeHtml(receiverName)}</td></tr>
      <tr><td style="padding:6px 0;color:#7b7b7b">Сумма</td><td style="padding:6px 0"><strong>${escapeHtml(formatMoney(order.amount, order.currency))}</strong></td></tr>
      ${order.npTtn ? `<tr><td style="padding:6px 0;color:#7b7b7b">ТТН</td><td style="padding:6px 0"><strong>${escapeHtml(order.npTtn)}</strong></td></tr>` : ''}
      ${extraRows}
    </table>`;
}

async function deliver({ to, subject, html, outboxName }) {
  const transport = await getTransporter();
  const info = await transport.sendMail({
    from: mailFrom(),
    to,
    subject,
    html,
  });
  const preview = nodemailer.getTestMessageUrl(info);
  if (outboxName) await saveOutboxCopy(outboxName, html);
  if (preview) console.log(`[mail] Preview (${subject}): ${preview}`);
  return { messageId: info.messageId, preview };
}

export async function sendWelcomeEmail(user) {
  const html = baseTemplate(
    'Добро пожаловать в MATE',
    `<h1 style="margin:0 0 12px;font-size:24px">Добро пожаловать, ${escapeHtml(user.name)}!</h1>
     <p style="font-size:16px;line-height:1.5;color:#5a6068">Ваш аккаунт MATE успешно создан. Теперь вы можете рассчитывать доставку, создавать отправления и отслеживать посылки в личном кабинете.</p>
     <p style="font-size:16px;line-height:1.5;color:#5a6068"><strong>Email:</strong> ${escapeHtml(user.email)}</p>
     ${ctaButton(appUrl(), 'Перейти в личный кабинет')}`,
  );

  return deliver({
    to: user.email,
    subject: 'Добро пожаловать в MATE — аккаунт создан',
    html,
    outboxName: `welcome-${user.id}.html`,
  });
}

export async function sendLoginEmail(user, meta = {}) {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' });
  const html = baseTemplate(
    'Вход в MATE',
    `<h1 style="margin:0 0 12px;font-size:24px">Вход в ваш аккаунт</h1>
     <p style="font-size:16px;line-height:1.5;color:#5a6068">Здравствуйте, ${escapeHtml(user.name)}! Вы успешно вошли в личный кабинет MATE.</p>
     <p style="font-size:16px;line-height:1.5;color:#5a6068"><strong>Время:</strong> ${escapeHtml(when)}</p>
     ${meta.ip ? `<p style="font-size:16px;line-height:1.5;color:#5a6068"><strong>IP:</strong> ${escapeHtml(meta.ip)}</p>` : ''}
     <p style="font-size:14px;line-height:1.5;color:#7b7b7b">Если это были не вы, немедленно смените пароль в настройках аккаунта.</p>`,
  );

  return deliver({
    to: user.email,
    subject: 'Вход в аккаунт MATE',
    html,
    outboxName: `login-${user.id}-${Date.now()}.html`,
  });
}

export async function sendPasswordChangedEmail(user) {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' });
  const html = baseTemplate(
    'Пароль изменён',
    `<h1 style="margin:0 0 12px;font-size:24px">Пароль обновлён</h1>
     <p style="font-size:16px;line-height:1.5;color:#5a6068">Здравствуйте, ${escapeHtml(user.name)}! Пароль вашего аккаунта MATE был успешно изменён.</p>
     <p style="font-size:16px;line-height:1.5;color:#5a6068"><strong>Время:</strong> ${escapeHtml(when)}</p>
     <p style="font-size:14px;line-height:1.5;color:#7b7b7b">Если вы не меняли пароль, немедленно свяжитесь с поддержкой и смените пароль в настройках.</p>
     ${ctaButton(appUrl(), 'Открыть личный кабинет')}`,
  );

  return deliver({
    to: user.email,
    subject: 'Пароль аккаунта MATE изменён',
    html,
    outboxName: `password-${user.id}-${Date.now()}.html`,
  });
}

export async function sendProfileUpdatedEmail(user) {
  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Berlin' });
  const html = baseTemplate(
    'Профиль обновлён',
    `<h1 style="margin:0 0 12px;font-size:24px">Данные профиля обновлены</h1>
     <p style="font-size:16px;line-height:1.5;color:#5a6068">Здравствуйте, ${escapeHtml(user.name)}! Ваши данные в личном кабинете MATE были изменены.</p>
     <p style="font-size:16px;line-height:1.5;color:#5a6068"><strong>Email:</strong> ${escapeHtml(user.email)}<br><strong>Телефон:</strong> ${escapeHtml(user.phone)}</p>
     <p style="font-size:16px;line-height:1.5;color:#5a6068"><strong>Время:</strong> ${escapeHtml(when)}</p>
     <p style="font-size:14px;line-height:1.5;color:#7b7b7b">Если это были не вы, свяжитесь с поддержкой.</p>`,
  );

  return deliver({
    to: user.email,
    subject: 'Профиль MATE обновлён',
    html,
    outboxName: `profile-${user.id}-${Date.now()}.html`,
  });
}

export async function sendOrderCreatedEmail(order, meta = {}) {
  const payUrl = meta.checkoutUrl || appUrl();
  const payLabel = meta.checkoutUrl ? 'Оплатить заказ' : 'Перейти к оплате';
  const html = baseTemplate(
    'Заказ создан',
    `<h1 style="margin:0 0 12px;font-size:24px">Заказ создан</h1>
     <p style="font-size:16px;line-height:1.5;color:#5a6068">Ваш заказ на доставку успешно оформлен и ожидает оплаты.</p>
     ${orderSummaryBlock(order, `<tr><td style="padding:6px 0;color:#7b7b7b">Статус</td><td style="padding:6px 0"><strong>${escapeHtml(STATUS_LABELS.pending_payment)}</strong></td></tr>`)}
     ${ctaButton(payUrl, payLabel)}`,
  );

  return deliver({
    to: order.customerEmail,
    subject: `MATE — заказ ${order.orderNumber} создан, ожидает оплаты`,
    html,
    outboxName: `order-created-${order.id}.html`,
  });
}

export async function sendOrderStatusEmail(order, previousStatus) {
  const status = order.status;
  const prevLabel = STATUS_LABELS[previousStatus] || previousStatus;
  const nextLabel = STATUS_LABELS[status] || status;

  let title;
  let intro;
  let subject;

  if (status === 'paid') {
    title = 'Оплата получена';
    intro = 'Оплата вашего заказа успешно получена. Мы начинаем обработку отправления.';
    subject = `MATE — оплата по заказу ${order.orderNumber} получена`;
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
  } else if (status === 'cancelled') {
    title = 'Заказ отменён';
    intro = 'Ваш заказ был отменён. Если оплата уже проходила, мы свяжемся с вами по возврату.';
    subject = `MATE — заказ ${order.orderNumber} отменён`;
  } else if (status === 'pending_payment') {
    title = 'Требуется оплата';
    intro = 'Статус заказа изменён: требуется оплата для продолжения отправки.';
    subject = `MATE — заказ ${order.orderNumber} ожидает оплаты`;
  } else {
    title = 'Статус заказа изменён';
    intro = `Статус вашего заказа обновлён: ${prevLabel} → ${nextLabel}.`;
    subject = `MATE — статус заказа ${order.orderNumber} обновлён`;
  }

  const html = baseTemplate(
    title,
    `<h1 style="margin:0 0 12px;font-size:24px">${escapeHtml(title)}</h1>
     <p style="font-size:16px;line-height:1.5;color:#5a6068">${escapeHtml(intro)}</p>
     ${orderSummaryBlock(order, `<tr><td style="padding:6px 0;color:#7b7b7b">Статус</td><td style="padding:6px 0"><strong>${escapeHtml(nextLabel)}</strong></td></tr>`)}
     ${ctaButton(appUrl(), 'Отследить отправление')}`,
  );

  return deliver({
    to: order.customerEmail,
    subject,
    html,
    outboxName: `order-status-${order.id}-${status}-${Date.now()}.html`,
  });
}

export async function sendOrderTrackingEmail(order) {
  const html = baseTemplate(
    'Обновление трекинга',
    `<h1 style="margin:0 0 12px;font-size:24px">Номер для отслеживания</h1>
     <p style="font-size:16px;line-height:1.5;color:#5a6068">Для вашего отправления доступен номер отслеживания (ТТН). Используйте его для проверки статуса доставки.</p>
     ${orderSummaryBlock(order, `<tr><td style="padding:6px 0;color:#7b7b7b">Статус</td><td style="padding:6px 0"><strong>${escapeHtml(STATUS_LABELS[order.status] || order.status)}</strong></td></tr>`)}
     ${ctaButton(appUrl(), 'Отследить посылку')}`,
  );

  return deliver({
    to: order.customerEmail,
    subject: `MATE — трекинг ${order.orderNumber}: ${order.npTtn}`,
    html,
    outboxName: `order-tracking-${order.id}-${Date.now()}.html`,
  });
}
