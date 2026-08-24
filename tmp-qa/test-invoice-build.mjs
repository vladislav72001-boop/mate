import { buildShipmentInvoice, requiresCustomsInvoice } from '../server/novapost/invoice.mjs';

const body = {
  sender: { country: 'HU' },
  receiver: { country: 'UA' },
  contents: 'shoes',
  contentsNote: '',
};

const parcel = {
  declaredValue: 100,
  description: 'Parcel custom — Обувь',
  weightKg: 6.3,
};

console.assert(requiresCustomsInvoice('HU', 'UA') === true, 'HU→UA needs invoice');
console.assert(requiresCustomsInvoice('HU', 'DE') === false, 'HU→DE no invoice');

const invoice = buildShipmentInvoice(body, parcel, 6300, 'MD-B2C-TEST');
console.assert(invoice != null, 'invoice built');
console.assert(invoice.cost === 100, 'cost');
console.assert(invoice.currency === 'EUR', 'currency');
console.assert(invoice.incoterm === 'DAP', 'incoterm');
console.assert(invoice.payerFeesCustoms === 'Recipient', 'payerFeesCustoms');
console.assert(invoice.items[0].actualWeight === 6300, 'item weight matches parcel');
console.assert(invoice.items[0].measurementCode === 'pieces', 'measurementCode');
console.log('invoice ok:', JSON.stringify(invoice, null, 2));
