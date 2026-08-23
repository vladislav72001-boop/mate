import { normalizeCountryCode } from './calculate.mjs';

/** EU member states supported by Mate (excluding UA, GB, MD). */
const EU_ISO2 = new Set([
  'HU', 'PL', 'DE', 'FR', 'ES', 'IT', 'CZ', 'SK', 'AT', 'RO', 'NL', 'LT', 'LV', 'EE',
]);

const CONTENT_HS_CODE = {
  documents: '49119900',
  clothing: '61099090',
  shoes: '64039900',
  cosmetics: '33049900',
  electronics: '85177900',
  gift: '95030099',
  other: '63079098',
};

const CONTENT_NAME_EN = {
  documents: 'Documents',
  clothing: 'Clothing',
  shoes: 'Shoes',
  cosmetics: 'Cosmetics',
  electronics: 'Electronics',
  gift: 'Gift',
  other: 'Personal goods',
};

const CONTENT_EXPORT_REASON = {
  documents: 'ForPersonalPurposes',
  clothing: 'ForPersonalPurposes',
  shoes: 'ForPersonalPurposes',
  cosmetics: 'ForPersonalPurposes',
  electronics: 'ForPersonalPurposes',
  gift: 'ForPersonalPurposes',
  other: 'ForPersonalPurposes',
};

/** Customs invoice required when route crosses the EU border (incl. UA). */
export function requiresCustomsInvoice(fromCountry, toCountry) {
  const from = normalizeCountryCode(fromCountry);
  const to = normalizeCountryCode(toCountry);
  if (from === 'UA' || to === 'UA') return true;
  const fromEu = EU_ISO2.has(from);
  const toEu = EU_ISO2.has(to);
  return fromEu !== toEu;
}

function roundItemWeightGrams(grams) {
  const g = Math.max(10, Math.round(Number(grams) || 0));
  return Math.floor(g / 10) * 10;
}

function extractItemLabel(body, parcel) {
  const contents = String(body?.contents || parcel?.contents || '').trim().toLowerCase();
  const note = String(body?.contentsNote || parcel?.contentsNote || '').trim();
  if (contents === 'other' && note) return note.slice(0, 120);
  if (contents && CONTENT_NAME_EN[contents]) {
    return CONTENT_NAME_EN[contents];
  }
  const desc = String(parcel?.description || '').trim();
  const dash = desc.includes('—') ? desc.split('—').pop()?.trim() : desc.split('-').pop()?.trim();
  if (dash && dash.length >= 2) return dash.slice(0, 120);
  return 'Personal goods';
}

function resolveContentKey(body, parcel) {
  const raw = String(body?.contents || parcel?.contents || '').trim().toLowerCase();
  if (raw && CONTENT_HS_CODE[raw]) return raw;
  const desc = String(parcel?.description || '').toLowerCase();
  if (desc.includes('shoe') || desc.includes('обув')) return 'shoes';
  if (desc.includes('cloth') || desc.includes('одеж') || desc.includes('ruh')) return 'clothing';
  if (desc.includes('document') || desc.includes('документ')) return 'documents';
  if (desc.includes('cosmetic') || desc.includes('космет')) return 'cosmetics';
  if (desc.includes('electronic') || desc.includes('электрон')) return 'electronics';
  if (desc.includes('gift') || desc.includes('подар')) return 'gift';
  return 'other';
}

/**
 * Build Nova Post customs invoice for cross-border routes (HU→UA etc.).
 * @see https://api-portal.novapost.com/metodi-1/methods/shipments/create-shipments/cross-border-shipments-to-ukraine
 */
export function buildShipmentInvoice(body, parcel, actualWeightGrams, clientOrder) {
  const senderCountry = normalizeCountryCode(body?.sender?.country || 'HU');
  const recipientCountry = normalizeCountryCode(body?.receiver?.country || 'PL');
  if (!requiresCustomsInvoice(senderCountry, recipientCountry)) return null;

  const contentKey = resolveContentKey(body, parcel);
  const itemWeight = roundItemWeightGrams(actualWeightGrams);
  const declaredEur = Math.max(1, Number(parcel?.declaredValue ?? 100));
  const unitCost = Math.round(declaredEur * 100) / 100;
  const label = extractItemLabel(body, parcel);
  const labelEng = CONTENT_NAME_EN[contentKey] || label;

  const invoice = {
    incoterm: 'DAP',
    exportReason: CONTENT_EXPORT_REASON[contentKey] || 'ForPersonalPurposes',
    cost: unitCost,
    currency: 'EUR',
    items: [{
      hsCode: CONTENT_HS_CODE[contentKey] || CONTENT_HS_CODE.other,
      name: label.slice(0, 512),
      nameEng: labelEng.slice(0, 512),
      actualWeight: itemWeight,
      measurementCode: 'pcs',
      amount: 1,
      cost: unitCost,
    }],
  };

  // Required for UA ↔ EU directions.
  if (senderCountry === 'UA' || recipientCountry === 'UA') {
    invoice.payerFeesCustoms = 'Recipient';
  }

  if (clientOrder) {
    invoice.customerNumber = String(clientOrder).slice(0, 50);
    invoice.type = contentKey === 'gift' || contentKey === 'other'
      ? 'ProformaInvoice'
      : 'ProformaInvoice';
    invoice.customerCreatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
  }

  return invoice;
}
