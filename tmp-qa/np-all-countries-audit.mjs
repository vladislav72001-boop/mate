/**
 * Full multi-country audit: Nova Post GNPHU contract vs Mate client price.
 * Expect: Mate = ceil_to_10(NP_HUF × 1.30), no second VAT, contract always sent.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

try {
  const vars = JSON.parse(readFileSync(new URL('./railway-vars.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  for (const [k, v] of Object.entries(vars)) {
    const key = String(k).trim();
    if (key === 'DATABASE_URL' || key.startsWith('POSTGRES')) continue;
    if (process.env[key] == null && v != null) process.env[key] = String(v);
  }
} catch (e) {
  console.warn('railway-vars:', e.message);
}

process.env.NOVAPOST_USE_POWERSHELL = process.env.NOVAPOST_USE_POWERSHELL || 'true';
process.env.NOVAPOST_PAYER_CONTRACT_NUMBER = 'GNPHU-00026481';
process.env.NOVAPOST_COMPANY_TIN = '32834374243';
delete process.env.NOVAPOST_RETAIL_FACTOR;
delete process.env.PRICING_FORCE_MATE;
process.env.NOVAPOST_COST_INCLUDES_VAT = 'true';
process.env.PRICING_NP_APPLY_MARKUP = 'true';
process.env.NOVAPOST_QUOTE_CACHE_MS = '0';

const DESTINATIONS = [
  'HU', 'PL', 'DE', 'FR', 'ES', 'IT', 'CZ', 'SK', 'AT', 'RO',
  'UA', 'LT', 'LV', 'EE', 'NL', 'BE', 'GB', 'MD',
];

const SIZES = [
  { boxSize: 'XS', lengthCm: 35, widthCm: 25, heightCm: 2, weightKg: 0.2 },
  { boxSize: 'S', lengthCm: 35, widthCm: 20, heightCm: 10, weightKg: 1.9 }, // Oleg sample
  { boxSize: 'M', lengthCm: 40, widthCm: 30, heightCm: 30, weightKg: 5 },
];

const settings = {
  currency: 'HUF',
  vatEnabled: true,
  vatPercent: 27,
  roundingEnabled: true,
  roundingStep: 10,
  fxFromEur: { EUR: 1, HUF: 400, PLN: 4.3, CZK: 25, RON: 5 },
};
const weightMarkups = [{ maxKg: 99, percent: 30 }];

const { calculateSingle } = await import('../server/novapost/calculate.mjs');
const {
  finalizeNovaPostClientPrice,
  roundAmount,
  novaPostRetailAlignFactor,
} = await import('../server/pricing-config.mjs');
const { getNovaPostContractConfig } = await import('../server/novapost/client.mjs');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function expectedMate(npTotal, quoteCurrency, weightKg) {
  return finalizeNovaPostClientPrice({
    npTotal,
    quoteCurrency,
    settings,
    weightMarkups,
    tiers: [],
    weightKg,
    source: 'novapost',
    costIncludesVat: true,
  });
}

async function quoteWithRetry(input, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await calculateSingle(input);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (!/\b(403|429|502|503|504)\b/.test(msg) && !/transport/i.test(msg)) break;
      await sleep(600 * (i + 1));
    }
  }
  throw lastErr;
}

const contract = getNovaPostContractConfig();
console.log('contract', contract);
console.log('retailFactor', novaPostRetailAlignFactor());
console.log('ceil check', roundAmount(2333.5, settings), '(expect 2340)');

const rows = [];
const failures = [];
let pass = 0;
let fail = 0;

for (const toCountry of DESTINATIONS) {
  for (const size of SIZES) {
    const label = `HU→${toCountry} ${size.boxSize} ${size.weightKg}kg`;
    process.stdout.write(`… ${label} `);
    try {
      const quote = await quoteWithRetry({
        fromCountry: 'HU',
        toCountry,
        lengthCm: size.lengthCm,
        widthCm: size.widthCm,
        heightCm: size.heightCm,
        weightKg: size.weightKg,
        declaredValue: 1,
        boxSize: size.boxSize,
      });

      const issues = [];
      if (quote.priceSource !== 'novapost') issues.push(`source=${quote.priceSource}`);
      if (quote.meta?.payerContractNumber !== 'GNPHU-00026481') {
        issues.push(`contract=${quote.meta?.payerContractNumber}`);
      }
      if (!(Number(quote.total) > 0)) issues.push(`npTotal=${quote.total}`);

      const client = expectedMate(quote.total, quote.currency?.code || 'HUF', size.weightKg);
      const npHuf = client.breakdown?.companyApiGross ?? client.breakdown?.npNet;
      const afterMarkup = Number(npHuf) * 1.3;
      const expectCeil = roundAmount(afterMarkup, settings);
      if (client.amount !== expectCeil) {
        issues.push(`mate=${client.amount} expectCeil=${expectCeil}`);
      }
      if (client.breakdown?.vatIncludedInCarrier !== true && settings.vatEnabled) {
        // when costIncludesVat true, vat should already be in carrier
        if (client.breakdown?.afterVat !== client.breakdown?.beforeVat
          && client.breakdown?.vatIncludedInCarrier !== true) {
          issues.push('possible double VAT');
        }
      }
      // Explicit: afterVat should equal beforeVat when VAT included in NP
      if (client.breakdown?.vatIncludedInCarrier === true
        && Math.abs(Number(client.breakdown.afterVat) - Number(client.breakdown.beforeVat)) > 0.01) {
        issues.push('VAT applied twice');
      }
      if (client.breakdown?.retailAlignFactor) {
        issues.push(`retailFactor=${client.breakdown.retailAlignFactor}`);
      }

      const row = {
        label,
        toCountry,
        boxSize: size.boxSize,
        weightKg: size.weightKg,
        npTotal: quote.total,
        npCurrency: quote.currency?.code,
        npHuf: client.breakdown?.npNet,
        mate: client.amount,
        mateCurrency: client.currency,
        contract: quote.meta?.payerContractNumber,
        ok: issues.length === 0,
        issues,
      };
      rows.push(row);
      if (issues.length) {
        fail += 1;
        failures.push(row);
        console.log(`FAIL ${JSON.stringify(issues)} NP=${quote.total} Mate=${client.amount}`);
      } else {
        pass += 1;
        console.log(`OK NP=${quote.total} ${quote.currency?.code} → Mate=${client.amount} HUF`);
      }
    } catch (err) {
      fail += 1;
      const row = {
        label,
        toCountry,
        boxSize: size.boxSize,
        weightKg: size.weightKg,
        ok: false,
        issues: [String(err?.message || err).slice(0, 240)],
      };
      rows.push(row);
      failures.push(row);
      console.log(`FAIL ${row.issues[0]}`);
    }
    await sleep(250);
  }
}

const out = {
  at: new Date().toISOString(),
  contract,
  ceilSample: { input: 2333.5, out: roundAmount(2333.5, settings) },
  summary: { pass, fail, total: rows.length },
  failures,
  rows,
};

const outPath = fileURLToPath(new URL('./np-all-countries-audit.json', import.meta.url));
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(out.summary));
console.log('wrote', outPath);
if (fail) {
  console.log('\nFAILURES:');
  for (const f of failures) {
    console.log('-', f.label, f.issues?.join('; '));
  }
  process.exitCode = 1;
}
