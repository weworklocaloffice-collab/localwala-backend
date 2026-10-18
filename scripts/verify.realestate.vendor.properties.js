/**
 * verify.realestate.vendor.properties.js — vendor property CRUD guard.
 *
 * The plan called for 38 vendor routes. Until this session the vendor
 * surface had only 11 — auth + packages + orders. A vendor could
 * register, buy a package and… nothing. The property CRUD (create,
 * list, get, update, submit, withdraw, status transition) is the
 * load-bearing gap; without it BR-02 and BR-05 are defined but
 * unreachable from any UI.
 *
 * This script asserts:
 *
 *   1. The 7 new property routes are wired.
 *   2. The Joi schemas accept a valid create body and reject every
 *      way a vendor could attempt to set admin-only fields
 *      (`source`, `vendor`, `status`, `availability`).
 *   3. The status transition route is Joi-allow-listed to vendor-only
 *      targets. Admin-only targets return 400, not 422, not a 500.
 *   4. The property service has a `listForVendor` and a
 *      `findByIdForVendor` — the controller reaches the data only
 *      through vendor-scoped reads.
 *   5. No `:vendorId` appears in any of the new paths (doc §7.1).
 *
 * Run: node scripts/verify.realestate.vendor.properties.js
 */

const fs = require('fs');
const path = require('path');
const Joi = require('joi');

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
  'realestate.property.service.js'
);

const routeText = fs.readFileSync(ROUTE, 'utf8');
const validationText = fs.readFileSync(VALIDATION, 'utf8');
const serviceText = fs.readFileSync(SERVICE, 'utf8');
const V = require(VALIDATION);
const router = require(ROUTE);

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---- 1. The 7 new property routes are wired. ----
const expectedPaths = [
  '/properties',
  '/properties',
  '/properties/:id',
  '/properties/:id',
  '/properties/:id/submit',
  '/properties/:id/withdraw',
  '/properties/:id/status/:status',
];
const wired = router.stack
  .filter((l) => l.route)
  .map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path }));
const missing = expectedPaths.filter(
  (p) => !wired.some((w) => w.path === p)
);
assert(
  '[1] all 7 vendor property routes are wired',
  missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : `wired: ${wired.length} vendor routes total`
);

// ---- 2. Joi accepts a valid create body. ----
const goodCreate = {
  title: '3BHK Apartment in Madhapur',
  description: 'Spacious flat near the metro',
  transactionType: 'BUY',
  price: 8500000,
  category: '507f1f77bcf86cd799439011',
  location: {
    addressLine: 'Plot 12, Madhapur',
    locality: '507f1f77bcf86cd799439011',
    city: '507f1f77bcf86cd799439011',
    state: '507f1f77bcf86cd799439011',
    country: '507f1f77bcf86cd799439011',
    pincode: '500081',
    coordinates: [78.3868, 17.4486],
  },
  specs: { bedrooms: 3, area: 1450 },
  amenities: ['LIFT', 'GYM'],
};
const { error: createErr } = V.raw.createPropertyBody.validate(goodCreate);
assert(
  '[2a] valid create body passes Joi',
  !createErr,
  createErr ? createErr.message : ''
);

// ---- 2b. Joi rejects forbidden top-level fields (source, vendor, status). ----
const badCreate = {
  ...goodCreate,
  source: 'LOCALWALA_DIRECT', // vendor must not set source
  vendor: '507f1f77bcf86cd799439099', // vendor must not set vendor
  status: 'PUBLISHED', // create hard-codes DRAFT
  availability: 'SOLD', // create hard-codes AVAILABLE
};
const { error: forbidErr } = V.raw.createPropertyBody.validate(badCreate);
assert(
  '[2b] forbidden fields (source, vendor, status, availability) rejected by Joi',
  forbidErr && forbidErr.message.includes('not allowed'),
  forbidErr ? forbidErr.message : 'Joi did not reject the forbidden fields'
);

// ---- 2c. Coordinates validation: must be 2 numbers, not 3, not [0,0] is a service-layer concern. ----
const badCoords = { ...goodCreate, location: { ...goodCreate.location, coordinates: [78.4] } };
const { error: coordErr } = V.raw.createPropertyBody.validate(badCoords);
assert(
  '[2c] coordinates must be exactly [lng, lat]',
  coordErr && /exactly two numbers/.test(coordErr.message),
  coordErr ? coordErr.message : 'Joi did not reject a 1-element coordinate'
);

// ---- 3. Status transition Joi is allow-listed to vendor-only targets. ----
const allowedTargets = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUIRED', 'ARCHIVED'];
for (const target of allowedTargets) {
  const { error } = V.raw.propertyStatusParam.validate({
    id: '507f1f77bcf86cd799439011',
    status: target,
  });
  assert(
    `[3a] vendor-reachable target "${target}" passes Joi`,
    !error,
    error ? error.message : ''
  );
}
const adminOnly = ['APPROVED', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'EXPIRED', 'SOLD', 'RENTED'];
for (const target of adminOnly) {
  const { error } = V.raw.propertyStatusParam.validate({
    id: '507f1f77bcf86cd799439011',
    status: target,
  });
  assert(
    `[3b] admin-only target "${target}" is REJECTED by Joi (no 500, no 422 — fails closed at the boundary)`,
    error && /one of/.test(error.message),
    error ? '' : 'Joi allowed an admin-only target — that is the BR-03 hole'
  );
}

