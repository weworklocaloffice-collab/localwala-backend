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
 * verify.localservices.revenue.units.js — revenue engine pure units (no DB).
 *
 * Covers master prompt §9 + mandatory toggles §13.5:
 *  - ₹60 fee + 5% labour commission (Home Services defaults)
 *  - parts excluded when partsCommissionable=false
 *  - 4 toggle combos (ON+ON, ON+OFF, OFF+ON, OFF+OFF)
 *  - precedence platform < category < subcategory < service < provider
 *  - draft/unapproved never applied, date boundaries, paise rounding
 *  - lead-fee-only must not compute commission
 *
 * Run: node scripts/verify.localservices.revenue.units.js
 */

const revenue = require('../src/modules/local-services/services/localservice.revenue.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const baseRule = (over = {}) => ({
  code: 'HOME-STD',
  name: 'Home standard',
  revenueModel: 'COMBINED',
  status: 'active',
  bookingFeeEnabled: true,
  bookingFee: 60,
  commissionEnabled: true,
  commissionType: 'percentage',
  commissionRatePercent: 5,
  commissionFixedAmount: 0,
  calculationBasis: 'LABOUR_ONLY',
  qualifyingEvent: 'COMPLETION_VERIFIED',
  partsCommissionable: false,
  allowFeeAndCommissionStack: true,
  minimumCharge: 0,
  maximumCharge: 0,
  currency: 'INR',
  version: 2,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  ...over,
});

// 1. Home Services headline: labour 400, parts 250 => fee 60, commission 20,
// provider 630 (parts pass through), platform 80, customer 710.
const r1 = revenue.calculateRevenue(baseRule(), { labourAmount: 400, partsAmount: 250 });
ok('headline fee 60', r1.bookingFee === 60, JSON.stringify(r1));
ok('headline commission 20 (5% x 400, parts excluded)', r1.commissionAmount === 20, JSON.stringify(r1));
ok('headline provider 630 (labour + parts - commission)', r1.providerPayable === 630, JSON.stringify(r1));
ok('headline platform 80', r1.platformRevenue === 80, JSON.stringify(r1));
ok('headline customer 710', r1.customerTotal === 710, JSON.stringify(r1));
ok('snapshot frozen', r1.ruleSnapshot.code === 'HOME-STD' && r1.ruleSnapshot.version === 2);

// 2. Parts excluded vs included
const rPartsOff = revenue.calculateRevenue(baseRule({ calculationBasis: 'SERVICE_VALUE', partsCommissionable: false }), {
  labourAmount: 400,
  partsAmount: 1000,
});
ok('parts excluded base=400', rPartsOff.commissionBase === 400, JSON.stringify(rPartsOff));
const rPartsOn = revenue.calculateRevenue(baseRule({ calculationBasis: 'SERVICE_VALUE', partsCommissionable: true }), {
  labourAmount: 400,
  partsAmount: 1000,
});
ok('parts included base=1400 commission=70', rPartsOn.commissionBase === 1400 && rPartsOn.commissionAmount === 70, JSON.stringify(rPartsOn));

// 3. Four toggle combos
const onOn = revenue.calculateRevenue(baseRule(), { labourAmount: 400 });
ok('ON+ON both', onOn.bookingFee === 60 && onOn.commissionAmount === 20);
const onOff = revenue.calculateRevenue(baseRule({ commissionEnabled: false }), { labourAmount: 400 });
ok('ON+OFF fee only', onOff.bookingFee === 60 && onOff.commissionAmount === 0, JSON.stringify(onOff));
const offOn = revenue.calculateRevenue(baseRule({ bookingFeeEnabled: false }), { labourAmount: 400 });
ok('OFF+ON commission only', offOn.bookingFee === 0 && offOn.commissionAmount === 20, JSON.stringify(offOn));
const offOff = revenue.calculateRevenue(baseRule({ bookingFeeEnabled: false, commissionEnabled: false }), {
  labourAmount: 400,
});
ok('OFF+OFF neither', offOff.bookingFee === 0 && offOff.commissionAmount === 0 && offOff.platformRevenue === 0);

// 4. Precedence
const platform = baseRule({ code: 'PLATFORM', categoryKey: null, effectiveFrom: new Date('2026-01-01') });
const category = baseRule({ code: 'CAT', categoryKey: 'home', effectiveFrom: new Date('2026-02-01') });
const service = baseRule({ code: 'SVC', categoryKey: 'home', serviceKey: 'ac-repair', effectiveFrom: new Date('2026-03-01') });
const resolved = revenue.resolveRule([platform, category, service], { categoryKey: 'home', serviceKey: 'ac-repair' }, new Date('2026-06-01'));
ok('precedence service wins', resolved && resolved.code === 'SVC', JSON.stringify(resolved && resolved.code));

// 5. Draft never applied + date boundaries
let threw = false;
try {
  revenue.calculateRevenue(baseRule({ status: 'draft' }), { labourAmount: 100 });
} catch (e) {
  threw = true;
}
ok('draft rejected', threw);
const bounded = baseRule({ effectiveFrom: new Date('2026-06-01'), effectiveTo: new Date('2026-07-01') });
let threw2 = false;
try {
  revenue.calculateRevenue(bounded, { labourAmount: 100 }, { atDate: new Date('2026-08-01') });
} catch (e) {
  threw2 = true;
}
ok('expired boundary rejected', threw2);

// 6. Lead-fee-only guard
let threw3 = false;
try {
  revenue.calculateRevenue(baseRule({ revenueModel: 'LEAD_FEE', commissionEnabled: true }), { labourAmount: 100 });
} catch (e) {
  threw3 = true;
}
ok('lead+commission rejected', threw3);

// 7. Paise rounding: 5% of 333.33 = 16.67 (1666.65paise rounds to 1667)
const rRound = revenue.calculateRevenue(baseRule(), { labourAmount: 333.33 });
ok('rounding 16.67', rRound.commissionAmount === 16.67, JSON.stringify(rRound));

// 8. Model/toggle consistency (§14-B): single models must match their switch.
const throws400 = (fn) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e.statusCode === 400;
  }
};
ok('BOOKING_FEE+commission rejected', throws400(() => revenue.calculateRevenue(baseRule({ revenueModel: 'BOOKING_FEE', commissionEnabled: true }), { labourAmount: 100 })));
ok('COMMISSION+fee rejected', throws400(() => revenue.calculateRevenue(baseRule({ revenueModel: 'COMMISSION', bookingFeeEnabled: true }), { labourAmount: 100 })));
ok('LEAD_FEE fee-off rejected', throws400(() => revenue.calculateRevenue(baseRule({ revenueModel: 'LEAD_FEE', bookingFeeEnabled: false, commissionEnabled: false }), { labourAmount: 0 })));
ok('BOOKING_FEE fee-only ok', revenue.calculateRevenue(baseRule({ revenueModel: 'BOOKING_FEE', commissionEnabled: false }), { labourAmount: 100 }).bookingFee === 60);

// 8. Idempotency key stable
const k1 = revenue.buildIdempotencyKey('BK123', 'HOME-STD', 2);
const k2 = revenue.buildIdempotencyKey('BK123', 'HOME-STD', 2);
ok('idempotency stable', k1 === k2 && k1 === 'lsrev:BK123:HOME-STD:v2');

console.log(failures === 0 ? '\nAll local-services revenue units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
