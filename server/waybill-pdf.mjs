import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_REG = path.join(__dirname, 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(__dirname, 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function money(amount, currency = 'HUF') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  if (String(currency).toUpperCase() === 'HUF') {
    return `${Math.round(num).toLocaleString('hu-HU')} HUF`;
  }
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

function modeLabel(mode) {
  const raw = String(mode || '').toLowerCase();
  if (raw === 'home' || raw === 'address' || raw === 'courier') return 'Адрес / курьер';
  if (raw === 'branch' || raw === 'office') return 'Отделение';
  if (raw === 'pudo') return 'Пункт выдачи';
  if (raw === 'locker') return 'Постамат';
  return raw || '—';
}

function person(order, side) {
  const p = order?.payload || {};
  if (side === 'sender') {
    return {
      name: p.sender?.name || order.senderName || '—',
      phone: p.sender?.phone || order.senderPhone || '—',
      line: p.sender?.line || order.senderLine || '—',
      country: p.tariff?.fromCountry || p.sender?.country || order.fromCountry || '—',
    };
  }
  const r = p.receiver || {};
  return {
    name: [r.firstName, r.lastName].filter(Boolean).join(' ') || order.receiverName || '—',
    phone: r.phone || order.receiverPhone || '—',
    line: r.destinationLine || order.receiverLine || '—',
    country: p.tariff?.toCountry || r.country || order.toCountry || '—',
  };
}

/**
 * Build a waybill PDF buffer for an order.
 * @param {object} order full order (DB-mapped) or publicOrder-like
 */
export async function buildWaybillPdf(order) {
  if (!existsSync(FONT_REG) || !existsSync(FONT_BOLD)) {
    throw new Error('PDF fonts missing (server/assets/fonts/DejaVuSans*.ttf)');
  }

  const payload = order.payload || {};
  const tariff = payload.tariff || {};
  const parcel = payload.parcel || {};
  const sender = person(order, 'sender');
  const receiver = person(order, 'receiver');
  const ttn = order.npTtn || order.orderNumber || '—';
  const created = order.createdAt
    ? new Date(order.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Budapest' })
    : '—';

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));

  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.registerFont('Mate', FONT_REG);
  doc.registerFont('MateBold', FONT_BOLD);

  // Header
  doc.rect(0, 0, doc.page.width, 72).fill('#0B0B0B');
  doc.fillColor('#FFFFFF').font('MateBold').fontSize(22)
    .text('MATE.', 48, 26, { continued: true });
  doc.fillColor('#D2E84D').text('');
  doc.fillColor('#A8ADB4').font('Mate').fontSize(10)
    .text('Накладная / Waybill', 48, 48);
  doc.fillColor('#A8ADB4').font('Mate').fontSize(10)
    .text(ttn, 48, 26, { align: 'right', width: doc.page.width - 96 });

  let y = 96;
  doc.fillColor('#111111').font('MateBold').fontSize(16).text('Транспортная накладная', 48, y);
  y += 28;

  const row = (label, value) => {
    doc.font('Mate').fontSize(9).fillColor('#6B7280').text(label, 48, y, { width: 160 });
    doc.font('MateBold').fontSize(11).fillColor('#111111').text(String(value ?? '—'), 210, y, {
      width: doc.page.width - 258,
    });
    y += 18;
  };

  row('Номер заказа', order.orderNumber);
  row('ТТН / трек', ttn);
  row('Статус', order.status);
  row('Создан', created);
  row('Сумма', money(order.amount, order.currency));
  y += 8;

  doc.font('MateBold').fontSize(12).fillColor('#111111').text('Отправитель', 48, y);
  y += 18;
  row('Имя', sender.name);
  row('Телефон', sender.phone);
  row('Адрес', sender.line);
  row('Страна', sender.country);
  row('Способ сдачи', modeLabel(tariff.pickupMode || tariff.pickupType || order.pickupMode));
  if (tariff.pickupDate || order.pickupDate) {
    row('Дата / время', `${tariff.pickupDate || order.pickupDate || ''}${tariff.pickupTime || order.pickupTime ? `, ${tariff.pickupTime || order.pickupTime}` : ''}`);
  }
  y += 8;

  doc.font('MateBold').fontSize(12).fillColor('#111111').text('Получатель', 48, y);
  y += 18;
  row('Имя', receiver.name);
  row('Телефон', receiver.phone);
  row('Адрес', receiver.line);
  row('Страна', receiver.country);
  row('Способ получения', modeLabel(tariff.deliveryMode || tariff.deliveryType || order.deliveryMode));
  y += 8;

  doc.font('MateBold').fontSize(12).fillColor('#111111').text('Посылка', 48, y);
  y += 18;
  row('Размер', parcel.boxSize || order.parcelSize || '—');
  row('Вес, кг', parcel.weightKg ?? order.weightKg ?? '—');
  row('Габариты, см', [parcel.lengthCm, parcel.widthCm, parcel.heightCm].filter((n) => n != null).join(' × ') || '—');
  row('Описание', parcel.description || parcel.contents || '—');
  row('Объявленная ценность', parcel.declaredValue != null ? `€${parcel.declaredValue}` : '—');
  row('Хрупкое', parcel.fragile || order.fragile ? 'Да' : 'Нет');
  row('Страховка', parcel.insurance || order.insurance ? 'Да' : 'Нет');
  y += 16;

  doc.roundedRect(48, y, doc.page.width - 96, 64, 8).fill('#F4F5F1');
  doc.fillColor('#111111').font('Mate').fontSize(10)
    .text(
      'Документ сформирован автоматически MATE Delivery. '
      + 'Предъявите трек-номер при сдаче посылки. Поддержка: help@matedelivery.com',
      60,
      y + 16,
      { width: doc.page.width - 120 },
    );

  doc.end();
  return done;
}

export function waybillFilename(order) {
  const id = String(order?.npTtn || order?.orderNumber || 'waybill')
    .replace(/[^\w.-]+/g, '_');
  return `MATE-waybill-${id}.pdf`;
}
