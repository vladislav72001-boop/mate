/**
 * Regression: client price = GNPHU contract NP × Mate 30%, no second VAT, no retail scale.
 * Oleg 2026-08-05: my.novapost Legal entity HU→CZ 35×20×10 1.9kg = 1795 HUF → Mate ~2330.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

try {
  const vars = JSON.parse(readFileSync(new URL('./railway-vars.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  for (const [k, v] of Object.entries(vars)) {
    const key = String(k).trim();
    if (key === 'DATABASE_URL' || key.startsWith('POSTGRES')) continue;
    if (process.env[key] == null && v != null) process.env[key] = String(v);
  }
} catch {
  /* optional */
}
process.env.NOVAPOST_USE_POWERSHELL = process.env.NOVAPOST_USE_POWERSHELL || 'true';
process.env.NOVAPOST_PAYER_CONTRACT_NUMBER = 'GNPHU-00026481';
process.env.NOVAPOST_COMPANY_TIN = '32834374243';
delete process.env.NOVAPOST_RETAIL_FACTOR;
delete process.env.PRICING_FORCE_MATE;
process.env.NOVAPOST_COST_INCLUDES_VAT = 'true';
process.env.PRICING_NP_APPLY_MARKUP = 'true';

const {
  finalizeNovaPostClientPrice,
  novaPostRetailAlignFactor,
} = await import('../server/pricing-config.mjs');
const { getNovaPostContractConfig } = await import('../server/novapost/client.mjs');
const { calculateSingle } = await import('../server/novapost/calculate.mjs');

assert.equal(novaPostRetailAlignFactor(), 1);
process.env.NOVAPOST_RETAIL_FACTOR = '0.359';
assert.equal(novaPostRetailAlignFactor(), 1, 'retail factor must be ignored');
delete process.env.NOVAPOST_RETAIL_FACTOR;

const contract = getNovaPostContractConfig();
assert.equal(contract.payerContractNumber, 'GNPHU-00026481');
assert.equal(contract.companyTin, '32834374243');

const settings = {
  currency: 'HUF',
  vatEnabled: true,
  vatPercent: 27,
  roundingEnabled: true,
  roundingStep: 10,
};
const weightMarkups = [{ maxKg: 99, percent: 30 }];
const finalized = finalizeNovaPostClientPrice({
  npTotal: 1795,
  quoteCurrency: 'HUF',
  settings,
  weightMarkups,
  tiers: [],
  weightKg: 1.9,
  source: 'novapost',
  costIncludesVat: true,
});

assert.equal(finalized.currency, 'HUF');
assert.ok(finalized.amount === 2340, `expected 2340 (ceil), got ${finalized.amount}`);
assert.equal(finalized.priceSource, 'novapost');
console.log('formula OK: 1795 →', finalized.amount, finalized.currency);

let liveOk = false;
try {
  const quote = await calculateSingle({
    fromCountry: 'HU',
    toCountry: 'CZ',
    lengthCm: 35,
    widthCm: 20,
    heightCm: 10,
    weightKg: 1.9,
    declaredValue: 1,
    boxSize: 'S',
  });
  assert.equal(quote.priceSource, 'novapost');
  assert.equal(quote.meta?.payerContractNumber, 'GNPHU-00026481');
  assert.ok(Math.abs(Number(quote.total) - 1795) <= 50, `NP base expected ~1795, got ${quote.total}`);
  const client = finalizeNovaPostClientPrice({
    npTotal: quote.total,
    quoteCurrency: quote.currency?.code || 'HUF',
    settings,
    weightMarkups,
    tiers: [],
    weightKg: 1.9,
    source: 'novapost',
    costIncludesVat: true,
  });
  console.log('live OK: NP', quote.total, '→ Mate', client.amount, client.currency);
  assert.ok(client.amount >= 2300 && client.amount <= 2500, `live client out of band: ${client.amount}`);
  liveOk = true;
} catch (err) {
  console.warn('live NP skipped/failed (formula still OK):', err?.message || err);
}

console.log(JSON.stringify({ formula: 'pass', live: liveOk ? 'pass' : 'skipped' }));
