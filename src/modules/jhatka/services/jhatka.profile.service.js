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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { Business } = require('../../../models');
const JhatkaOutlet = require('../models/jhatka.outlet.model');
const JhatkaDriver = require('../models/jhatka.driver.model');
const JhatkaTenantRoleAssignment = require('../models/jhatka.tenant.role.assignment.model');

/**
 * jhatka.profile.service — who may act on which outlet. §2.3.
 *
 * ## The two mechanisms, and why they are separate
 *
 * A PLATFORM right (in `config/roles.js`) says what KIND of thing you may touch: an
 * order, a payout, a driver.
 *
 * An OUTLET authority (a `JhatkaTenantRoleAssignment`) says what you may touch
 * INSIDE an outlet: this person's `weight.confirm` right belongs to outlet A and not
 * outlet B, even though they hold the platform right.
 *
 * They are deliberately separate, copied from `stores.profile.service`. If they were
 * one, a person holding `jhatka_payout_pay` for one outlet would hold it for every
 * outlet of the business, because platform rights are per-ROLE and roles are
 * per-BUSINESS.
 *
 * ## `ObjectId === string` is FALSE. Everywhere.
 *
 * Mongoose casts a `ref` to an `ObjectId` INSTANCE. `new ObjectId(x) === x` is false
 * for two `ObjectId`s holding the same value and for an ObjectId against a string.
 * This file therefore uses `.toString()` on every id at every boundary, and
 * `sameId()` for every comparison.
 *
 * This is not theoretical. `JhatkaPartner.primaryOutletId()` originally returned a
 * raw ObjectId, and the middleware compares it against `req.outletId` (a string) —
 * so the comparison silently failed and resolution fell through to the wrong outlet
 * for every multi-outlet partner. That bug is why this file is written the way it is.
 */

/**
 * Compare two ids regardless of type. The only safe way to compare an id in this
 * codebase.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

/**
 * Do these two id lists have anything in common?
 *
 * Written for the same reason as `sameId`: a naive `.includes()` over a mixed list
 * fails silently rather than throwing, and the failure mode is "this partner
 * cannot reach their own second outlet".
 *
 * @param {Array<any>} a
 * @param {any} b
 * @returns {boolean}
 */
function containsId(list, b) {
  if (!Array.isArray(list) || b === null || b === undefined) return false;
  const target = String(b);
  return list.some((x) => String(x) === target);
}

const OUTLET_ROLES = [
  'owner',
  'manager',
  'order_staff',
  'inventory_staff',
  'packing_staff',
  'weigher',
  'dispatcher',
  'compliance_officer',
];

/**
 * Dotted-wildcard permission namespace, mirroring
 * `stores.profile.service`'s `ROLE_PERMISSIONS`.
 *
 * ## `weight.confirm` is a capability of exactly ONE role. §14.2.
 *
 * That is the point of the `weigher` role existing. Weight confirmation is the only
 * action in this vertical that determines money, so the person who cuts the meat
 * should not be the person who reports its weight. Every other role's namespace
 * excludes `weight.*` explicitly rather than by omission.
 */
const ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: [
    'orders.*',
    'preparation.*',
    'weight.*',
    'inventory.*',
    'procurement.*',
    'suppliers.*',
    'batches.*',
    'wastage.*',
    'staff.read',
    'staff.write',
    'subscriptions.read',
    'subscriptions.manage',
    'delivery.read',
    'delivery.dispatch',
    'compliance.read',
    'reviews.read',
    'reviews.respond',
    'analytics.read',
    'complaints.read',
    'complaints.manage',
    'catalogue.read',
  ],
  order_staff: [
    'orders.read',
    'orders.accept',
    'orders.reject',
    'preparation.start',
    'preparation.*',
    'inventory.read',
    'complaints.read',
  ],
  inventory_staff: [
    'inventory.*',
    'procurement.*',
    'suppliers.read',
    'batches.read',
    'batches.quarantine',
    'batches.release',
    'wastage.*',
    'orders.read',
  ],
  packing_staff: ['packing.*', 'orders.read', 'labels.*', 'inventory.read'],
  /**
   * Weight confirmation ONLY.
   *
   * No `orders.accept`, no `preparation.start`, no `inventory.*`. A weigher sees the
   * scale and the two numbers — nothing else.
   */
  weigher: ['weight.confirm', 'weight.override', 'orders.read', 'batches.read'],
  dispatcher: [
    'delivery.*',
    'drivers.*',
    'orders.read',
    'subscriptions.read',
    'complaints.read',
  ],
  /**
   * The rider's own surface — and ONLY that surface. A rider moves their own
   * deliveries and reads their own earnings. No `delivery.dispatch` (that is
   * the outlet deciding), no `orders.*`, no money. Without this entry every
   * rider endpoint 403s at `cap()`, because an unknown role holds nothing.
   */
  driver: ['delivery.read', 'delivery.accept', 'delivery.update', 'delivery.otp'],
  compliance_officer: [
    'compliance.*',
    'batches.quarantine',
    'batches.release',
    'recalls.*',
    'suppliers.read',
    'complaints.read',
    'wastage.read',
  ],
};

