/**
 * Generate scannable Code128 / QR PNGs for TTN (Nova Post shipment numbers).
 */
import bwipjs from 'bwip-js';

const MAX_VALUE_LEN = 48;
const ALLOWED = /^[A-Za-z0-9._\-/]+$/;

/** Strip spaces/dashes used only for display formatting. */
export function normalizeBarcodeValue(raw) {
  return String(raw || '').replace(/[\s-]+/g, '').trim();
}

export function isSafeBarcodeValue(value) {
  const v = normalizeBarcodeValue(value);
  return Boolean(v) && v.length <= MAX_VALUE_LEN && ALLOWED.test(v);
}

async function toPng(bcid, text, opts = {}) {
  const value = normalizeBarcodeValue(text);
  if (!isSafeBarcodeValue(value)) {
    throw new Error('Invalid barcode value');
  }
  const params = {
    bcid,
    text: value,
    scale: opts.scale ?? 3,
    includetext: false,
    backgroundcolor: 'FFFFFF',
    paddingwidth: opts.paddingwidth ?? 4,
    paddingheight: opts.paddingheight ?? 4,
    ...(opts.extra || {}),
  };
  if (opts.height != null) params.height = opts.height;
  return bwipjs.toBuffer(params);
}

export async function code128Png(text) {
  return toPng('code128', text, {
    scale: 2,
    height: 14,
    paddingwidth: 6,
    paddingheight: 4,
  });
}

export async function qrPng(text) {
  return toPng('qrcode', text, {
    scale: 3,
    paddingwidth: 2,
    paddingheight: 2,
    extra: {
      eclevel: 'M',
    },
  });
}

/** Public image URLs embedded in transactional email HTML. */
export function barcodeImageUrls(track, baseUrl) {
  const value = normalizeBarcodeValue(track);
  const root = String(baseUrl || '').replace(/\/$/, '');
  const enc = encodeURIComponent(value);
  return {
    code128: `${root}/api/shipping/barcode/code128/${enc}.png`,
    qr: `${root}/api/shipping/barcode/qr/${enc}.png`,
    value,
  };
}
