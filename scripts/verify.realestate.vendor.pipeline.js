/**
 * verify.realestate.vendor.pipeline.js — vendor read-only views.
 *
 * Phase C: leads, visits, holds, customers on the vendor's own
 * listings.
 *
 * Without these, a vendor who has just had an enquiry or a hold
 * placed on their listing has no way to see it. The endpoints are
 * read-only — every state-changing operation (lead assignment,
 * visit lifecycle, hold creation) is owned by the customer or
 * executive surface, not the vendor.
 *
 * Asserts:
 *   1. The 6 new routes are wired.
 *   2. The lead list filter is `{ vendor: vendorId }` — direct
 *      because the lead model carries a denormalised vendor field.
 *   3. The visit list filter resolves through the property chain:
 *      `property: { $in: vendorPropertyIds }`. Cross-vendor reads
 *      return 404, never 403, so the endpoint is not an IDOR.
 *   4. The hold list filter is `property: { $in: vendorPropertyIds }`.
 *   5. The customers list is a distinct-union of lead.vendor and
 *      visit.property — not a separate table.
 *   6. The status enums on each list endpoint are closed — a typo
 *      becomes a 400, not a silent miss.
 *
 * Run: node scripts/verify.realestate.vendor.pipeline.js
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
const LEAD_SERVICE = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'services',
  'realestate.lead.service.js'
);
const VISIT_SERVICE = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'services',
  'realestate.visit.service.js'
);
const HOLD_SERVICE = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'services',
  'realestate.hold.service.js'
);

const V = require(VALIDATION);
const router = require(ROUTE);

const controllerText = fs.readFileSync(CONTROLLER, 'utf8');
const leadText = fs.readFileSync(LEAD_SERVICE, 'utf8');
const visitText = fs.readFileSync(VISIT_SERVICE, 'utf8');
const holdText = fs.readFileSync(HOLD_SERVICE, 'utf8');

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---- 1. The 6 new routes are wired. ----
const expectedPaths = [
  '/leads',
  '/leads/:id',
  '/visits',
  '/visits/:id',
  '/holds',
  '/customers',
];
const wired = router.stack
  .filter((l) => l.route)
  .map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path }));
const missing = expectedPaths.filter((p) => !wired.some((w) => w.path === p));
assert(
  '[1] all 6 vendor pipeline routes are wired',
  missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : `wired: ${wired.length} vendor routes total`
);

// ---- 2. Lead list filter is {vendor: vendorId} (direct). ----
const listLeadsBody = controllerText.match(/listMyLeads[\s\S]+?res\.send\(/);
assert(
  '[2] listMyLeads passes {vendor: vendor._id} to leadService.findLeads',
  listLeadsBody && /findLeads\(\s*\{[^}]*vendor:\s*vendor\._id/.test(listLeadsBody[0])
);

// ---- 3. Visit list filter goes through the property chain. ----
assert(
  '[3a] visitService.findVisits accepts a vendor filter (property chain)',
  /if\s*\(filters\.vendor\)[\s\S]+?RealEstateProperty\.find\(\s*\{[\s\S]+?vendor:\s*filters\.vendor/.test(
    visitText
  )
);
const listVisitsBody = controllerText.match(/listMyVisits[\s\S]+?res\.send\(/);
assert(
  '[3b] listMyVisits passes {vendor: vendor._id} to visitService.findVisits',
  listVisitsBody && /findVisits\(\s*\{[^}]*vendor:\s*vendor\._id/.test(listVisitsBody[0])
);

// Cross-vendor visits return 404, never 403.
const getMyVisitBody = controllerText.match(/getMyVisit[\s\S]+?res\.send\(/);
assert(
  '[3c] getMyVisit checks ownership and 404s on cross-vendor reads',
  getMyVisitBody &&
    /findOne\(\s*\{[^}]*_id:\s*visit\.property[\s\S]+?vendor:\s*vendor\._id/.test(getMyVisitBody[0]) &&
    /NOT_FOUND/.test(getMyVisitBody[0])
);

// ---- 4. Hold list filter goes through the property chain. ----
assert(
  '[4a] holdService.listForVendor queries properties for vendor first',
  /async function listForVendor\b[\s\S]+?RealEstateProperty\.find\(\s*\{[\s\S]+?vendor:\s*vendorId/.test(
    holdText
  )
);
const listHoldsBody = controllerText.match(/listMyHolds[\s\S]+?res\.send\(/);
assert(
  '[4b] listMyHolds delegates to holdService.listForVendor',
  listHoldsBody && /listForVendor\(\s*vendor\._id/.test(listHoldsBody[0])
);

// ---- 5. Customers list is a distinct-union of leads + visits. ----
const listCustomersBody = controllerText.match(/listMyCustomers[\s\S]+?res\.send\(/);
assert(
  '[5a] listMyCustomers distinct()s leads by customer',
  listCustomersBody && /RealEstateLead\.distinct\('customer'/.test(listCustomersBody[0])
);
assert(
  '[5b] listMyCustomers distinct()s visits by customer',
  listCustomersBody && /RealEstateVisit\.distinct\('customer'/.test(listCustomersBody[0])
);
assert(
  '[5c] listMyCustomers dedupes with a Set (preserves first-seen order)',
  listCustomersBody && /new Set\(/.test(listCustomersBody[0])
);

// ---- 6. The status enums on each list endpoint are closed. ----
// Sample one value per enum to confirm Joi accepts it, and one bad value to confirm rejection.
const probe = (schema, goodValue, badValue) => {
  const { error: okErr } = V.raw[schema].validate({ status: goodValue, page: 1, limit: 20 });
  const { error: badErr } = V.raw[schema].validate({ status: badValue, page: 1, limit: 20 });
  return !okErr && /one of|valid/.test(badErr ? badErr.message : '');
};
assert(
  '[6a] lead status enum is closed',
  probe('leadsListQuery', 'NEW', 'NEWISH')
);
assert(
  '[6b] visit status enum is closed',
  probe('visitsListQuery', 'COMPLETED', 'COMPLETEDISH')
);
assert(
  '[6c] hold status enum is closed',
  probe('holdsListQuery', 'ACTIVE', 'ACTIVISH')
);

// ---- 7. No `:vendorId` in any new path (doc §7.1). ----
const newPaths = wired
  .filter((w) =>
    ['/leads', '/leads/:id', '/visits', '/visits/:id', '/holds', '/customers'].includes(w.path)
  )
  .map((w) => w.path);
const hasVendorId = newPaths.some((p) => /:vendorId/.test(p));
assert(
  '[7] no :vendorId in any new pipeline path (doc §7.1)',
  !hasVendorId,
  hasVendorId ? 'a :vendorId leaked into a vendor route' : 'clean'
);

// ---- Report ----
let failed = 0;
console.log('Vendor pipeline (leads/visits/holds/customers) — gate');
console.log('=======================================================');
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
console.log(`ALL ${checks.length} VENDOR PIPELINE CHECKS PASSED`);
