/**
 * verify.realestate.vendor.money.js — Phase D gate.
 *
 * The vendor's money view: analytics counters, sales commissions,
 * and sales. BR-02 is the load-bearing rule here — a vendor's
 * "earnings" view is the sales commission only, never summed with
 * package spend. The verify script asserts:
 *
 *   1. The 4 new routes are wired (analytics, commissions, sales,
 *      sales/:id).
 *   2. The commission filter is `beneficiaryType: 'VENDOR'` AND
 *      `beneficiary: vendor._id` — the only two values that are
 *      vendor money. Other beneficiary types (LOCALWALA, EXECUTIVE,
 *      REFERRER, BANK) must NOT appear in the result.
 *   3. The commission filter does NOT include LISTING_PACKAGE
 *      commissions — those are not vendor money, they are package
 *      spend (BR-02).
 *   4. The sale filter is the denormalised `vendor: vendor._id`
 *      field, not a join through property.
 *   5. The analytics endpoint counts across properties, leads,
 *      visits, holds, and sales with the right filters. The
 *      "liveHolds" count is restricted to PENDING_PAYMENT or
 *      ACTIVE — terminal states do not represent money in flight.
 *   6. No `:vendorId` in any new path (doc §7.1).
 *
 * Run: node scripts/verify.realestate.vendor.money.js
 */

const fs = require('fs');
const path = require('path');

const ROUTE = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'routes',
  'realestate.vendor.route.js'
);
const VALIDATION = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'validations',
  'realestate.vendor.validation.js'
);
const CONTROLLER = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'controllers',
  'realestate.vendor.controller.js'
);
const COMMISSION_SERVICE = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'services',
  'realestate.commission.service.js'
);
const SALE_SERVICE = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'services',
  'realestate.sale.service.js'
);

const V = require(VALIDATION);
const router = require(ROUTE);

const controllerText = fs.readFileSync(CONTROLLER, 'utf8');
const commissionText = fs.readFileSync(COMMISSION_SERVICE, 'utf8');
const saleText = fs.readFileSync(SALE_SERVICE, 'utf8');

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---- 1. The 4 new routes are wired. ----
const expectedPaths = ['/analytics', '/commissions', '/sales', '/sales/:id'];
const wired = router.stack
  .filter((l) => l.route)
  .map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path }));
const missing = expectedPaths.filter((p) => !wired.some((w) => w.path === p));
assert(
  '[1] all 4 vendor money routes are wired',
  missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : `wired: ${wired.length} vendor routes total`
);

// ---- 2. Commission filter is beneficiaryType:'VENDOR' AND beneficiary:vendorId. ----
const listFn = commissionText.match(
  /async function listForVendor\b[\s\S]+?(?=const realEstateCommissionService|module\.exports)/
);
assert(
  '[2a] listForVendor filters by beneficiaryType VENDOR',
  listFn && /beneficiaryType:\s*'VENDOR'/.test(listFn[0])
);
assert(
  '[2b] listForVendor filters by beneficiary === vendorId',
  listFn && /beneficiary:\s*vendorId/.test(listFn[0])
);

// ---- 3. Commission filter does NOT include LISTING_PACKAGE. ----
// BR-02: vendor money is sales commission only. LISTING_PACKAGE
// commissions are package spend — they live on /vendor/orders.
// Anchor on the function definition to skip doc-comment false matches.
const controllerListComm = controllerText.match(
  /const listMyCommissions\s*=\s*catchAsync[\s\S]+?\}\);/
);
assert(
  '[3a] vendor commissions endpoint delegates to commissionService.listForVendor',
  controllerListComm && /commissionService\.listForVendor\(\s*vendor\._id/.test(controllerListComm[0])
);
assert(
  '[3b] vendor commissions endpoint never references LISTING_PACKAGE',
  controllerListComm && !/LISTING_PACKAGE/.test(controllerListComm[0])
);

// ---- 4. Sale filter is the denormalised vendor field. ----
const listSalesFn = saleText.match(
  /async function listForVendor\b[\s\S]+?(?=const realEstateSaleService|module\.exports)/
);
assert(
  '[4] saleService.listForVendor uses the denormalised {vendor: vendorId} filter',
  listSalesFn && /filter = \{ vendor: vendorId \}/.test(listSalesFn[0])
);

// ---- 5. Analytics counters use the right filters. ----
const getAnalytics = controllerText.match(/getMyAnalytics[\s\S]+?res\.send\(/);
// The filter objects are built in variables (propertyFilter, leadFilter,
// liveHoldFilter) — count by name, not by the inline object.
assert(
  '[5a] getMyAnalytics defines a property filter by {vendor: vendor._id}',
  getAnalytics && /propertyFilter\s*=\s*\{ vendor: vendor\._id \}/.test(getAnalytics[0])
);
assert(
  '[5b] getMyAnalytics counts leads by {vendor: vendor._id}',
  getAnalytics && /RealEstateLead\.countDocuments\(\s*propertyFilter/.test(getAnalytics[0]) ||
    /RealEstateLead\.countDocuments\(\s*\{ vendor: vendor\._id \}/.test(getAnalytics[0])
);
assert(
  '[5c] getMyAnalytics counts holds with PENDING_PAYMENT or ACTIVE only',
  getAnalytics &&
    /status:\s*\{\s*\$in:\s*\['PENDING_PAYMENT',\s*'ACTIVE'\]\s*\}/.test(getAnalytics[0])
);
assert(
  '[5d] getMyAnalytics counts sales by {vendor: vendor._id}',
  getAnalytics && /RealEstateSale\.countDocuments\(\s*\{ vendor: vendor\._id \}/.test(getAnalytics[0])
);

// ---- 6. No `:vendorId` in any new path (doc §7.1). ----
const newPaths = wired
  .filter((w) => ['/analytics', '/commissions', '/sales', '/sales/:id'].includes(w.path))
  .map((w) => w.path);
const hasVendorId = newPaths.some((p) => /:vendorId/.test(p));
assert(
  '[6] no :vendorId in any new money path (doc §7.1)',
  !hasVendorId,
  hasVendorId ? 'a :vendorId leaked into a vendor route' : 'clean'
);

// ---- 7. The status enum on commissions is closed. ----
const { error: okErr } = V.raw.commissionsListQuery.validate({
  status: 'PENDING',
  page: 1,
  limit: 20,
});
const { error: badErr } = V.raw.commissionsListQuery.validate({
  status: 'PENDINGISH',
  page: 1,
  limit: 20,
});
assert(
  '[7] commission status enum is closed (PENDING ok, PENDINGISH rejected)',
  !okErr && /one of|valid/.test(badErr ? badErr.message : '')
);

// ---- Report ----
let failed = 0;
console.log('Vendor money (analytics/commissions/sales) — gate');
console.log('=================================================');
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
console.log(`ALL ${checks.length} VENDOR MONEY CHECKS PASSED`);
