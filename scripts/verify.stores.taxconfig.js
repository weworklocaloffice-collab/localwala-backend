/**
 * LocalWala — Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.taxconfig.js — BR-41, effective-dated GST rates.
 *
 * Run: node scripts/verify.stores.taxconfig.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { TaxConfiguration } = require('../src/models');
const taxService = require('../src/modules/stores/services/stores.tax.service');

let pass = 0;
let failures = 0;

const ck = (label, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const run = async () => {
  console.log('\n=== TaxConfiguration / BR-41 ===\n');

  const code = 'TEST_GST_RATE_' + Date.now();
  const T0 = new Date('2024-01-01T00:00:00Z');
  const T1 = new Date('2025-01-01T00:00:00Z');
  const T2 = new Date('2026-01-01T00:00:00Z');

  // Old rate in force from 2024, superseded 2025, expired 2026 -> a gap.
  await TaxConfiguration.create({ code, description: 'old 5%', gstRate: 5, effectiveFrom: T0, effectiveTo: T2, isDefault: false, status: true });
  await TaxConfiguration.create({ code, description: 'new 18% from 2025', gstRate: 18, effectiveFrom: T1, effectiveTo: null, isDefault: true, status: true });

  // ---- 1. the effective-dated resolution, not "the latest row" ---------------
  console.log('--- BR-41: the rate in force on a given date ---');

  const at2024 = await TaxConfiguration.resolveRate(code, new Date('2024-06-01'));
  ck('1. on 2024-06-01 the 5% rate is in force', at2024.gstRate === 5, at2024.gstRate);

  const at2025 = await TaxConfiguration.resolveRate(code, new Date('2025-06-01'));
  ck('1b. on 2025-06-01 the 18% rate is in force', at2025.gstRate === 18, at2025.gstRate);

  const atGap = await TaxConfiguration.resolveRate(code, new Date('2023-12-31')).then(() => 'resolved', (e) => e.message);
  ck('1c. before any rate was in force the resolver says so, not silently the latest', /TAX_CONFIG_/.test(String(atGap)), String(atGap));

  // ---- 2. an expired row is NOT the one that wins ----------------------------
  console.log('--- superseded and expired rows ---');

  const at2030 = await TaxConfiguration.resolveRate(code, new Date('2030-01-01'));
  ck('2. far in the future only the open-ended 18% remains', at2030.gstRate === 18, at2030.gstRate);

  // ---- 3. unknown code says so, it does not fabricate ------------------------
  const missing = await TaxConfiguration.resolveRate('NO_SUCH_CODE', new Date()).then(() => 'resolved', (e) => e.message);
  ck('3. an unknown code throws TAX_CONFIG_MISSING', /TAX_CONFIG_MISSING/.test(String(missing)), String(missing));

  // ---- 4. money hygiene on the rate itself -----------------------------------
  ck('4. gstRate is a rupee/percent-style number, not a paise one', typeof at2024.gstRate === 'number' && at2024.gstRate === 5);

  // ---- 5. per-line GST math (BR-41: frozen, paise-exact) ----------------------
  console.log('--- BR-41: per-line tax, frozen at order time ---');

  const inclusive = await taxService.computeLineTax({
    product: { hsn: null, defaultGstRate: 18, taxType: 'inclusive' },
    unitPricePaise: 100000, quantity: 1,
  });
  ck('5. inclusive 18% on 100000p backs out 15254p', inclusive.taxPaise === 15254, inclusive.taxPaise);
  ck('5b. taxable is the remainder', inclusive.taxablePaise === 100000 - 15254, inclusive.taxablePaise);
  ck('5c. intra-state splits CGST/SGST evenly', inclusive.cgstPaise === 7627 && inclusive.sgstPaise === 7627 && inclusive.igstPaise === 0,
    `${inclusive.cgstPaise}/${inclusive.sgstPaise}/${inclusive.igstPaise}`);

  const exclusive = await taxService.computeLineTax({
    product: { hsn: null, defaultGstRate: 5, taxType: 'exclusive' },
    unitPricePaise: 99900, quantity: 1,
  });
  ck('6. exclusive 5% on 99900p adds 4995p', exclusive.taxPaise === 4995, exclusive.taxPaise);
  ck('6b. odd paise goes to SGST (2498/2497)', exclusive.cgstPaise === 2498 && exclusive.sgstPaise === 2497, `${exclusive.cgstPaise}/${exclusive.sgstPaise}`);
  ck('6c. line grand is gross + tax', exclusive.lineGrandPaise === 99900 + 4995, exclusive.lineGrandPaise);

  const none = await taxService.computeLineTax({
    product: { hsn: null, taxType: 'none' },
    unitPricePaise: 50000, quantity: 2,
  });
  ck('7. taxType none carries no tax', none.taxPaise === 0 && none.lineGrandPaise === 100000, none.lineGrandPaise);

  const inter = await taxService.computeLineTax({
    product: { hsn: null, defaultGstRate: 12, taxType: 'exclusive' },
    unitPricePaise: 10000, quantity: 1,
    outletStateCode: '07', customerStateCode: '29',
  });
  ck('8. cross-state is all IGST', inter.igstPaise === 1200 && inter.cgstPaise === 0 && inter.sgstPaise === 0 && inter.intraState === false,
    `${inter.cgstPaise}/${inter.sgstPaise}/${inter.igstPaise}`);

  // ---- 6. rate precedence ----------------------------------------------------
  const hsnBacked = await taxService.computeLineTax({
    product: { hsn: code.toLowerCase(), taxType: 'exclusive' },
    unitPricePaise: 10000, quantity: 1,
  });
  ck('9. an HSN with configured rates resolves from the table (18%)', hsnBacked.gstRate === 18 && hsnBacked.taxPaise === 1800,
    `${hsnBacked.gstRate}/${hsnBacked.taxPaise}`);

  const overridden = await taxService.computeLineTax({
    product: { hsn: code, defaultGstRate: 5, taxType: 'exclusive' },
    outletProduct: { taxConfigOverride: { gstRate: 28 } },
    unitPricePaise: 10000, quantity: 1,
  });
  ck('9b. the outlet override beats the HSN table', overridden.gstRate === 28 && overridden.taxPaise === 2800,
    `${overridden.gstRate}/${overridden.taxPaise}`);

  const noHsn = await taxService.computeLineTax({
    product: {},
    unitPricePaise: 10000, quantity: 1,
  });
  ck('9c. a product with no HSN and no default never blocks checkout', noHsn.taxPaise === 0 && noHsn.lineGrandPaise === 10000, noHsn.lineGrandPaise);

  // ---- 7. pro-rata allocation is exact ---------------------------------------
  const shares = taxService.allocateProRata(100, [1, 1, 1]);
  ck('10. 100p over three lines sums exactly', shares.reduce((a, b) => a + b, 0) === 100, shares.join(','));
  ck('10b. remainder lands on the heaviest line', shares[0] === 34 && shares[1] === 33 && shares[2] === 33, shares.join(','));

  await TaxConfiguration.deleteMany({ code });

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('ALL TAX CONFIGURATION CHECKS PASSED');
  } else {
    console.log(failures + ' TAX CONFIG CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('taxconfig suite could not run:', error.message);
    process.exit(1);
  }
})();