/**
 * Owner-only capabilities. §14.2.
 *
 * `OWNER_ONLY` is copied from stores: settlement view is granted to every partner,
 * but settlement PAYMENT and the bank details are the owner's alone. There is
 * deliberately no separate "payout" right, because the two decisions are different
 * and splitting them would add a permission string to maintain for no gain.
 */
const OWNER_ONLY = [
  'payout.view',
  'payout.pay',
  'payout.bank_details',
  'wastage.adjust',
  'staff.grant_owner',
  'outlet.delete',
  'franchise.agreement',
  'commission_rule.manage',
];

/**
 * Is this actor a Jhatka driver?
 *
 * Drivers are checked FIRST in `resolveActorOutlet`, because a rider is also a `User`
 * and may hold a staff assignment by accident — and a rider who falls through to
 * staff resolution could be handed a counter they have nothing to do with.
 *
 * @param {any} userId
 * @returns {Promise<{isDriver: boolean, driver: any|null}>}
 */
async function resolveDriver(userId) {
  const driver = await JhatkaDriver.findOne({
    user: userId,
    status: { $in: ['active', 'inactive', 'suspended'] },
  }).lean();
  return { isDriver: !!driver, driver };
}

/**
 * Every outlet id this actor may act on. BR-04: one partner, many outlets.
 *
 * An EMPTY ARRAY MEANS NO ACCESS, NEVER ALL. `stores.tenant.js` states the same
 * rule and it is the single most important line in either file: a `filter({})`
 * mistake inverts into "everyone sees everything" with no error anywhere.
 *
 * @param {any} assignment
 * @returns {Promise<string[]>} id STRINGS
 */
async function permittedOutletIds(assignment) {
  if (!assignment) return [];

  if (assignment.scopeType === 'outlet') {
    return (assignment.outlets || []).map((o) => String(o));
  }

  if (assignment.scopeType === 'business') {
    const outlets = await JhatkaOutlet.find({
      business: assignment.business,
      status: { $ne: 'closed' },
    })
      .select('_id')
      .lean();
    return outlets.map((o) => String(o._id));
  }

  return [];
}

/**
 * Resolve the actor's SCOPE — the whole authorised set, without pinning one outlet.
 *
 * Mirrors `stores.profile.service.resolveActorScope`. See `jhatka.tenant.js` for
 * why a separate scope middleware exists rather than pinning everywhere.
 *
 * @param {any} userId
 * @returns {Promise<{groups: object, permittedOutletIds: string[], role: string|null,
 *                    assignment: any|null, isDriver: boolean, driver: any|null}>}
 */
