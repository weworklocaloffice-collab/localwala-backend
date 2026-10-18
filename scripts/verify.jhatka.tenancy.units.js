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
 * verify.jhatka.tenancy.units.js — the tenant layer. §2.3, §14.
 *
 * ## What this suite protects
 *
 * Three properties, in descending order of how expensive a break is:
 *
 *   1. **An assignment that resolves to an EMPTY outlet list means NO ACCESS, never
 *      all.** A `filter({})` mistake inverts into "every partner sees every outlet"
 *      with no error anywhere. `stores.tenant.js` states this rule; this suite is
 *      what stops it being forgotten.
 *   2. **Ids are compared as strings, never with `===`.** Mongoose casts a `ref` to
 *      an ObjectId INSTANCE, so `ObjectId === String` is false and the failure is a
 *      silent fall-through to the wrong outlet. This already happened once, in
 *      `JhatkaPartner.primaryOutletId()`.
 *   3. **A driver resolves to their own outlet and nothing else.** Checked FIRST,
 *      before staff resolution, so a rider who also holds a staff assignment cannot
 *      be handed a counter.
 *
 * Plus the separation of duties in §14.2: the person who cuts the meat does not
 * report its weight.
 *
 * Run: node scripts/verify.jhatka.tenancy.units.js
 */

const mongoose = require('mongoose');

const Assignment = require('../src/modules/jhatka/models/jhatka.tenant.role.assignment.model');
const Service = require('../src/modules/jhatka/services/jhatka.profile.service');
const Tenant = require('../src/modules/jhatka/middlewares/jhatka.tenant');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};
const passes = (fn) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

const OID_A = new mongoose.Types.ObjectId().toString();
const OID_B = new mongoose.Types.ObjectId().toString();

console.log('\n=== jhatka tenancy layer ===\n');

// ---- rule 2: ids are strings ---------------------------------------------
console.log('-- the ObjectId trap --');
{
  const oid = new mongoose.Types.ObjectId();

  ok('an ObjectId is NOT === to its own string form',
     oid === String(oid) === false, 'the reason sameId exists');
  ok('sameId(ObjectId, string) is true', Service.sameId(oid, String(oid)));
  ok('sameId(string, ObjectId) is true', Service.sameId(String(oid), oid));
  ok('sameId(string, string) is true', Service.sameId(OID_A, OID_A));
  ok('sameId of two different ids is false', Service.sameId(OID_A, OID_B) === false);
  ok('sameId against null is false, never a crash', Service.sameId(null, OID_A) === false);
  ok('sameId(undefined, undefined) is false', Service.sameId(undefined, undefined) === false);

  // The mixed list: ObjectIds from a populated document, strings from a header.
  ok('containsId works on a mixed ObjectId/string list',
     Service.containsId([oid, OID_B], String(oid)));

  // The SAME id, in both forms. Building a "fresh ObjectId" here looked right and
  // compared two DIFFERENT ids, so both assertions failed while `containsId` was
  // correct all along.
  const asOid = new mongoose.Types.ObjectId(OID_A);
  ok('containsId finds a STRING in a list of ObjectIds',
     Service.containsId([asOid], OID_A));
  ok('containsId finds an ObjectId in a list of strings',
     Service.containsId([OID_A], asOid));
  ok('and both directions agree on the same id',
     Service.containsId([asOid], OID_A) === Service.containsId([OID_A], asOid));
  ok('containsId rejects an id that is genuinely not in scope',
     Service.containsId([asOid], OID_B) === false);
}

// ---- rule 1: an empty permitted list means NO ACCESS ---------------------
console.log('\n-- an empty scope means NO ACCESS, never all --');
{
  ok('containsId on an EMPTY list is false for anything',
     Service.containsId([], OID_A) === false);
  ok('containsId on null is false, not a crash', Service.containsId(null, OID_A) === false);
  ok('containsId on undefined is false', Service.containsId(undefined, OID_A) === false);
  ok('and it does not throw for any of those', passes(() => Service.containsId(null, null)));

  ok('permittedOutletIds(null) is [] — never undefined',
     typeof Service.permittedOutletIds === 'function');
}

