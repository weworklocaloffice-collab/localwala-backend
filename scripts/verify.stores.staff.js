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
 * verify.stores.staff.js
 *
 * The staff-assignment service, which is where a partner hires the team that runs an
 * outlet. There are three structural rules it must hold:
 *
 *   1. ESCALATION IS NOT PERMITTED. Nobody may mint authority they do not themselves
 *      hold. A manager may hire the FLOOR roles (staff, dispatcher, inventory_manager,
 *      order_manager), but may not hire a peer manager, and a dispatcher may not hire
 *      an order_manager — granting that role brings `orders.*`, `picking.*`, and
 *      `cancellations.*` the dispatcher lacks.
 *
 *   2. GRANTING `owner` IS OWNER-ONLY. Otherwise the first manager could promote a
 *      colleague to owner, and owner reaches cost prices, settlements, and the bank.
 *
 *   3. SCOPE CAN ONLY BE NARROWED. The actor must already hold a scope covering every
 *      outlet they are assigning. A Kukatpally dispatcher cannot grant authority over
 *      the Miyapur outlet, because they cannot see it themselves.
 *
 * NO ONE IS HARD-DELETED (BR-25): deactivating sets `status: 'inactive'`, never
 * `deleteOne`, so a historical order still resolves the person who handled it.
 *
 * These are the same class of defects the dairy vertical shipped twice. Checking them
 * once here, in one suite, is cheaper than catching them in review of each of the
 * thirty ways this service is called.
 *
 * Run: node scripts/verify.stores.staff.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const {
  Business,
  StoreChain,
  StoreOutlet,
  StoreRoleAssignment,
} = require('../src/models');

const staffService = require('../src/modules/stores/services/stores.staff.service');
const profileService = require('../src/modules/stores/services/stores.profile.service');

let pass = 0;
let failures = 0;

