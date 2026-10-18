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
 * verify.stores.vertical.js — the wiring test.
 *
 * ## Why this suite exists
 *
 * A `Vertical` document is a REGISTRY ROW. Seeding `key: 'stores'` creates a row that
 * looks real and does nothing at all. What makes a vertical functional is four other
 * things, in three separate files, and nothing at runtime connects them:
 *
 *   1. the module code exists
 *   2. a route is mounted in routes/v1/index.js
 *   3. config/roles.js has a role block with matching permission strings
 *   4. at least one model references `vertical: '<key>'`
 *
 * Drop the roles and the vertical still "exists" — it just grants nothing. That is the
 * failure this suite makes loud.
 *
 * Run: node scripts/verify.stores.vertical.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { roleRights } = require('../src/config/roles');
const { Vertical } = require('../src/models');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else { failures += 1; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
};

const run = async () => {
  console.log('\n=== vertical wiring ===\n');

  // ---- 1. the registry row exists ------------------------------------------
  const vertical = await Vertical.findOne({ key: 'stores' });
  ok('Vertical row for "stores" exists', !!vertical, 'run scripts/seed.stores.js');
  if (!vertical) {
    console.log('\n1 CHECK(S) FAILED');
    return failures;
  }
  ok('vertical.status is true', vertical.status === true);
  ok('vertical.usesSharedDelivery is FALSE (BR-05)', vertical.usesSharedDelivery === false,
     'got ' + vertical.usesSharedDelivery);
  ok('settings.enabledFeatures exists', !!(vertical.settings && vertical.settings.enabledFeatures));
  ok('codEnabled is OFF at launch', vertical.settings.enabledFeatures.codEnabled === false);
  ok('customerSubscriptions is OFF at launch', vertical.settings.enabledFeatures.customerSubscriptions === false);
  ok('catalogue is ON', vertical.settings.enabledFeatures.catalogue === true);
  ok('storeOwnedDelivery is ON', vertical.settings.enabledFeatures.storeOwnedDelivery === true);
  ok('maxRadiusKm is set', typeof vertical.settings.maxRadiusKm === 'number' && vertical.settings.maxRadiusKm > 0);

  // ---- 2. a role block exists with matching rights ---------------------------
  const partnerRights = roleRights.get('storePartner') || [];
  const driverRights = roleRights.get('storeDriver') || [];
  ok('config/roles.js has storePartner', roleRights.has('storePartner'));
  ok('config/roles.js has storeDriver', roleRights.has('storeDriver'));
  ok('storePartner grants at least one stores_ right',
     partnerRights.some((r) => r.startsWith('stores_')), partnerRights.length + ' rights');
  ok('storeDriver grants at least one stores_ right',
     driverRights.some((r) => r.startsWith('stores_')), driverRights.length + ' rights');

  // ---- 3. routes are mounted -------------------------------------------------
  // Express 5 does not expose a mounted sub-router's path on its Layer (the compiled
  // matcher lives in an opaque `matchers` array). Rather than reach into framework
  // internals, assert the mount where it is actually declared: routes/v1/index.js.
  // A forgotten mount is the real failure this catches.
  const fs = require('fs');
  const path = require('path');
  const v1Index = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'v1', 'index.js'), 'utf8');
  const mountsStores = /['"]\/stores['"]/.test(v1Index) && /use\s*\(\s*['"]stores/i.test(v1Index) || /stores\.route/i.test(v1Index);
  const mountsAdminStores = /['"]\/admin\/stores['"]/.test(v1Index) && /stores\.admin\.route/i.test(v1Index);
  ok('routes/v1/index.js mounts /stores', mountsStores);
  ok('routes/v1/index.js mounts /admin/stores', mountsAdminStores);

  // Runtime: both route modules must load and actually expose routes.
  let partnerRoutes = 0;
  let adminRoutes = 0;
  try {
    const partner = require('../src/modules/stores/routes/stores.route');
    const admin = require('../src/modules/stores/routes/stores.admin.route');
    partnerRoutes = (partner.stack || []).filter((l) => l.route).length;
    adminRoutes = (admin.stack || []).filter((l) => l.route).length;
  } catch (e) {
    failures += 1;
    console.log('  FAIL  stores route modules load -> ' + e.message);
  }
  ok('stores.route.js exposes at least one route', partnerRoutes > 0, partnerRoutes + ' routes');
  ok('stores.admin.route.js exposes at least one route', adminRoutes > 0, adminRoutes + ' routes');

  // ---- 4. models reference this vertical -------------------------------------
  const Business = mongoose.model('Business');
  const sample = await Business.findOne({ vertical: 'stores' }).select('_id').lean();
  ok('at least one Business exists with vertical "stores"', !!sample,
     'expected an onboarded chain, or accept that the vertical is unused so far');

  // ---- 5. every declared feature has a gate ----------------------------------
  const gates = Object.entries(vertical.settings.enabledFeatures);
  ok('enabledFeatures has 11 keys', gates.length === 11, gates.length + ' keys');
  const nonBooleans = gates.filter(([, v]) => typeof v !== 'boolean');
  ok('every feature gate is a boolean', nonBooleans.length === 0,
     nonBooleans.map(([k]) => k).join(', '));

  console.log('\n--- summary ---');
  console.log(failures === 0 ? 'ALL VERTICAL WIRING CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  return failures;
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    const f = await run();
    process.exit(f === 0 ? 0 : 1);
  } catch (e) {
    console.error('could not run:', e.message);
    process.exit(1);
  }
})();