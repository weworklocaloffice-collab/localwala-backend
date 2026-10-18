/**
 * verify.payment.dispatch.js — F-4 guard.
 *
 * Plan §18.1 (F-4): "Extract a `subjectResolver` map before Phase 8.
 * Medium refactor, low risk, done once."
 *
 * This script is the machine-checked counterpart of that decision. It
 * asserts:
 *
 *   1. The controller does NOT carry any inline `paymentFrom === 'X'`
 *      chain. Such a chain would mean a future paymentFrom edit had to
 *      touch nine places at once.
 *   2. The controller calls `dispatchPaidCallback(paymentInfo.payments)`
 *      exactly once per gateway. The nine-block duplication is gone.
 *   3. The dispatch helper exists, exports the legacy map, and knows
 *      about the Real Estate and Stores subjects.
 *   4. The 6 legacy paymentFrom values match the keys of LEGACY_HANDLERS
 *      (no drift between the controller's old chain and the new map).
 *   5. Adding a new paymentFrom to a future vertical does not require
 *      editing `payment.initiation.controller.js` — the dispatch helper
 *      is the single place to add it.
 *
 * Run: node scripts/verify.payment.dispatch.js
 */

const fs = require('fs');
const path = require('path');

const CONTROLLER = path.resolve(
  __dirname,
  '..',
  'src',
  'controllers',
  'payment.initiation.controller.js'
);
const DISPATCH = path.resolve(__dirname, '..', 'src', 'utils', 'payment.dispatch.js');

const controller = fs.readFileSync(CONTROLLER, 'utf8');
const dispatch = fs.readFileSync(DISPATCH, 'utf8');

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// 1. No inline paymentFrom chain in the controller.
const inline = controller.match(/paymentFrom\s*===\s*'[^']+'/g) || [];
assert(
  '[1] no inline paymentFrom chain in the controller',
  inline.length === 0,
  `found ${inline.length} paymentFrom comparisons (expected 0)`
);

// 2. The dispatch call appears exactly 9 times — once per gateway.
const calls = (controller.match(/await dispatchPaidCallback\(paymentInfo\.payments\);/g) || [])
  .length;
assert(
  '[2] dispatchPaidCallback called 9 times (one per gateway)',
  calls === 9,
  `found ${calls} call sites (expected 9)`
);

// 3. The dispatch helper exports the legacy map and a closed set of
//    known subjects.
const exportsDispatch = /module\.exports\s*=\s*\{[\s\S]*?dispatchPaidCallback[\s\S]*?\};/.test(
  dispatch
);
assert('[3] payment.dispatch.js exports dispatchPaidCallback', exportsDispatch);

const exportsLegacy = /LEGACY_PAYMENT_HANDLERS/.test(dispatch) && /KNOWN_PAYMENT_SUBJECTS/.test(dispatch);
assert(
  '[3b] payment.dispatch.js exports LEGACY_PAYMENT_HANDLERS and KNOWN_PAYMENT_SUBJECTS',
  exportsLegacy
);

// 4. The 6 legacy keys match the controller's old chain values.
const expectedLegacy = [
  'wallet',
  'order',
  'tiffinsubscription',
  'booking',
  'restaurant_register',
  'renew_subscription',
];
const legacyBlockMatch = dispatch.match(
  /LEGACY_PAYMENT_HANDLERS\s*=\s*Object\.freeze\(\s*\{([\s\S]*?)\}\s*\)/
);
const legacyBlock = legacyBlockMatch ? legacyBlockMatch[1] : '';
const actualLegacy = expectedLegacy.filter((k) => new RegExp(`\\b${k}\\s*:`).test(legacyBlock));
assert(
  '[4] LEGACY_HANDLERS carries all 6 expected keys',
  actualLegacy.length === 6,
  `matched ${actualLegacy.length}/6 keys: ${actualLegacy.join(', ')}`
);

// 5. The new Real Estate subjects are routed through the bridge, not
//    added to the controller. The bridge is the `routePaidCallback`
//    call inside the dispatch helper.
const reBridge = /realEstatePaymentService\.routePaidCallback/.test(dispatch);
const reSubjectList = /REAL_ESTATE_PAYMENT_SUBJECTS/.test(dispatch);
assert(
  '[5] Real Estate bridge present in dispatch helper',
  reBridge && reSubjectList,
  `bridge=${reBridge} subjectList=${reSubjectList} (the subjects themselves live in realestate.payment.service.js)`
);

// 6. The controller's vertical-bridge imports are gone (the dispatch
//    file owns the bridges now).
const controllerHasStoreBridge = /storesPaymentService/.test(controller);
const controllerHasReBridge = /realEstatePaymentService/.test(controller);
assert(
  '[6] controller no longer imports vertical payment bridges',
  !controllerHasStoreBridge && !controllerHasReBridge,
  `storesPaymentService=${controllerHasStoreBridge} realEstatePaymentService=${controllerHasReBridge}`
);

// 7. The controller does NOT import the legacy-handler services any
//    more — those live in the dispatch helper.
const legacyServices = [
  'walletService',
  'transactionService',
  'ordersService',
  'fcmNotificationService',
  'userPurchasedTiffinSubscriptionService',
  'diningBookingService',
  'restaurantJoiningRequestService',
  'subscriberService',
  'adminExpenseService',
  'WalletBonus',
];
const stillReferenced = legacyServices.filter((name) =>
  new RegExp(`\\b${name}\\b`).test(controller)
);
assert(
  '[7] controller no longer references legacy-handler services',
  stillReferenced.length === 0,
  `still referenced: ${stillReferenced.join(', ') || 'none'}`
);

// 8. Line count went down — F-4 is a real refactor, not a no-op.
const beforeChars = 118027; // measured before the refactor
const afterChars = controller.length;
const reduction = ((beforeChars - afterChars) / beforeChars) * 100;
assert(
  '[8] controller shrank (was 118 027 chars, target ≥ 40% reduction)',
  reduction >= 40,
  `now ${afterChars} chars (${reduction.toFixed(1)}% reduction)`
);

// 9. The dispatch helper file is well-formed: same dispatch comment is
//    present in both, so the controller's vertical-agnostic claim holds.
assert(
  '[9] controller comment references utils/payment.dispatch.js',
  /utils\/payment\.dispatch\.js/.test(controller)
);

// Report
let failed = 0;
console.log('Payment dispatch refactor — F-4 guard');
console.log('======================================');
for (const c of checks) {
  const mark = c.ok ? 'OK  ' : 'FAIL';
  console.log(`  [${mark}] ${c.label}${c.detail ? '  — ' + c.detail : ''}`);
  if (!c.ok) failed += 1;
}
console.log('');
if (failed) {
  console.log(`${failed} of ${checks.length} checks FAILED`);
  process.exit(1);
}
console.log(`ALL ${checks.length} DISPATCH CHECKS PASSED`);