async function resolveActorScope(userId) {
  const { isDriver, driver } = await resolveDriver(userId);

  const assignments = await JhatkaTenantRoleAssignment.find({
    user: userId,
    status: 'active',
    endedAt: { $exists: false },
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  // A driver with no staff assignment is still a driver. Never `[]`.
  if (isDriver && assignments.length === 0) {
    return {
      groups: {},
      permittedOutletIds: [],
      role: 'driver',
      assignment: null,
      isDriver: true,
      driver,
    };
  }

  const assignment = assignments[0] || null;
  if (!assignment) {
    // No assignment and not a driver: a customer who logged into a partner screen.
    return {
      groups: {},
      permittedOutletIds: [],
      role: null,
      assignment: null,
      isDriver,
      driver,
    };
  }

  const permitted = await permittedOutletIds(assignment);
  const groups = {};
  for (const outletId of permitted) {
    const key = String(outletId);
    groups[key] = groups[key] || [];
    groups[key].push(assignment.role);
  }

  return {
    groups,
    permittedOutletIds: permitted,
    role: assignment.role,
    assignment,
    isDriver,
    driver,
  };
}

/**
 * Pin the outlet this request acts on. §2.3.
 *
 * ## Order is deliberate, and it is the security-relevant part
 *
 *   1. DRIVER FIRST. A rider resolves to their own outlet and to nothing else. If a
 *      driver somehow also holds a staff assignment, staff resolution must not be
 *      what decides where they land.
 *   2. Staff / owner, honouring an in-scope hint.
 *   3. Hint precedence: in-scope hint → `lastActiveOutletId` (DB-backed, unforgeable)
 *      → first permitted.
 *
 * ## A hint the actor is NOT scoped for is an OUT_OF_SCOPE error, not a fallback
 *
 * Silently falling back would let a caller probe which outlets exist by watching
 * the response change shape. `stores.tenant.js` does the same and it is right.
 *
 * @param {any} userId
 * @param {string} [hintedOutletId] attacker-controlled; treated as a hint only
 * @returns {Promise<object>}
 */
async function resolveActorOutlet(userId, hintedOutletId) {
  // ---- 1. driver ----
  const { isDriver, driver } = await resolveDriver(userId);
  if (isDriver) {
    // A platform-pool rider has `outlet === null` and belongs to no outlet. They get
    // a driver scope, and the delivery routes scope by `driver` rather than `outlet`.
    if (!driver.outlet) {
      if (hintedOutletId) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'OUT_OF_SCOPE: a platform-pool driver cannot act on an outlet'
        );
      }
      return {
        outlet: null,
        outletId: null,
        business: null,
        role: 'driver',
        assignment: null,
        permittedOutletIds: [],
        isDriver: true,
        driver,
        isPlatformPoolDriver: true,
      };
    }

    const driverOutletId = String(driver.outlet);
    if (hintedOutletId && !sameId(hintedOutletId, driverOutletId)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'OUT_OF_SCOPE: a driver may only act on their own outlet'
      );
    }

    const outlet = await assertOutlet(driverOutletId);
    return {
      outlet,
      outletId: driverOutletId,
      business: outlet.business,
      role: 'driver',
      assignment: null,
      permittedOutletIds: [driverOutletId],
      isDriver: true,
      driver,
      isPlatformPoolDriver: false,
    };
  }

  // ---- 2 + 3. staff / owner ----
  const scope = await resolveActorScope(userId);

  if (!scope.assignment) {
    // A real state — a partner mid-onboarding, or a customer on a partner screen.
    // The message says so rather than reporting a missing resource.
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'This account has no Jhatka outlet assignment'
    );
  }

  const permitted = scope.permittedOutletIds;
  if (permitted.length === 0) {
    // Empty array means NO ACCESS, never all. See the note on permittedOutletIds.
    throw new ApiError(httpStatus.FORBIDDEN, 'This assignment grants no outlet access');
  }

  let targetId = null;

  if (hintedOutletId) {
    if (!containsId(permitted, hintedOutletId)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'OUT_OF_SCOPE: that outlet is outside your assignment'
      );
    }
    targetId = String(hintedOutletId);
  } else if (scope.assignment.lastActiveOutletId) {
    // DB-backed, therefore unforgeable. Only used if it is still in scope — an
    // assignment can be narrowed after it was last set.
    const last = String(scope.assignment.lastActiveOutletId);
    if (containsId(permitted, last)) targetId = last;
  }

  if (!targetId) targetId = permitted[0];

  const outlet = await assertOutlet(targetId);

  return {
    outlet,
    outletId: targetId,
    business: outlet.business,
    role: scope.role,
    assignment: scope.assignment,
    permittedOutletIds: permitted,
    isDriver: false,
    driver: null,
    isPlatformPoolDriver: false,
  };
}