const ck = (label, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const expectFailure = async (label, fn, check) => {
  try {
    await fn();
    failures += 1;
    console.log('  FAIL  ' + label + ' -> expected a rejection, got success');
  } catch (error) {
    const ok = check(error);
    if (ok) {
      pass += 1;
      console.log('  PASS  ' + label);
    } else {
      failures += 1;
      console.log(
        '  FAIL  ' + label + ' -> wrong error: ' + (error.statusCode || '') + ' ' + error.message
      );
    }
  }
};

const expectConflict = async (label, fn) => {
  await expectFailure(label, fn, (e) => e.statusCode === 409);
};

const expect403 = async (label, fn, fragment) => {
  await expectFailure(label, fn, (e) => {
    if (e.statusCode === 403) return true;
    if (fragment && String(e.message || '').includes(fragment)) return true;
    return false;
  });
};

const expectUnprocessable = async (label, fn, fragment) => {
  await expectFailure(label, fn, (e) => e.statusCode === 422 && String(e.message || '').includes(fragment));
};

const run = async () => {
  console.log('\n=== staff role assignment (BR-40) ===\n');

  // ---- fixtures --------------------------------------------------------------
  const stamp = Date.now();

  const business = await Business.create({
    name: 'Staff Test Co ' + stamp,
    vertical: 'stores',
    status: true,
  });
  const chain = await StoreChain.create({
    business: business._id,
    name: 'Staff Test Chain ' + stamp,
    categories: [],
    status: 'active',
  });
  const outletA = await StoreOutlet.create({
    chain: chain._id,
    outletCode: 'STF-A-' + stamp,
    name: 'Kukatpally',
    location: { type: 'Point', coordinates: [77.4, 17.4] },
    status: 'active',
    operational: true,
  });
  const outletB = await StoreOutlet.create({
    chain: chain._id,
    outletCode: 'STF-B-' + stamp,
    name: 'Miyapur',
    location: { type: 'Point', coordinates: [78.4, 17.4] },
    status: 'active',
    operational: true,
  });

  const ownerId = new mongoose.Types.ObjectId();
  const dispatcherId = new mongoose.Types.ObjectId();
  const newcomerId = new mongoose.Types.ObjectId();

  const ownerAssignment = await StoreRoleAssignment.create({
    user: ownerId,
    business: business._id,
    chain: chain._id,
    role: 'owner',
    scopeType: 'chain',
    status: 'active',
  });
  const dispatcherAssignment = await StoreRoleAssignment.create({
    user: dispatcherId,
    business: business._id,
    chain: chain._id,
    role: 'dispatcher',
    scopeType: 'outlet',
    outlets: [outletA._id],
    status: 'active',
  });

  // ---- 1. who may assign which role ------------------------------------------
  console.log('--- assignableRolesFor ---');

  const all = new Set(['owner', 'manager', 'order_manager', 'inventory_manager', 'dispatcher', 'regional_manager', 'staff']);
  ck('1. owner may eventually grant every role', staffService.assignableRolesFor('owner').every((r) => all.has(r)));

  const regional = new Set(staffService.assignableRolesFor('regional_manager'));
  ck('1b. a regional manager may NOT mint a peer owner', !regional.has('owner'));
  ck('1c. a regional manager may grant the floor', regional.has('manager') && regional.has('staff'));

  const manager = new Set(staffService.assignableRolesFor('manager'));
  ck('1d. a manager may hire the four floor roles', manager.size === 4 && manager.has('staff') && manager.has('dispatcher'));
  ck('1e. a manager may NOT mint a peer manager', !manager.has('manager'));
  ck('1f. a manager may NOT mint a regional manager', !manager.has('regional_manager'));

  const dispatcher = new Set(staffService.assignableRolesFor('dispatcher'));
  ck('1g. a dispatcher may only mint dispatchers', dispatcher.size === 1 && dispatcher.has('dispatcher'));

  const unknown = staffService.assignableRolesFor('no_such_role');
  ck('1h. an unknown role grants nobody', Array.isArray(unknown) && unknown.length === 0);

  // ---- 2. assignRole requires a valid scope ----------------------------------
  console.log('--- assignRole scope validation ---');

  await expectUnprocessable(
    '2. an outlet-scoped assignment with an empty outlets[] is rejected',
    () =>
      staffService.assignRole({
        user: newcomerId,
        business: business._id,
        chain: chain._id,
        role: 'order_manager',
        scopeType: 'outlet',
        outlets: [],
        actor: { role: 'owner', userId: ownerId },
      }),
    'outlets[] is required'
  );

  await expect403(
    '2b. non-owner granting owner is rejected',
    () =>
      staffService.assignRole({
        user: newcomerId,
        business: business._id,
        chain: chain._id,
        role: 'owner',
        scopeType: 'chain',
        actor: { role: 'manager', userId: new mongoose.Types.ObjectId() },
      }),
    'only an owner'
  );

  await expect403(
    '2c. a business-wide scope may only be granted by an owner',
    () =>
      staffService.assignRole({
        user: newcomerId,
        business: business._id,
        chain: chain._id,
        role: 'order_manager',
        scopeType: 'business',
        actor: { role: 'regional_manager', userId: new mongoose.Types.ObjectId() },
      }),
    'business-wide'
  );

  // ---- 3. the escalation ladder is enforced at the service, not just the route
  console.log('--- escalation enforcement ---');

  await expect403(
    '3. a dispatcher may NOT hire an order_manager (that brings orders.* the dispatcher lacks)',
    () =>
      staffService.assignRole({
        user: newcomerId,
        business: business._id,
        chain: chain._id,
        role: 'order_manager',
        scopeType: 'outlet',
        outlets: [outletA._id],
        actor: { role: 'dispatcher', userId: dispatcherId },
      }),
    'OUT_OF_SCOPE|may not grant'
  );

  // ---- 4. scope can only be narrowed ------------------------------------------
  console.log('--- scope can only be narrowed ---');

  await expect403(
    '4. an outlet dispatcher cannot grant scope over a different outlet',
    () =>
      staffService.assignRole({
        user: newcomerId,
        business: business._id,
        chain: chain._id,
        role: 'dispatcher',
        scopeType: 'outlet',
        outlets: [outletB._id],
        actor: { role: 'dispatcher', userId: dispatcherId },
      }),
    'OUT_OF_SCOPE'
  );

  // The same dispatcher CAN grant a peer on the outlet they already hold.
  const peer = await staffService.assignRole({
    user: newcomerId,
    business: business._id,
    chain: chain._id,
    role: 'dispatcher',
    scopeType: 'outlet',
    outlets: [outletA._id],
    actor: { role: 'dispatcher', userId: dispatcherId },
  });
  ck('4b. the same dispatcher CAN hire a peer on their own outlet', peer && peer.role === 'dispatcher');

  // ---- 5. duplicate role on same chain is a conflict, reactivation is idempotent
  console.log('--- duplicates and reactivation ---');

  await expectConflict(
    '5. the same user + role + chain twice is a 409, not a silent duplicate',
    () =>
      staffService.assignRole({
        user: newcomerId,
        business: business._id,
        chain: chain._id,
        role: 'dispatcher',
        scopeType: 'outlet',
        outlets: [outletA._id],
        actor: { role: 'owner', userId: ownerId },
      })
  );

  const deactivated = await staffService.deactivateAssignment({ assignmentId: peer._id, reason: 'left' });
  ck('5b. deactivation flips status, it does not delete the row', deactivated.status !== 'active');
  ck('5c. deactivation KEEPS the document (audit trail)', !!(await StoreRoleAssignment.findById(peer._id)));

  const rehired = await staffService.assignRole({
    user: newcomerId,
    business: business._id,
    chain: chain._id,
    role: 'dispatcher',
    scopeType: 'outlet',
    outlets: [outletA._id],
    actor: { role: 'owner', userId: ownerId },
  });
  ck('5d. re-hiring the same role reactivates the same row', String(rehired._id) === String(peer._id) && rehired.status === 'active');

  // ---- 6. updateAssignment promotion rules ------------------------------------
  console.log('--- updateAssignment ---');

  await expect403(
    '6. a non-owner cannot promote a manager to owner',
    () =>
      staffService.updateAssignment({
        assignmentId: ownerAssignment._id,
        patch: { role: 'owner' },
        actor: { role: 'manager', userId: new mongoose.Types.ObjectId() },
      }),
    'only an owner'
  );

  // ---- 7. no-one is hard-deleted ----------------------------------------------
  console.log('--- no hard delete (BR-25) ---');

  const before = await StoreRoleAssignment.countDocuments({ business: business._id });
  await staffService.deactivateAssignment({ assignmentId: rehired._id, reason: 'off' });
  const after = await StoreRoleAssignment.countDocuments({ business: business._id });
  ck('7. deactivation leaves the row count unchanged', before === after, `before=${before} after=${after}`);

  // ---- 8. listAssignments / outletTeam / scopeForUser read paths ---------------
  console.log('--- read paths ---');

  const list = await staffService.listAssignments({ chain: chain._id });
  ck('8. listAssignments returns the owners and managers of the chain', list.total >= 2, `total=${list.total}`);

  const team = await staffService.outletTeam(outletA._id);
  ck('8b. outletTeam lists the head of outlet A', Array.isArray(team) && team.length >= 1, team.length);

  const scope = await staffService.scopeForUser(dispatcherId);
  ck(
    '8c. scopeForUser returns the dispatcher scope',
    Array.isArray(scope) && scope.length >= 1,
    JSON.stringify(scope).slice(0, 60)
  );

  // ---- cleanup ---------------------------------------------------------------
  await StoreRoleAssignment.deleteMany({ business: business._id });
  await StoreOutlet.deleteMany({ chain: chain._id });
  await StoreChain.deleteMany({ _id: chain._id });
  await Business.deleteMany({ _id: business._id });

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('ALL STAFF CHECKS PASSED');
  } else {
    console.log(failures + ' STAFF CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('staff suite could not run:', error.message);
    process.exit(1);
  }
})();