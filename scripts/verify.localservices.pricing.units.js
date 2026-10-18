/**
 * LocalWala – Local Commerce & Delivery Platform
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
 * verify.localservices.pricing.units.js — pricing engine units (no DB).
 * Run: node scripts/verify.localservices.pricing.units.js
 */

const pricing = require('../src/modules/local-services/services/localservice.pricing.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Spec §6.1: 399 + 150 - 50 = 499 taxable + 5% = 24.95 => 523.95
const r1 = pricing.priceBooking({ pricingMode: 'FIXED', basePrice: 399, addons: [{ label: 'Pipe', price: 150 }], discountAmount: 50, taxPercent: 5 });
ok('fixed 523.95', r1.total === 523.95 && r1.tax === 24.95, JSON.stringify(r1));
// §6.2 hourly: (400x2)+200 = 1000
const r2 = pricing.priceBooking({ pricingMode: 'HOURLY', hourlyRate: 400, hours: 2, addons: [{ label: 'Material', price: 200 }] });
ok('hourly 1000', r2.total === 1000, JSON.stringify(r2));
// §6.3 date: 2000x3 = 6000
const r3 = pricing.priceBooking({ pricingMode: 'DATE_BASED', nightlyRate: 2000, nights: 3 });
ok('date 6000', r3.total === 6000, JSON.stringify(r3));
// Variant + deposit 20%: total 1000 => deposit 200 balance 800
const r4 = pricing.priceBooking({ pricingMode: 'VARIANT', variantPrice: 1000, depositPercent: 20 });
ok('deposit split', r4.deposit === 200 && r4.balance === 800, JSON.stringify(r4));
// Minimum charge lifts subtotal
const r5 = pricing.priceBooking({ pricingMode: 'FIXED', basePrice: 100, minimumCharge: 199 });
ok('minimum charge', r5.subtotal === 199, JSON.stringify(r5));

console.log(failures === 0 ? '\nAll local-services pricing units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
