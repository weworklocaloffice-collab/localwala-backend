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
 * verify.all.stores.js — runs every Local Stores suite in one process.
 *
 * ## Why the suites are not just chained with `&&`
 *
 * Each suite opens and closes its own Mongo connection and exits. Chaining them in
 * PowerShell stops at the first failure and hides the rest, which is the worst
 * possible behaviour for a security-sensitive vertical: one tenancy failure shouldn't
 * stop you learning that the money fields are also broken.
 *
 * So this runs every suite regardless, collects exit codes, and prints one verdict.
 * A failure is a failure either way — this is about reporting, not tolerance.
 *
 * Run: node scripts/verify.all.stores.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  { file: 'verify.stores.tenancy.js', title: 'Tenancy and outlet scoping' },
  { file: 'verify.stores.onboarding.steps.js', title: 'Onboarding step-count invariants' },
  { file: 'verify.stores.staff.js', title: 'Staff assignment and escalation ladder' },
  { file: 'verify.stores.onboarding.js', title: 'Onboarding lifecycle' },
  { file: 'verify.stores.chains.js', title: 'Chain registry' },
  { file: 'verify.stores.taxconfig.js', title: 'Tax configuration / BR-41' },
  { file: 'verify.stores.subscription.js', title: 'Chain subscription and billing lifecycle' },
  { file: 'verify.stores.geography.js', title: 'Shared geography (UserAddress, Locality)' },
  { file: 'verify.locality.backcompat.js', title: 'Locality back-compat (food/dairy safety)' },
  { file: 'verify.stores.lifecycle.js', title: 'Lifecycle, capabilities and COD' },
  { file: 'verify.stores.roles.js', title: 'Scoped RBAC and privilege escalation' },
  { file: 'verify.stores.vertical.js', title: 'Vertical wiring' },
  { file: 'verify.stores.payments.js', title: 'Gateway subjects (storeOrders, storeSubscription)' },
  { file: 'verify.stores.cod.js', title: 'COD checkout ladder and limits' },
  { file: 'verify.stores.inventory.js', title: 'Inventory ledger, reservations and BR-30 oversell guard' },
  { file: 'verify.stores.orders.js', title: 'Order lifecycle, BR-28 component refunds, BR-33 ceiling, BR-43 invoices' },
  { file: 'verify.stores.settlements.js', title: 'Settlement generation, BR-18/BR-42, kernel stores|dairy separation' },
  { file: 'verify.stores.delivery.js', title: 'Store-owned delivery, BR-29 OTP handover, BR-39 COD ladder' },
  { file: 'verify.stores.catalog.js', title: 'Product form, BR-11 dynamic attributes, BR-26 config categories, BR-25 archive' },
  { file: 'verify.stores.returns.js', title: 'BR-19/BR-20 returns and exchanges, returned stock rejoins inventory' },
  { file: 'verify.stores.admin.routes.js', title: 'Admin surface mounted, guarded, and not shadowed' },
  { file: 'verify.stores.postman.js', title: 'Postman collection matches the live stores surface (trap T2)' },
  { file: 'verify.stores.refunds.js', title: 'Refunds console reads, paging, and the failed queue' },
  { file: 'verify.stores.api.contract.js', title: 'Client-vs-server match, BR-38 tenant audit, no duplicate routes' },
  { file: 'verify.stores.remittance.js', title: 'COD cash reconciliation: expected, variance, dispute, idempotent reconcile' },
  { file: 'verify.stores.promotions.js', title: 'Discount math for all five types, promo gate, usage counting' },
  { file: 'verify.stores.picking.js', title: 'Pick list scoping, BR-31 substitutions, packing, partial economics' },
  { file: 'verify.stores.support.js', title: 'Complaint and warranty tables, ORDER_NOT_OWNED, outlet scoping' },
  { file: 'verify.stores.featured.js', title: 'Paid-before-approval gate, outlet scoping, live and pending queries' },
  { file: 'verify.stores.basket.js', title: 'Server-side totals, BR-36 outlet pricing, promos, fees, COD and minimum gates' },
  { file: 'verify.stores.cart.js', title: 'BR-37 one outlet per cart, BR-27 eligibility with machine-readable reasons' },
  { file: 'verify.stores.policy.js', title: 'Policy defaults, outlet scoping, soft archive, version notes' },
  { file: 'verify.stores.customer.subscriptions.js', title: 'Lifecycle table, plan gates, pause/resume/skip/cancel, scoping' },
  { file: 'verify.stores.admin.js', title: 'Taxonomy remove guards, operations consoles, cross-tenant reads' },
  { file: 'verify.stores.notify.js', title: 'Template filling, event payloads, graceful no-FCM degradation' },
  { file: 'verify.stores.organic.js', title: 'Badge driven by valid certs, expiry sweep clears it, expiry watch' },
  { file: 'verify.stores.reviews.js', title: 'One review per triple, verified purchase, approved-only outlet average' },
  { file: 'verify.stores.analytics.js', title: 'Dashboard zeros, window sums, stock counts, approved-only reviews, costed inventory value' },
  { file: 'verify.stores.driver.js', title: 'BR-06/07 fleet lifecycle, reactivation returns drivers to dispatch' },
  { file: 'verify.stores.invoice.js', title: 'BR-43 invoice numbers: format, per-outlet series, concurrency, FY boundary' },

  // §8.4 — real HTTP customer journey against a live server. Added after the known
  // defects were wired (BR-13 cross-outlet guard, BR-28/33 component refund on cancel,
  // BR-30 reserve/commit/release stock). This is the green gate before starting the
  // Partner app.
  { file: 'verify.stores.http.customer.js', title: 'HTTP customer journey (real server)' },

  // Eleven endpoints were routed to the WRONG handler — Express resolves to the first
  // match, and each of these was a literal path declared after a sibling carrying a
  // parameter in that position. Every one answered `500 CastError` instead of data, and
  // the two driver ones meant a delivery could complete WITHOUT the customer's OTP being
  // verified (BR-29 unenforced over HTTP). No service-level suite could see this, because
  // reachability is a property of the assembled router and nothing assembled it.
  { file: 'verify.stores.route.reachability.js', title: 'Route reachability (no endpoint captured by an earlier route)' },
];

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

const results = [];

for (const suite of SUITES) {
  console.log('\n' + '='.repeat(72));
  console.log(suite.title + '  (' + suite.file + ')');
  console.log('='.repeat(72));

  // eslint-disable-next-line no-await-in-loop
  const run = spawnSync(process.execPath, [path.join(__dirname, suite.file)], {
    stdio: 'inherit',
    env: process.env,
  });

  const code = run.status === null ? 1 : run.status;
  results.push({ ...suite, code });
}

console.log('\n' + '='.repeat(72));
console.log('LOCAL STORES VERIFICATION');
console.log('='.repeat(72));

let failed = 0;
for (const r of results) {
  const okSuite = r.code === 0;
  if (!okSuite) failed += 1;
  const tag = okSuite ? GREEN + ' PASS ' + RESET : RED + ' FAIL ' + RESET;
  console.log('  ' + tag + '  ' + r.title + DIM + '   ' + r.file + RESET);
}

console.log('');

if (failed) {
  console.log(RED + failed + ' of ' + results.length + ' suites FAILED.' + RESET);
  console.log('The local stores vertical is NOT in a shippable state.');
  process.exit(1);
}

console.log(GREEN + 'All ' + results.length + ' suites passed.' + RESET);
process.exit(0);