/**
 * Load an outlet and assert the tenant chain. §2.3.
 *
 * The assertion is `vertical === 'jhatka'` rather than an outlet-status check,
 * because the OUTLET STATUS gate is deliberately NOT here — see
 * `JhatkaOutlet.capabilities()` and the note in `jhatka.tenant.js`. A suspended
 * outlet must still be readable so an in-flight order stays trackable.
 */
async function assertOutlet(outletId) {
  const outlet = await JhatkaOutlet.findById(outletId).lean();
  if (!outlet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Jhatka outlet not found');
  }

  const business = await Business.findById(outlet.business).lean();
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Owning business not found');
  }
  // An unregistered vertical key reads as CLOSED, matching
  // `vertical.service.isTradingOpen`, which treats a missing key as halted.
  if (business.vertical !== 'jhatka' || business.status !== true) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'This outlet is not part of an active Jhatka business'
    );
  }

  return outlet;
}

/**
 * May this actor perform this dotted capability inside this outlet?
 *
 * The real check for outlet authority. The route-level `requireRole` is a fast fail
 * against `req.role`; this is the enforcement.
 *
 * @param {string} role
 * @param {string} capability dotted, e.g. 'weight.confirm'
 * @returns {boolean}
 */
function can(role, capability) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;

  if (perms.includes('*')) return true;

  return perms.some((p) => {
    if (p === capability) return true;
    if (p.endsWith('.*')) {
      const prefix = p.slice(0, -1); // keep the trailing dot
      return capability.startsWith(prefix);
    }
    return false;
  });
}

/**
 * Segregation of duties: may this role both PREPARE and WEIGH?
 *
 * ## Why this is a function and not a comment
 *
 * BR-08 exists because a weight confirmation above the hard cap is the only place
 * in this vertical where someone could gain from lying about a number. The obvious
 * control is "the person who cuts does not report the weight" — but a comment does
 * not enforce anything, and an owner who has `'*'` would pass every capability check
 * anyway.
 *
 * So the rule is: `owner` and `manager` are EXEMPT (a single-person shop cannot hire
 * a second person, and refusing to let an owner weigh would stop a one-man butcher
 * trading), and for every other role `can(role,'preparation.start')` must be false
 * before `weight.confirm` is granted.
 *
 * The single-role shop case is why this is an exemption list rather than a blanket
 * rule, and it is the honest trade: the control is worth having on an outlet with
 * more than one person, and impossible on one with a single person.
 *
 * @param {string} role
 * @returns {boolean} true when the combination is permitted
 */
const SEPARATION_EXEMPT_ROLES = ['owner', 'manager'];

function passesSeparationOfDuties(role) {
  if (SEPARATION_EXEMPT_ROLES.includes(role)) return true;
  return !can(role, 'preparation.start');
}

/**
 * Throw unless the actor's role grants the capability.
 *
 * `OWNER_ONLY` is checked BEFORE the role map, so a capability that is owner-only
 * cannot be granted to any other role by a mistake in `ROLE_PERMISSIONS`.
 *
 * `weight.confirm` additionally requires separation of duties.
 *
 * @param {string} role
 * @param {string} capability
 * @returns {boolean} true when permitted
 * @throws {ApiError} 403
 */
function assertCan(role, capability) {
  if (OWNER_ONLY.includes(capability) && role !== 'owner') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `Only the outlet owner may perform '${capability}'`
    );
  }

  if (!can(role, capability)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `Role '${role || 'unknown'}' may not perform '${capability}'`
    );
  }

  if (capability === 'weight.confirm' && !passesSeparationOfDuties(role)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `Role '${role}' may not both prepare and confirm weight — assign a weigher, or grant manager`
    );
  }

  return true;
}

module.exports = {
  OUTLET_ROLES,
  ROLE_PERMISSIONS,
  OWNER_ONLY,
  sameId,
  containsId,
  resolveDriver,
  permittedOutletIds,
  resolveActorScope,
  resolveActorOutlet,
  assertOutlet,
  can,
  assertCan,
  passesSeparationOfDuties,
  SEPARATION_EXEMPT_ROLES,
};