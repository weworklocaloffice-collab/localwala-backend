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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.realestate.holds.js — the §6.2 disposition matrix + forfeiture
 * dual control + BR-12. No database required.
 *
 * Run:  node scripts/verify.realestate.holds.js
 *
 * ## Why pure-logic, not live
 *
 * The matrix is a pure function (`resolveDisposition`) of (event, policy
 * snapshot). A live test would prove the database works, not that the
 * business answers are right — and the answers are the load-bearing part:
 * principal is customer money in trust (BR-13) and only forfeiture with
 * dual control may turn it into revenue.
 */

const holdService = require('../src/modules/realestate/services/realestate.hold.service');
const RealEstatePropertyHold = require('../src/modules/realestate/models/realestate.property.hold.model');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + (e ? '  ->  ' + e : ''));
};

const POLICY = {
  cancellationRefundable: true,
  expiryRefundable: true,
  feeRefundableOnListingWithdrawal: true,
  forfeitureRequiresDualControl: true,
};

// ---------------------------------------------------------------- §6.2 rows

console.log('\n[1] disposition matrix — default policy');

const matrix = [
  ['CANCELLATION', { refundPrincipal: true, refundFee: false }, 'principal back, fee earned (off-market)'],
  ['EXPIRY', { refundPrincipal: true, refundFee: false }, 'same as cancellation'],
  ['SALE', { refundPrincipal: false, refundFee: false, applyPrincipalToSale: true }, 'principal → consideration, never revenue'],
  ['LISTING_WITHDRAWN', { refundPrincipal: true, refundFee: true }, 'we failed to deliver — both back'],
  ['SALE_ABORTED', { refundPrincipal: true, refundFee: false }, 'service was delivered'],
  ['FORFEITURE', { refundPrincipal: false, refundFee: false, forfeitPrincipal: true }, 'only path principal → revenue'],
];

for (const [event, expected, why] of matrix) {
  const got = holdService.resolveDisposition(event, POLICY);
  const match = Object.entries(expected).every(([k, v]) => got[k] === v);
  if (match) ok(`${event}: ${why}`);
  else bad(event, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}

// ------------------------------------------------------- policy flags honoured

console.log('\n[2] policy flags override defaults');

if (holdService.resolveDisposition('CANCELLATION', { ...POLICY, cancellationRefundable: false }).refundPrincipal === false)
  ok('cancellationRefundable=false keeps the principal');
else bad('cancellationRefundable=false', 'principal still refunded');

if (holdService.resolveDisposition('EXPIRY', { ...POLICY, expiryRefundable: false }).refundPrincipal === false)
  ok('expiryRefundable=false keeps the principal');
else bad('expiryRefundable=false', 'principal still refunded');

if (
  holdService.resolveDisposition('LISTING_WITHDRAWN', { ...POLICY, feeRefundableOnListingWithdrawal: false })
    .refundFee === false
)
  ok('feeRefundableOnListingWithdrawal=false keeps the fee');
else bad('feeRefundableOnListingWithdrawal=false', 'fee still refunded');

try {
  holdService.resolveDisposition('SOMETHING_ELSE', POLICY);
  bad('unknown event', 'did not throw');
} catch (e) {
  ok('unknown event throws');
}

// ------------------------------------------------------- dual control (§6.2)

console.log('\n[3] forfeiture dual control');

try {
  holdService.assertForfeitureDualControl('admin-1', 'admin-1');
  bad('same requester/approver', 'did not throw');
} catch (e) {
  ok('requester === approver throws');
}

try {
  holdService.assertForfeitureDualControl(null, 'admin-2');
  bad('missing requester', 'did not throw');
} catch (e) {
  ok('missing requester throws');
}

try {
  holdService.assertForfeitureDualControl('admin-1', 'admin-2');
  ok('two different admins pass');
} catch (e) {
  bad('two different admins', e.message);
}

// ------------------------------------------------------- transitions + BR-12

console.log('\n[4] hold transitions and the one-hold index (BR-12)');

try {
  holdService.assertHoldTransition('PENDING_PAYMENT', 'ACTIVE');
  ok('PENDING_PAYMENT → ACTIVE allowed');
} catch (e) {
  bad('PENDING_PAYMENT → ACTIVE', e.message);
}

try {
  holdService.assertHoldTransition('ACTIVE', 'PUBLISHED');
  bad('ACTIVE → PUBLISHED', 'did not throw');
} catch (e) {
  ok('ACTIVE → PUBLISHED rejected');
}

const indexes = RealEstatePropertyHold.schema.indexes();
const oneHold = indexes.find(
  ([spec, opts]) =>
    spec.property === 1 &&
    opts &&
    opts.unique === true &&
    opts.partialFilterExpression &&
    JSON.stringify(opts.partialFilterExpression.status.$in.sort()) === JSON.stringify(['ACTIVE', 'PENDING_PAYMENT'])
);
if (oneHold) ok('partial unique index on (property) for PENDING_PAYMENT/ACTIVE — two customers cannot hold one property');
else bad('one-hold partial unique index', 'not declared on the schema');

// ------------------------------------------------------- done

console.log('');
if (failed > 0) {
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL HOLD CHECKS PASSED');
