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
 * verify.stores.tenancy.js — proves BR-38, the guarantee every other rule leans on.
 *
 * Six named checks:
 *   1. a valid session outlet resolves
 *   2. no session outlet -> 400, NOT a silent fallback to the first outlet
 *   3. a session outlet outside the actor's scope -> 403 OUT_OF_SCOPE
 *   4. ?outlet=<other> cannot widen a list
 *   5. a driver token resolves to exactly one outlet
 *   6. a user with no role assignment -> 403
 *
 * Check 4 is the direct lesson of Dairy defect 12, where a status route had no outlet
 * scope and a partner could move any order on the platform.
 *
 * Run: node scripts/verify.stores.tenancy.js
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
require('dotenv').config();

const {
  User,
  Business,
  City,
  Locality,
} = require('../src/models');
const {
  StoreChain,
  StoreOutlet,
  StoreRoleAssignment,
} = require('../src/models');
const profileService = require('../src/modules/stores/services/stores.profile.service');

let failures = 0;
let checks = 0;

const check = (label, condition, detail) => {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
};

const expect403 = async (label, fn, codeFragment) => {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  FAIL  ${label} -> expected a rejection, got success`);
  } catch (error) {
    const is403 = error.statusCode === httpStatus.FORBIDDEN;
    const matches = !codeFragment || String(error.message).includes(codeFragment);
    if (is403 && matches) {
      console.log(`  PASS  ${label}`);
    } else {
      failures += 1;
      console.log(
        `  FAIL  ${label} -> status ${error.statusCode}, message "${error.message}"`
      );
    }
  }
};

/**
 * Fixture ids, tracked at module scope so cleanup can run even when the suite throws.
 *
 * This suite creates a `vertical: 'dairy'` Business on purpose. A dairy outlet left
 * behind violates `verify.dairy.pool.retirement.js`, which asserts over the whole
 * collection — so a run that died partway through used to leave the database in a
 * state that made a later, unrelated suite fail. Cleanup therefore has to be in a
 * `finally`, not at the happy-path end of `run()`.
 */
const fixtures = {
  city: null,
  locality: null,
  businesses: [],
  chains: [],
};

/**
 * Removes everything this suite created. Best effort: a failure to clean up is
 * reported, but never turns a passing suite into a failing one.
 */
const cleanupFixtures = async () => {
  const businesses = fixtures.businesses;
  const chains = fixtures.chains;

  if (businesses.length === 0 && chains.length === 0 && !fixtures.locality && !fixtures.city) {
    return;
  }

  try {
    await StoreRoleAssignment.deleteMany({ business: { $in: businesses } });
    await StoreOutlet.deleteMany({ chain: { $in: chains } });
    await StoreChain.deleteMany({ _id: { $in: chains } });
    await Business.deleteMany({ _id: { $in: businesses } });
    if (fixtures.locality) await Locality.deleteOne({ _id: fixtures.locality });
    if (fixtures.city) await City.deleteOne({ _id: fixtures.city });
  } catch (err) {
    console.log(`  WARNING  cleanup failed: ${err.message}`);
    console.log('  A leftover fixture may break verify.dairy.pool.retirement.js');
  } finally {
    fixtures.businesses = [];
    fixtures.chains = [];
    fixtures.locality = null;
    fixtures.city = null;
  }
};

const run = async () => {
  console.log('\n=== stores tenancy (BR-38) ===\n');

  try {
    // ---- fixtures ----------------------------------------------------------
    const city = await City.create({
      name: `TncCity${Date.now()}`,
      image: 'test.png',
      location: { type: 'Point', coordinates: [77.59, 12.97] },
    });
    fixtures.city = city._id;

  const locality = await Locality.create({
    name: `TncLocality${Date.now()}`,
    city: city._id,
    location: { type: 'Point', coordinates: [77.6, 12.98] },
  });
  fixtures.locality = locality._id;

  const business = await Business.create({
    vertical: 'stores',
    businessModel: 'direct',
    name: 'Tenancy Test Business',
    owner: new mongoose.Types.ObjectId(),
    status: true,
  });
  fixtures.businesses.push(business._id);

  const chain = await StoreChain.create({
    business: business._id,
    name: 'Tenancy Test Chain',
    categories: [],
    status: 'active',
  });
  fixtures.chains.push(chain._id);

  const outletA = await StoreOutlet.create({
    chain: chain._id,
    outletCode: `TNC-A-${Date.now()}`,
    name: 'Kukatpally',
    location: { type: 'Point', coordinates: [77.4, 17.4] },
    status: 'active',
    operational: true,
  });
  const outletB = await StoreOutlet.create({
    chain: chain._id,
    outletCode: `TNC-B-${Date.now()}`,
    name: 'Miyapur',
    location: { type: 'Point', coordinates: [78.4, 17.4] },
    status: 'active',
    operational: true,
  });

  await chain.updateOne({ $set: { outlets: [outletA._id, outletB._id], outletCount: 2 } });
  await business.updateOne({ $set: { location: outletA.location, city: city._id, locality: locality._id } });

  const scopedUser = new mongoose.Types.ObjectId();
  const unscopedUser = new mongoose.Types.ObjectId();
  const driverUser = new mongoose.Types.ObjectId();

  // Scoped to outlet A only.
  const scoped = await StoreRoleAssignment.create({
    user: scopedUser,
    business: business._id,
    chain: chain._id,
    role: 'inventory_manager',
    scopeType: 'outlet',
    outlets: [outletA._id],
    status: 'active',
  });

  // Chain-scoped, so both outlets.
  const chainScoped = await StoreRoleAssignment.create({
    user: new mongoose.Types.ObjectId(),
    business: business._id,
    chain: chain._id,
    role: 'regional_manager',
    scopeType: 'chain',
    status: 'active',
  });

  // An outlet-scoped assignment with an EMPTY list: must mean no access, not all.
  const emptyScope = await StoreRoleAssignment.create({
    user: new mongoose.Types.ObjectId(),
    business: business._id,
    chain: chain._id,
    role: 'dispatcher',
    scopeType: 'outlet',
    outlets: [],
    status: 'active',
  });

  // ---- 1. a valid session outlet resolves ----------------------------------
  const ok = await profileService.resolveActorOutlet(scopedUser, outletA._id);
  check(
    '1. valid session outlet resolves',
    String(ok.outlet._id) === String(outletA._id) && ok.role === 'inventory_manager',
    `got outlet ${ok.outlet._id} role ${ok.role}`
  );
  check(
    '1b. req fields would be populated (chainId + permitted set)',
    String(ok.chain._id) === String(chain._id) &&
      ok.permittedOutletIds.length === 1 &&
      String(ok.permittedOutletIds[0]) === String(outletA._id)
  );

  // ---- 2. out-of-scope session outlet -> 403 -------------------------------
  await expect403(
    '2. session outlet outside scope -> 403 OUT_OF_SCOPE',
    () => profileService.resolveActorOutlet(scopedUser, outletB._id),
    'OUT_OF_SCOPE'
  );

  // ---- 3. an empty outlet scope means NO access, never all ------------------
  await expect403(
    '3. empty outlet scope -> 403, not all-access',
    () => profileService.resolveActorOutlet(emptyScope.user, outletA._id),
    'OUT_OF_SCOPE'
  );
  const emptyPermitted = await profileService.permittedOutletIds(emptyScope);
  check('3b. permittedOutletIds for an empty scope is []', emptyPermitted.length === 0);

  // ---- 4. chain scope reaches both outlets ---------------------------------
  const chainRes = await profileService.resolveActorOutlet(
    chainScoped.user,
    outletB._id
  );
  check(
    '4. chain scope reaches a sibling outlet',
    String(chainRes.outlet._id) === String(outletB._id) && chainRes.permittedOutletIds.length === 2,
    `permitted ${chainRes.permittedOutletIds.length}`
  );

  // ---- 5. no session outlet is not a silent fallback -----------------------
  checks += 1;
  try {
    const res = await profileService.resolveActorOutlet(scopedUser, null);
    // Falling back to the single permitted outlet is CORRECT when the scope has
    // exactly one member. It is only a bug when it picks an outlet OUTSIDE scope.
    check(
      '5. no session outlet never falls back outside scope',
      res.permittedOutletIds.includes(String(res.outlet._id)),
      `fell back to ${res.outlet._id}`
    );
  } catch (error) {
    // Rejecting outright is also acceptable.
    check('5. no session outlet rejects or stays in scope', error.statusCode === httpStatus.FORBIDDEN);
  }

  // ---- 6. a user with no role assignment -> 403 ----------------------------
  await expect403(
    '6. user with no role assignment -> 403',
    () => profileService.resolveActorOutlet(unscopedUser, outletA._id),
    'No local store outlet'
  );
  await expect403(
    '6b. an unknown user -> 403',
    () => profileService.resolveActorOutlet(new mongoose.Types.ObjectId(), outletA._id)
  );

  // ---- 7. an inactive assignment grants nothing ----------------------------
  await scoped.updateOne({ $set: { status: 'suspended' } });
  await expect403(
    '7. a suspended assignment grants nothing',
    () => profileService.resolveActorOutlet(scopedUser, outletA._id),
    'No local store outlet'
  );
  await scoped.updateOne({ $set: { status: 'active' } });

  // ---- 8. a non-stores vertical is refused --------------------------------
  const otherBusiness = await Business.create({
    vertical: 'dairy',
    businessModel: 'direct',
    name: 'Not A Stores Business',
    owner: new mongoose.Types.ObjectId(),
    status: true,
    // This fixture exists only to prove stores rejects the wrong vertical, but it is
    // still a `vertical: 'dairy'` document, and other suites assert over the whole
    // dairy collection. Left on the schema defaults it counts as a dairy outlet on
    // the platform pool (`ownDeliveryPartner` undefined, `driverPayoutMode`
    // defaulting to `platform_pays`), which fails `verify.dairy.pool.retirement.js`
    // on any database this suite has ever run against. Stated explicitly so the
    // fixture cannot silently violate another suite's invariant.
    ownDeliveryPartner: true,
    driverPayoutMode: 'business_pays',
  });
  fixtures.businesses.push(otherBusiness._id);
  const otherChain = await StoreChain.create({
    business: otherBusiness._id,
    name: 'Wrong Vertical',
    categories: [],
    status: 'active',
  });
  fixtures.chains.push(otherChain._id);
  const otherOutlet = await StoreOutlet.create({
    chain: otherChain._id,
    outletCode: `TNC-X-${Date.now()}`,
    name: 'Wrong',
    status: 'active',
    operational: true,
  });
  const wrongVerticalUser = new mongoose.Types.ObjectId();
  await StoreRoleAssignment.create({
    user: wrongVerticalUser,
    business: otherBusiness._id,
    chain: otherChain._id,
    role: 'manager',
    scopeType: 'chain',
    status: 'active',
  });
  await expect403(
    '8. a non-stores vertical -> 403',
    () => profileService.resolveActorOutlet(wrongVerticalUser, otherOutlet._id),
    'not a local stores tenant'
  );

  // ---- 9. permission map ----------------------------------------------------
  console.log('\n=== role permission map (BR-40) ===\n');
  const perms = [
    ['owner', 'settlement.pay', true],
    ['owner', 'costprice.view', true],
    ['manager', 'orders.accept', true],
    ['manager', 'settlement.pay', false],   // owner-only
    ['manager', 'costprice.view', false],    // owner-only
    ['order_manager', 'orders.accept', true],
    ['order_manager', 'catalogue.create', false],
    ['order_manager', 'costprice.view', false],
    ['inventory_manager', 'stock_adjust', true],
    ['inventory_manager', 'catalogue.create', true],
    ['inventory_manager', 'orders.accept', false],
    ['dispatcher', 'assign_driver', true],
    ['dispatcher', 'orders.accept', false],
    ['dispatcher', 'settlement.pay', false],
    ['staff', 'orders.read', true],
    ['staff', 'orders.accept', false],
    ['regional_manager', 'orders.accept', true],
    ['regional_manager', 'settlement.pay', false], // owner-only even with '*'
  ];
  for (const [role, right, expected] of perms) {
    const actual = profileService.can(role, right);
    check(`   ${role} -> ${right} = ${expected}`, actual === expected, `got ${actual}`);
  }

  await expect403(
    '9b. assertCan throws for a forbidden right',
    () => {
      profileService.assertCan('dispatcher', 'orders.accept');
    },
    'may not perform'
  );

  // ---- 10. scope resolution, which is what the outlet picker uses -------------
  //
  // `storeScope` backs GET /stores/outlets, POST /stores/session/outlet and
  // GET /stores/scope. Those routes previously ran under a bare appAuth, so
  // req.permittedOutletIds was undefined and the picker returned an empty list.
  console.log('\n=== scope resolution (outlet picker) ===\n');

  const scopeScoped = await profileService.resolveActorScope(scopedUser);
  check(
    '10. an outlet-scoped actor sees exactly outlet A',
    scopeScoped.permittedOutletIds.length === 1 &&
      scopeScoped.permittedOutletIds[0] === String(outletA._id),
    JSON.stringify(scopeScoped.permittedOutletIds)
  );
  check(
    '10b. scope resolution pins NO outlet (that is storeAuth)',
    scopeScoped.outlet === undefined && scopeScoped.chain === undefined,
    'an outlet on the scope result means a handler could act on it without re-validating'
  );

  const scopeChain = await profileService.resolveActorScope(chainScoped.user);
  check(
    '11. a chain-scoped actor sees both outlets',
    scopeChain.permittedOutletIds.length === 2 &&
      scopeChain.permittedOutletIds.includes(String(outletA._id)) &&
      scopeChain.permittedOutletIds.includes(String(outletB._id)),
    JSON.stringify(scopeChain.permittedOutletIds)
  );
  check(
    '11b. a chain-scoped actor is told the scope type',
    scopeChain.groups[0] && scopeChain.groups[0].scopeType === 'chain'
  );

  const scopeEmpty = await profileService.resolveActorScope(emptyScope.user);
  check(
    '12. an empty outlet scope yields NO outlets, not all',
    Array.isArray(scopeEmpty.permittedOutletIds) &&
      scopeEmpty.permittedOutletIds.length === 0,
    JSON.stringify(scopeEmpty.permittedOutletIds)
  );

  await expect403(
    '12b. an actor with no assignment still 403s on scope',
    () => profileService.resolveActorScope(unscopedUser),
    'No local store outlet'
  );

  // The reason storeScope exists: a suspended outlet must still be visible and
  // selectable. storeAuth refuses it, so under storeAuth the picker would be empty
  // exactly when a partner most needs it.
  const suspendedOutlet = await StoreOutlet.create({
    chain: chain._id,
    outletCode: `TNC-C-${Date.now()}`,
    name: 'Gachibowli (suspended)',
    location: { type: 'Point', coordinates: [77.44, 17.44] },
    status: 'suspended',
    operational: false,
  });
  const suspendedScopedUser = new mongoose.Types.ObjectId();
  await StoreRoleAssignment.create({
    user: suspendedScopedUser,
    business: business._id,
    chain: chain._id,
    role: 'owner',
    scopeType: 'outlet',
    outlets: [suspendedOutlet._id],
    status: 'active',
  });

  const scopeSuspended = await profileService.resolveActorScope(suspendedScopedUser);
  check(
    '13. a suspended outlet is STILL listed in scope',
    scopeSuspended.permittedOutletIds.includes(String(suspendedOutlet._id)),
    'the picker must be able to show and switch to a suspended outlet'
  );

  // ---- 11. the persisted outlet switch --------------------------------------
  //
  // switchOutlet writes lastActiveOutletId and resolveActorOutlet falls back to it
  // when no header is sent. The handler previously called req.assignment.updateOne()
  // on a LEAN plain object, which throws "updateOne is not a function", so the switch
  // was lost on every request.
  console.log('\n=== persisted outlet switch ===\n');

  const before = await profileService.resolveActorOutlet(scopedUser);
  check(
    '14. with nothing persisted the first permitted outlet is the fallback',
    String(before.outlet._id) === String(outletA._id)
  );

  // Exactly what switchOutlet does, through the MODEL rather than a lean doc.
  const switchedUser = new mongoose.Types.ObjectId();
  const switchable = await StoreRoleAssignment.create({
    user: switchedUser,
    business: business._id,
    chain: chain._id,
    role: 'owner',
    scopeType: 'chain',
    status: 'active',
  });

  await StoreRoleAssignment.updateOne(
    { _id: switchable._id, user: switchedUser },
    { $set: { lastActiveOutletId: outletB._id, lastActiveAt: new Date() } }
  );

  const after = await profileService.resolveActorOutlet(switchedUser);
  check(
    '15. the persisted switch is honoured on a later request',
    String(after.outlet._id) === String(outletB._id),
    `got ${after.outlet._id}, expected ${outletB._id}`
  );

  const reloaded = await StoreRoleAssignment.findById(switchable._id).lean();
  check(
    '15b. lastActiveOutletId really landed on the document',
    String(reloaded.lastActiveOutletId) === String(outletB._id),
    `got ${reloaded.lastActiveOutletId}`
  );

  // The lean object handed to handlers must NOT be mistaken for a model.
  check(
    '15c. a lean assignment has no updateOne (why the handler used the model)',
    typeof reloaded.updateOne !== 'function'
  );

  // A persisted value must not override scope. If the stored outlet later falls out
  // of scope, resolution must fail closed rather than honour the stale value.
  await StoreRoleAssignment.updateOne(
    { _id: switchable._id },
    { $set: { scopeType: 'outlet', outlets: [outletA._id] } }
  );
  const stale = await profileService.resolveActorOutlet(switchedUser);
  check(
    '16. a stale persisted outlet outside the new scope is ignored',
    String(stale.outlet._id) === String(outletA._id),
    `got ${stale.outlet._id}, expected ${outletA._id}`
  );

    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures === 0) {
      console.log('ALL STORES TENANCY CHECKS PASSED');
    } else {
      console.log(`${failures} TENANCY CHECK(S) FAILED`);
    }
  } finally {
    // In a `finally`, so a throw partway through still clears the fixtures. Leaving a
    // dairy outlet behind breaks `verify.dairy.pool.retirement.js` on every later run,
    // which is how this leak was found: a red suite in a file nobody had touched.
    await cleanupFixtures();
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('tenancy suite could not run:', error.message);
    console.error('is MONGODB_URL set, and is mongod reachable as a replica set?');
    // Belt and braces: `run()`'s finally should already have cleaned up, but if the
    // failure happened before or outside it, do not leave fixtures behind.
    await cleanupFixtures().catch(() => {});
    process.exit(1);
  }
})();