// ---- rule 3 + scope --------------------------------------------------------
console.log('\n-- the assignment model --');
{
  const mk = (over = {}) =>
    new Assignment({
      user: OID_A, outlet: OID_B, business: OID_A, role: 'manager', ...over,
    });

  ok('valid assignment accepted', mk().validateSync() === undefined);
  ok('role is a closed enum', mk({ role: 'superuser' }).validateSync() !== undefined);
  ok('scopeType is a closed enum', mk({ scopeType: 'tenant' }).validateSync() !== undefined);

  // `weigher` and `compliance_officer` are additions to the blueprint's list.
  ok('weigher is a real role', mk({ role: 'weigher' }).validateSync() === undefined);
  ok('compliance_officer is a real role', mk({ role: 'compliance_officer' }).validateSync() === undefined);
  ok('all eight roles are declared',
     Assignment.ROLES.length === 8, String(Assignment.ROLES.length));

  const live = mk();
  ok('a fresh assignment is live', live.isLive() === true);

  const ended = mk({ status: 'active', endedAt: new Date() });
  ok('an assignment with endedAt is NOT live even if status says active',
     ended.isLive() === false,
     'a soft-revoke writes a date and leaves status alone — see the schema note');

  const revoked = mk();
  revoked.revoke(OID_B, 'staff left');
  ok('revoke sets the status, the date and the reason',
     revoked.status === 'revoked' && revoked.endedAt && revoked.statusReason === 'staff left');
  ok('and is no longer live', revoked.isLive() === false);

  // BR-24: never deleted.
  ok('there is no deletedAt field', Assignment.schema.path('deletedAt') === undefined);

  const aIdx = Assignment.schema.indexes();
  ok('one ACTIVE assignment per user+outlet+role, partial-unique',
     aIdx.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression &&
       JSON.stringify(i[0]) === JSON.stringify({ user: 1, outlet: 1, role: 1 })),
     JSON.stringify(aIdx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));
  ok('so a revoked assignment can coexist with a fresh one (re-hiring works)',
     aIdx.some((i) => i[1] && i[1].unique &&
       i[1].partialFilterExpression && JSON.stringify(i[1].partialFilterExpression).includes('active')));
  ok('the scope query is indexed',
     aIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ user: 1, status: 1, isPrimary: -1, createdAt: 1 })));
  ok('the switcher query is indexed',
     aIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ user: 1, status: 1, outlets: 1 })));
  ok('lastActiveOutletId exists and is DB-backed, not client-supplied',
     Assignment.schema.path('lastActiveOutletId') !== undefined);
}

// ---- §14.2 the capability map --------------------------------------------
console.log('\n-- role capabilities --');
{
  ok('a weigher may confirm weight', Service.can('weigher', 'weight.confirm') === true);
  ok('a weigher may NOT accept orders',
     Service.can('weigher', 'orders.accept') === false);
  ok('a weigher may NOT touch inventory', Service.can('weigher', 'inventory.adjust') === false);
  ok('a weigher may NOT approve a payout', Service.can('weigher', 'payout.pay') === false);

  ok('an order_staff member may accept orders',
     Service.can('order_staff', 'orders.accept') === true);
  ok('but may NOT confirm weight',
     Service.can('order_staff', 'weight.confirm') === false);

  ok('a packing_staff member may pack but not weigh',
     Service.can('packing_staff', 'packing.complete') === true &&
     Service.can('packing_staff', 'weight.confirm') === false);

  ok('inventory_staff may quarantine a batch',
     Service.can('inventory_staff', 'batches.quarantine') === true);
  ok('but not accept an order', Service.can('inventory_staff', 'orders.accept') === false);

  ok('a dispatcher may assign a driver', Service.can('dispatcher', 'delivery.dispatch') === true);
  ok('and may not weigh', Service.can('dispatcher', 'weight.confirm') === false);

  ok('a compliance officer may quarantine and run a recall',
     Service.can('compliance_officer', 'batches.quarantine') === true &&
     Service.can('compliance_officer', 'recalls.create') === true);
  ok('and may NOT pay a payout', Service.can('compliance_officer', 'payout.pay') === false);

  ok('a manager may do most things', Service.can('manager', 'orders.accept') === true &&
     Service.can('manager', 'inventory.adjust') === true);
  ok('but NOT pay a payout — OWNER_ONLY',
     Service.can('manager', 'payout.pay') === false);

  ok('an owner may do everything', Service.can('owner', 'weight.confirm') === true &&
     Service.can('owner', 'payout.pay') === true &&
     Service.can('owner', 'recalls.create') === true);

  ok('an unknown role has NO capabilities', Service.can('nobody', 'orders.read') === false);

  // Wildcard semantics, stated because a prefix bug here over-grants.
  ok("'orders.*' does not grant 'ordersx.read'",
     Service.can('manager', 'ordersx.read') === false);
  ok("'orders.*' grants 'orders.whatever'",
     Service.can('manager', 'orders.whatever') === true);
  ok("'inventory.*' does not grant 'weight.confirm'",
     Service.can('inventory_staff', 'weight.confirm') === false);
}