// ---- 4. The property service exposes the vendor-scoped methods. ----
assert(
  '[4a] property service exports listForVendor',
  /async listForVendor\s*\(/.test(serviceText)
);
assert(
  '[4b] property service exports findByIdForVendor',
  /async findByIdForVendor\s*\(/.test(serviceText)
);

// listForVendor must filter by vendor — read the implementation, not just the name.
const listForVendorImpl = serviceText.match(
  /async listForVendor[\s\S]+?\},[\s\S]+?async findByIdForVendor/
);
assert(
  '[4c] listForVendor filters by vendor: { vendor: vendorId }',
  listForVendorImpl && /vendor:\s*vendorId/.test(listForVendorImpl[0])
);
assert(
  '[4d] findByIdForVendor scopes to {_id, vendor}',
  /async findByIdForVendor[\s\S]+?_id:\s*id,\s*vendor:\s*vendorId/.test(serviceText)
);

// ---- 5. No `:vendorId` in any new path. ----
const newPaths = wired
  .filter((w) => w.path.startsWith('/properties'))
  .map((w) => w.path);
const hasVendorId = newPaths.some((p) => /:vendorId/.test(p));
assert(
  '[5] no :vendorId in any new property path (doc §7.1)',
  !hasVendorId,
  hasVendorId ? 'a :vendorId leaked into a vendor route — IDOR risk' : 'clean'
);

// ---- 6. The full suite still loads. ----
assert(
  '[6] vendor route file still loads',
  router && Array.isArray(router.stack)
);

// ---- 7. The create body carries location nested, without state/country. ----
//
// No client can resolve State/Country ids, so the service derives `state`
// from the zone (BR-19 pattern) and the schema no longer requires it.
// A body without either must pass validation.
const nestedBody = {
  title: 'Gate Nested Villa',
  transactionType: 'BUY',
  price: 5000000,
  category: '691234567890123456789012',
  location: {
    locality: '691234567890123456789013',
    city: '691234567890123456789014',
    coordinates: [78.4, 17.4],
  },
};
const nestedErr = V.createProperty.body.validate(nestedBody).error;
assert(
  '[7a] create body without state/country passes Joi',
  !nestedErr,
  nestedErr ? nestedErr.message : 'state + country optional, locality/city/coordinates required'
);
assert(
  '[7b] service normalizes the nested location to top-level refs',
  /payload\.location/.test(serviceText),
  'create() must read locality/city/state/country from payload.location'
);

// ---- 10. Live DB: a controller-shaped payload creates a DRAFT. ----
//
// Before the nested-location fix this exact payload died in Mongoose
// validation (top-level locality/city/state absent) — while the gates
// stayed green, because they called the service with flat payloads.
async function liveDbChecks() {
  const mongoose = require('mongoose');
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) {
    assert('[10] live DB section', false, 'MONGODB_URL not set — skipped?');
    return;
  }
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  try {
    const RealEstatePropertyCategory = require(path.join(
      __dirname, '..', 'src', 'modules', 'realestate', 'models', 'realestate.property.category.model.js'
    ));
    const RealEstateProperty = require(path.join(
      __dirname, '..', 'src', 'modules', 'realestate', 'models', 'realestate.property.model.js'
    ));
    const propertyService = require(path.join(
      __dirname, '..', 'src', 'modules', 'realestate', 'services', 'realestate.property.service.js'
    ));

    const stamp = Date.now();
    const vendorId = new mongoose.Types.ObjectId();
    const localityId = new mongoose.Types.ObjectId();
    const cityId = new mongoose.Types.ObjectId();
    const category = await RealEstatePropertyCategory.create({
      key: `GATE${stamp}`,
      name: `Gate Villas ${stamp}`,
      specSchema: { fields: [] },
    });

    let property = null;
    try {
      property = await propertyService.create(
      {
        // Shaped exactly like the vendor controller builds it:
        // validated body + source/vendor attached by the route.
        title: 'Gate Nested Villa',
        transactionType: 'BUY',
        price: 5000000,
        category: category._id,
        location: {
          addressLine: 'Gate Road 1',
          locality: localityId,
          city: cityId,
          coordinates: [78.4, 17.4],
        },
        specs: {},
        amenities: [],
        source: 'VENDOR',
        vendor: vendorId,
        projectName: 'Gate Heights',
        builderName: 'Gate Builders',
      },
      { _id: vendorId, actorType: 'vendor' }
    );

    assert('[10a] nested-location payload creates a DRAFT', property.status === 'DRAFT', `status=${property.status}`);
    assert(
      '[10b] top-level refs copy from the nested location',
      String(property.locality) === String(localityId) && String(property.city) === String(cityId),
      `locality=${property.locality} city=${property.city}`
    );
    assert(
      '[10c] property code allocated (city prefix falls back to IND without a city doc)',
      /^RE-[A-Z]{3}-[A-Z0-9]{6}$/.test(property.propertyCode),
      `code=${property.propertyCode}`
    );
    assert(
      '[10d] GeoJSON completed to Point so radius search matches',
      property.location && property.location.type === 'Point',
      `type=${property.location && property.location.type}`
    );
    assert(
      '[10e] project/builder names persist (were silently dropped before)',
      property.projectName === 'Gate Heights' && property.builderName === 'Gate Builders',
      `project=${property.projectName} builder=${property.builderName}`
    );
  } finally {
    if (property) await RealEstateProperty.deleteOne({ _id: property._id });
    await RealEstatePropertyCategory.deleteOne({ _id: category._id });
  }
  } finally {
    await mongoose.disconnect();
  }
}

// ---- Report ----
liveDbChecks()
  .catch((e) => {
    assert('[10] live DB section', false, e.message);
  })
  .then(() => {
    let failed = 0;
    console.log('Vendor property CRUD — gate');
    console.log('============================');
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
    console.log(`ALL ${checks.length} VENDOR PROPERTY CHECKS PASSED`);
  });
