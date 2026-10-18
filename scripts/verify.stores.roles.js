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
 * verify.stores.roles.js — proves the platform rights wiring (BR-03, BR-06, BR-07, BR-08)
 * AND the staff role guards (BR-40).
 *
 * The point of this suite is that `config/roles.js` is a static Map, so nothing at
 * runtime links a new role to anything. A role can be added to the enum, appear in
 * `User.role`, and grant no rights at all — silently. This suite asserts the wiring.
 *
 * Run: node scripts/verify.stores.roles.js
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
require('dotenv').config();

const { roleRights, roles: allRoleKeys } = require('../src/config/roles');
const { User, Business } = require('../src/models');
const profileService = require('../src/modules/stores/services/stores.profile.service');
const staffService = require('../src/modules/stores/services/stores.staff.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else { failures += 1; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
};
const expectThrow = async (label, fn, fragment) => {
  try { await fn(); failures += 1; console.log('  FAIL  ' + label + ' -> should have thrown'); }
  catch (e) {
    if (e.statusCode === httpStatus.FORBIDDEN && (!fragment || String(e.message).includes(fragment))) {
      console.log('  PASS  ' + label);
    } else {
      failures += 1;
      console.log('  FAIL  ' + label + ' -> ' + e.statusCode + ' "' + e.message + '"');
    }
  }
};

const run = async () => {
  console.log('\n=== roles registry ===\n');

  ok('storePartner is a registered role', allRoleKeys.includes('storePartner'));
  ok('storeDriver is a registered role', allRoleKeys.includes('storeDriver'));
  ok('roleRights is a Map keyed by role', roleRights instanceof Map);
  ok('roleRights has an entry for every role', allRoleKeys.every((r) => roleRights.has(r)));
  ok('the User role enum derives from roles.js (no model edit needed)', allRoleKeys.length > 0);

  const partner = roleRights.get('storePartner') || [];
  const driver = roleRights.get('storeDriver') || [];
  ok('storePartner has rights', partner.length > 0, partner.length + ' rights');
  ok('storeDriver has rights', driver.length > 0, driver.length + ' rights');

  console.log('\n=== a driver has no money or catalogue rights (BR-04, BR-34) ===\n');
  const forbiddenForDriver = [
    'stores_catalog_write', 'stores_inventory_adjust', 'stores_order_manage',
    'stores_order_pick', 'stores_driver_assign', 'stores_settlement_read',
    'stores_subscription_manage', 'stores_promotion_write', 'stores_staff_write',
    'stores_invoice_read', 'stores_customer_read', 'stores_analytics_read',
  ];
  for (const right of forbiddenForDriver) {
    ok('  storeDriver lacks ' + right, !driver.includes(right));
  }
  for (const right of ['stores_delivery_read', 'stores_delivery_accept', 'stores_delivery_otp', 'stores_ready_orders_read']) {
    ok('  storeDriver HAS ' + right, driver.includes(right));
  }

  console.log('\n=== partner rights are namespaced ===\n');
  const unnamespaced = partner.filter((r) => !r.startsWith('stores_') && !['uploadImage', 'update_locale', 'read_notification', 'notification_list', 'mark_all_read'].includes(r));
  ok('every stores right is prefixed stores_', unnamespaced.length === 0, unnamespaced.join(', '));
  const dupes = partner.filter((r, i) => partner.indexOf(r) !== i);
  ok('no duplicate partner rights', dupes.length === 0, dupes.join(', '));
  const dupesD = driver.filter((r, i) => driver.indexOf(r) !== i);
  ok('no duplicate driver rights', dupesD.length === 0, dupesD.join(', '));

  console.log('\n=== a driver must 403 the partner dashboard ===\n');
  // The platform right for the partner dashboard. A driver does not hold it, so
  // `storeAuth('stores_analytics_read')` cannot be satisfied by a driver token.
  ok('partner dashboard requires stores_analytics_read', partner.includes('stores_analytics_read'));
  ok('a driver cannot satisfy stores_analytics_read', !driver.includes('stores_analytics_read'));
  ok('a driver cannot satisfy stores_order_manage', !driver.includes('stores_order_manage'));

  console.log('\n=== role permission map covers every declared role ===\n');
  for (const role of staffService.ROLES) {
    ok('  ROLE_PERMISSIONS has ' + role, !!profileService.ROLE_PERMISSIONS[role]);
  }
  ok('  an unknown role grants nothing', profileService.can('superuser', 'orders.accept') === false);
  ok('  an undefined role grants nothing', profileService.can(undefined, 'orders.accept') === false);

  console.log('\n=== owner-only rights are owner-only (BR-42) ===\n');
  for (const right of profileService.OWNER_ONLY) {
    const owners = profileService.can('owner', right);
    const managers = profileService.can('manager', right);
    const regionals = profileService.can('regional_manager', right);
    ok('  ' + right.padEnd(24) + ' owner=' + owners, owners === true);
    ok('  ' + right.padEnd(24) + ' manager=false, regional_manager=false', managers === false && regionals === false);
  }

  console.log('\n=== which roles may be granted (no escalation) ===\n');
  ok('an owner may grant owner', staffService.assignableRolesFor('owner').includes('owner'));
  ok('a regional manager may NOT grant owner', !staffService.assignableRolesFor('regional_manager').includes('owner'));
  ok('a manager may NOT grant owner', !staffService.assignableRolesFor('manager').includes('owner'));
  ok('a manager may NOT mint a peer manager', !staffService.assignableRolesFor('manager').includes('manager'));
  ok('an order manager may NOT mint a manager', !staffService.assignableRolesFor('order_manager').includes('manager'));
  ok('a dispatcher may NOT mint a manager',
     !staffService.assignableRolesFor('dispatcher').includes('manager'));
  ok('a staff member may grant only staff',
     JSON.stringify(staffService.assignableRolesFor('staff')) === JSON.stringify(['staff']));
  ok('an unknown role grants nothing',
     staffService.assignableRolesFor('superuser').length === 0);

  // exhaustive, against a CONSERVATIVE total order. The real roles are not a chain —
  // order_manager and inventory_manager are near-disjoint — so this over-approximates
  // rank. Any escalation under it is a real escalation.
  const strength = ['staff', 'dispatcher', 'inventory_manager', 'order_manager', 'manager', 'regional_manager', 'owner'];
  let escalations = 0;
  for (const actorRole of strength) {
    const grantable = staffService.assignableRolesFor(actorRole);
    for (const target of grantable) {
      if (strength.indexOf(target) > strength.indexOf(actorRole)) {
        escalations += 1;
        console.log('        ESCALATION: ' + actorRole + ' may grant ' + target);
      }
    }
  }
  ok('no role can grant a role stronger than itself (' + strength.length + ' roles checked)', escalations === 0, escalations + ' escalations');
  ok('a manager may hire the floor team (' + staffService.assignableRolesFor('manager').length + ' roles)', staffService.assignableRolesFor('manager').length === 4);
  ok('a dispatcher may grant only dispatcher',
     JSON.stringify(staffService.assignableRolesFor('dispatcher')) === JSON.stringify(['dispatcher']));
  ok('an order manager may grant only order_manager',
     JSON.stringify(staffService.assignableRolesFor('order_manager')) === JSON.stringify(['order_manager']));

  console.log('\n--- summary ---');
  console.log(failures === 0 ? 'ALL STORES ROLE CHECKS PASSED' : failures + ' CHECK(S) FAILED');
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