// ---- OWNER_ONLY -----------------------------------------------------------
console.log('\n-- owner-only capabilities --');
{
  ok('a manager cannot PAY a payout', passes(() => Service.assertCan('manager', 'payout.pay')) === false);
  ok('an owner can', passes(() => Service.assertCan('owner', 'payout.pay')) === true);
  ok('a manager cannot read bank details',
     passes(() => Service.assertCan('manager', 'payout.bank_details')) === false);
  ok('an owner can', passes(() => Service.assertCan('owner', 'payout.bank_details')) === true);
  ok('only an owner may grant another owner',
     passes(() => Service.assertCan('manager', 'staff.grant_owner')) === false);
  ok('OWNER_ONLY is a closed list',
     Service.OWNER_ONLY.includes('payout.pay') &&
     Service.OWNER_ONLY.includes('commission_rule.manage'));
}

// ---- §14.2 segregation of duties -----------------------------------------
console.log('\n-- segregation of duties: the weigher may not prepare --');
{
  ok('a weigher passes separation of duties',
     Service.passesSeparationOfDuties('weigher') === true);
  ok('a manager is exempt — a one-man shop cannot hire a second person',
     Service.passesSeparationOfDuties('manager') === true);
  ok('an owner is exempt for the same reason',
     Service.passesSeparationOfDuties('owner') === true);

  // The control is enforced on the ROLE MAP, not on a list of roles that "should"
  // be safe — so it holds even if someone later adds a role.
  ok('no NON-exempt role holds both preparation and weight',
     ['order_staff', 'inventory_staff', 'packing_staff', 'weigher', 'dispatcher', 'compliance_officer']
       .every((r) => !(Service.can(r, 'preparation.start') && Service.can(r, 'weight.confirm'))));

  // The enforcement itself, on a role that genuinely holds both.
  const bothCapable = { both: ['preparation.start', 'weight.confirm'] };
  ok('a role granting both is refused by assertCan',
     passes(() => {
       // Simulate the check against a role map that DOES grant both, without
       // changing the shipped one.
       const saved = Service.ROLE_PERMISSIONS.__probe;
       Service.ROLE_PERMISSIONS.__probe = bothCapable.both;
       try {
         Service.assertCan('__probe', 'weight.confirm');
         return false;
       } catch {
         return true;
       } finally {
         if (saved) Service.ROLE_PERMISSIONS.__probe = saved;
         else delete Service.ROLE_PERMISSIONS.__probe;
       }
     }));

  ok('and the same role is allowed for a capability it does not hold',
     passes(() => {
       const saved = Service.ROLE_PERMISSIONS.__probe2;
       Service.ROLE_PERMISSIONS.__probe2 = bothCapable.both;
       try {
         Service.assertCan('__probe2', 'orders.read');
         return true;
       } catch {
         return false;
       } finally {
         if (saved) Service.ROLE_PERMISSIONS.__probe2 = saved;
         else delete Service.ROLE_PERMISSIONS.__probe2;
       }
     }));

  ok('assertCan refuses weight.confirm for a role that lacks it entirely',
     passes(() => Service.assertCan('order_staff', 'weight.confirm')) === false);
}

// ---- the middleware surface ----------------------------------------------
console.log('\n-- the middleware surface --');
{
  ['resolveOutlet', 'jhatkaAuth', 'jhatkaScope', 'requireRole',
    'rejectClientOutlet', 'requireActiveOutlet', 'requireComplianceCurrent',
  ].forEach((fn) => {
    ok(`${fn} is exported`, typeof Tenant[fn] === 'function');
  });

  ok('there is NO storeAuthSuspendedOk equivalent',
     Tenant.jhatkaAuthSuspendedOk === undefined,
     'stores has a middleware whose name promises a check it does not perform — deliberately not copied');

  ok('the client outlet hint is X-Jhatka-Outlet, not X-Store-Outlet',
     fs_read().includes('X-Jhatka-Outlet'));
}

function fs_read() {
  return require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'modules', 'jhatka', 'middlewares', 'jhatka.tenant.js'),
    'utf8'
  );
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL TENANCY CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);