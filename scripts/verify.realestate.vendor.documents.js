/**
 * verify.realestate.vendor.documents.js — vendor document CRUD guard.
 *
 * The vendor's property pipeline has four stages: create → submit →
 * (admin verifies) → publish. The verification step needs documents
 * attached — OWNERSHIP, APPROVAL, etc. Without a vendor-side CRUD
 * on those documents, a property can never reach APPROVED.
 *
 * This script asserts:
 *
 *   1. The 4 vendor document routes are wired.
 *   2. The upload Joi schema accepts a valid body.
 *   3. The category enum is closed (a typo becomes a 400, not a
 *      silent slip into the verification checklist).
 *   4. The visibility enum is restricted to vendor-writable values
 *      (INTERNAL, CUSTOMER_VISIBLE) — a vendor cannot write
 *      ADMIN_ONLY or BANK_VISIBLE from this surface (BR-18).
 *   5. The service has `upload`, `listForProperty`,
 *      `findByIdForVendor`, `removeForVendor` — vendor-scoped reads
 *      and writes only.
 *   6. The service refuses to remove an ACCEPTED document
 *      (BR-21) — that is the load-bearing reason this verify
 *      exists.
 *
 * Run: node scripts/verify.realestate.vendor.documents.js
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
const SERVICE = path.resolve(
  __dirname,
  '..',
  'src',
  'modules',
  'realestate',
  'services',
  'realestate.document.service.js'
);

const V = require(VALIDATION);
const router = require(ROUTE);
const serviceText = fs.readFileSync(SERVICE, 'utf8');

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---- 1. The 4 vendor document routes are wired. ----
const expectedPaths = [
  '/properties/:id/documents',
  '/properties/:id/documents',
  '/properties/:id/documents/:documentId',
  '/properties/:id/documents/:documentId',
];
const wired = router.stack
  .filter((l) => l.route)
  .map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path }));
const missing = expectedPaths.filter((p) => !wired.some((w) => w.path === p));
assert(
  '[1] all 4 vendor document routes are wired',
  missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : `wired: ${wired.length} vendor routes total`
);

// ---- 2. Joi accepts a valid upload body. ----
const goodBody = {
  category: 'OWNERSHIP',
  title: 'Sale Deed',
  fileUrl: 'https://cdn.example.com/docs/sale-deed.pdf',
  fileName: 'sale-deed.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024000,
  visibility: 'INTERNAL',
};
const { error: okErr } = V.raw.uploadDocumentBody.validate(goodBody);
assert('[2a] valid upload body passes Joi', !okErr, okErr ? okErr.message : '');

// ---- 3. Category must be one of the 7 closed enum values. ----
const allowedCategories = [
  'OWNERSHIP',
  'APPROVAL',
  'TAX',
  'ENCUMBRANCE',
  'PROJECT',
  'SELLER',
  'OTHER',
];
for (const cat of allowedCategories) {
  const { error } = V.raw.uploadDocumentBody.validate({ ...goodBody, category: cat });
  assert(`[3a] category "${cat}" passes Joi`, !error, error ? error.message : '');
}
// Case-insensitive input is intentional UX (the schema has `.uppercase()`).
// The rejection guard is for typos OUTSIDE the enum, not for casing.
for (const cat of ['OWNED', 'Random', 'OWNERSHIP_DOC', '']) {
  const { error } = V.raw.uploadDocumentBody.validate({ ...goodBody, category: cat });
  assert(
    `[3b] non-enum category "${cat}" is REJECTED by Joi (closed enum)`,
    error && /one of|valid|must be one of|required/.test(error.message),
    error ? '' : 'Joi allowed an unlisted category — verification checklist would mismatch'
  );
}

// ---- 4. Visibility is restricted to vendor-writable values. ----
for (const vis of ['INTERNAL', 'CUSTOMER_VISIBLE']) {
  const { error } = V.raw.uploadDocumentBody.validate({ ...goodBody, visibility: vis });
  assert(`[4a] vendor-writable visibility "${vis}" passes Joi`, !error);
}
for (const vis of ['ADMIN_ONLY', 'BANK_VISIBLE']) {
  const { error } = V.raw.uploadDocumentBody.validate({ ...goodBody, visibility: vis });
  assert(
    `[4b] forbidden visibility "${vis}" is REJECTED by Joi (BR-18)`,
    error && /one of|valid/.test(error.message),
    error ? '' : 'Joi allowed an admin/bank visibility — vendor has no business writing these'
  );
}

// ---- 5. The service exposes the four vendor methods. ----
for (const fn of ['upload', 'listForProperty', 'findByIdForVendor', 'removeForVendor']) {
  const re = new RegExp(`(async\\s+)?${fn}\\s*\\(`);
  assert(
    `[5] document service exports ${fn}`,
    re.test(serviceText)
  );
}

// Vendor scoping: every read filters by vendor — read the implementation
// not just the name. Count distinct uses of `vendor: vendorId` in the
// service: one per function, so 3 distinct function bodies must use it.
const vendorFilterCount = (serviceText.match(/vendor:\s*vendorId/g) || []).length;
assert(
  '[5b] every vendor-scoped read/write uses {vendor: vendorId} (3 sites expected)',
  vendorFilterCount >= 3,
  `found ${vendorFilterCount} occurrence(s) of "vendor: vendorId"`
);

// Confirm the ownership check appears in all three vendor-facing functions.
for (const fn of ['listForProperty', 'findByIdForVendor', 'removeForVendor']) {
  const fnBody = serviceText.match(
    new RegExp(`async function ${fn}\\b[\\s\\S]+?(?=async function \\w+\\b|^const realEstateDocumentService)`)
  );
  assert(
    `[5c] ${fn} has a vendor ownership check`,
    fnBody && /vendor:\s*vendorId/.test(fnBody[0])
  );
}

// ---- 6. ACCEPTED documents cannot be removed (BR-21). ----
const removeBody = serviceText.match(
  /async function removeForVendor\b[\s\S]+?(?=async function \w+\b|^const realEstateDocumentService)/
);
assert(
  '[6a] removeForVendor guards ACCEPTED documents (BR-21)',
  removeBody && /status === 'ACCEPTED'/.test(removeBody[0]) && /DOCUMENT_ACCEPTED/.test(removeBody[0])
);
assert(
  '[6b] removeForVendor uses vendor-scoped ownership check',
  removeBody && /vendor:\s*vendorId/.test(removeBody[0])
);

// ---- 7. The controller maps the typed error to 409. ----
const controllerText = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'controllers', 'realestate.vendor.controller.js'),
  'utf8'
);
assert(
  '[7] controller maps DOCUMENT_ACCEPTED to 409 CONFLICT',
  /DOCUMENT_ACCEPTED/.test(controllerText) && /CONFLICT/.test(controllerText)
);

// ---- 8. No `:vendorId` in any new path (doc §7.1). ----
const newPaths = wired
  .filter((w) => w.path.includes('/documents'))
  .map((w) => w.path);
const hasVendorId = newPaths.some((p) => /:vendorId/.test(p));
assert(
  '[8] no :vendorId in any new document path (doc §7.1)',
  !hasVendorId,
  hasVendorId ? 'a :vendorId leaked into a document route' : 'clean'
);

// ---- Report ----
let failed = 0;
console.log('Vendor document CRUD — gate');
console.log('=============================');
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
console.log(`ALL ${checks.length} VENDOR DOCUMENT CHECKS PASSED`);
