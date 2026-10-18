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

const { status: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const ApiError = require('../../../utils/ApiError');
const {
  StoreOutlet,
  StoreRoleAssignment,
  StoreChain,
  Business,
} = require('../../../models');

/**
 * WHICH ROLE MAPS TO WHICH PERMISSIONS
 *
 * Kept here rather than on the model because it is authorisation policy, not data.
 * The denormalised copy on each StoreRoleAssignment is a snapshot for audit — this is
 * the live map.
 *
 * `'*'` grants everything WITHIN SCOPE. Scope is enforced separately by
 * `resolveActorOutlet`, so a regional_manager scoped to one outlet has exactly the
 * authority of a manager at that outlet and nothing anywhere else.
 *
 * The negative rules at the bottom are the ones that matter. They are enforced here as
 * hard blocks rather than left to each handler, because "a dispatcher cannot accept
 * an order" must not depend on thirty handlers remembering to check.
 */
const ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: [
    'orders.*', 'catalogue.*', 'inventory.*', 'delivery.*', 'promotions.*',
    'returns.*', 'staff.read', 'analytics.read',
  ],
  order_manager: [
    'orders.*', 'picking.*', 'packing.*', 'cancellations.*',
    'returns.read', 'customers.read',
  ],
  inventory_manager: [
    'catalogue.*', 'inventory.*', 'stock_adjust', 'stock_movements',
  ],
  dispatcher: [
    'ready_orders.*', 'drivers.*', 'assign_driver', 'delivery.*',
  ],
  regional_manager: ['*'],
  staff: ['orders.read', 'ready_orders.read'],
};

/**
 * Capabilities that are OWNER-ONLY, whatever the role or scope.
 * Financial settings, money movement and identity change.
 */
const OWNER_ONLY = [
  'subscription.manage',
  'settlement.view',
  'settlement.pay',
  'payout.bank_details',
  'costprice.view',
  'costprice.edit',
  'staff.grant_owner',
  'chain.delete',
];

/**
 * Resolve the active outlet for an actor (BR-38).
 *
 * ## The order, and why
 *
 *   1. DRIVER first. A driver has exactly one outlet, recorded on StoreDriver.store.
 *      Drivers have no StoreRoleAssignment, so checking staff first would 403 every
 *      driver request.
 *   2. STAFF / OWNER via StoreRoleAssignment. One human can hold several assignments
 *      across businesses and chains, so take the active one.
 *   3. VALIDATE the requested outlet against the resolved scope.
 *   4. Confirm the Business is a live stores tenant.
 *
 * ## Why the requested outlet is a HINT, not a trust input
 *
 * The client states which outlet it means, via the `X-Store-Outlet` header. That value
 * is attacker-controlled, and it would be a hole if it were trusted. It is not
 * trusted: it is checked against `permittedOutletIds`, which come from the actor's
 * StoreRoleAssignment. A forged header can therefore only ever name an outlet the
 * caller is ALREADY authorised for, so the worst outcome is "no effect".
 *
 * Falling back to the actor's `lastActiveOutletId` when no header is sent is what makes
 * the common case safe without a session: the value lives in the database, so it cannot
 * be forged at all.
 *
 * This is the direct lesson of Dairy defect 12, where `PATCH /orders/:status/:order`
 * had no outlet scope and a partner could move any order on the platform.
 *
 * ## Why an empty scope is "no access" and not "all access"
 *
 * An outlet-scoped assignment with an empty `outlets[]` is a misconfiguration. Treating
 * it as "all outlets" would turn one bad row into a platform-wide permission. It
 * returns an empty set, so the scope check then fails closed.
 *
 * @param {string} userId           the authenticated User id
 * @param {string} [requestedOutletId] the outlet the caller asked for, already
 *                                     validated by the caller against scope
 * @returns {Promise<{outlet: object, chain: object, role: string, assignment: object|null,
 *                    permittedOutletIds: string[]}>}
 */
const resolveActorOutlet = async (userId, requestedOutletId) => {
  const userObjectId = new mongoose.Types.ObjectId(String(userId));

  // ---- 1. driver path -------------------------------------------------------
  const StoreDriver = mongoose.models.StoreDriver;
  if (StoreDriver) {
    const driver = await StoreDriver.findOne({
      user: userObjectId,
      status: { $in: ['active', 'inactive', 'suspended'] },
    })
      .select('store status')
      .lean();

    if (driver && driver.store) {
      const outlet = await StoreOutlet.findById(driver.store)
        .populate('chain')
        .lean();
      if (!outlet) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Driver outlet no longer exists');
      }
      await assertStoresTenant(outlet.chain);

      // A driver is pinned to one outlet. A requested outlet that differs is a bug or
      // an attack, and either way it is not silently honoured.
      if (
        requestedOutletId &&
        String(requestedOutletId) !== String(outlet._id)
      ) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          'OUT_OF_SCOPE: a driver may only act on their own outlet',
          true,
          '',
          { permitted: [String(outlet._id)], requested: String(requestedOutletId) }
        );
      }

      return {
        outlet,
        chain: outlet.chain,
        role: 'driver',
        assignment: null,
        permittedOutletIds: [String(outlet._id)],
      };
    }
  }

  // ---- 2. staff / owner path ------------------------------------------------
  const assignments = await StoreRoleAssignment.find({
    user: userObjectId,
    status: 'active',
    endedAt: { $exists: false },
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  if (!assignments.length) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'No local store outlet is linked to this account'
    );
  }

  // Pick the assignment that can actually reach the requested outlet, so a user with
  // assignments in two chains lands on the right one without the client having to say
  // which business.
  let chosen = null;
  let chosenOutletIds = [];
  for (const assignment of assignments) {
    const ids = await permittedOutletIds(assignment);
    if (requestedOutletId && ids.includes(String(requestedOutletId))) {
      chosen = assignment;
      chosenOutletIds = ids;
      break;
    }
    if (!chosen) {
      // remember the first usable assignment as the fallback when no outlet was requested
      chosen = chosen || assignment;
      chosenOutletIds = ids;
    }
  }

  if (!chosen) {
    throw new ApiError(httpStatus.FORBIDDEN, 'No local store outlet is linked to this account');
  }

  // Prefer the outlet the caller last worked in. It lives in the database, so unlike a
  // header it cannot be forged — which is what makes the no-header case safe.
  const remembered = chosen.lastActiveOutletId ? String(chosen.lastActiveOutletId) : null;
  const rememberedOutletIds = await permittedOutletIds(chosen);
  const target =
    (requestedOutletId && rememberedOutletIds.includes(String(requestedOutletId))
      ? String(requestedOutletId)
      : null) ||
    (remembered && rememberedOutletIds.includes(remembered) ? remembered : null) ||
    (chosenOutletIds.includes(String(requestedOutletId || ''))
      ? String(requestedOutletId)
      : null) ||
    chosenOutletIds[0];

  // ---- validate the requested outlet against scope ------------------------
  if (requestedOutletId && !chosenOutletIds.includes(String(requestedOutletId))) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUT_OF_SCOPE: this account may not act on that outlet',
      true,
      '',
      {
        role: chosen.role,
        scopeType: chosen.scopeType,
        permitted: chosenOutletIds,
        requested: String(requestedOutletId),
      }
    );
  }

  if (!chosenOutletIds.length) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUT_OF_SCOPE: this assignment covers no outlet',
      true,
      '',
      { role: chosen.role, scopeType: chosen.scopeType }
    );
  }

  if (!target) {
    throw new ApiError(httpStatus.FORBIDDEN, 'No local store outlet is linked to this account');
  }

  const outlet = await StoreOutlet.findById(target).populate('chain').lean();
  if (!outlet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  }
  await assertStoresTenant(outlet.chain);

  return {
    outlet,
    chain: outlet.chain,
    role: chosen.role,
    assignment: chosen,
    permittedOutletIds: chosenOutletIds,
  };
};

/**
 * The complete set of outlet ids an assignment grants authority over.
 * Empty array means NO access — never "all".
 */
const permittedOutletIds = async (assignment) => {
  if (assignment.scopeType === 'outlet') {
    return (assignment.outlets || [])
      .filter(Boolean)
      .map((o) => String(o._id || o));
  }

  const filter =
    assignment.scopeType === 'chain'
      ? { chain: assignment.chain, status: { $ne: 'archived' } }
      : {
          chain: {
            $in: await StoreChain.distinct('_id', { business: assignment.business }),
          },
          status: { $ne: 'archived' },
        };

  const outlets = await StoreOutlet.find(filter).select('_id').lean();
  return outlets.map((o) => String(o._id));
};

/**
 * A stores tenant must exist, be vertical 'stores', and be switched on.
 * An unregistered vertical key reads as CLOSED, never open.
 */
const assertStoresTenant = async (chain) => {
  if (!chain) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Outlet is not attached to a chain');
  }

  const business = await Business.findById(
    chain.business || chain._id
  ).lean();

  if (!business) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Business not found');
  }
  if (business.vertical !== 'stores') {
    throw new ApiError(httpStatus.FORBIDDEN, 'This business is not a local stores tenant');
  }
  if (business.status !== true) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'This business is deactivated',
      true,
      '',
      { vertical: business.vertical }
    );
  }
  return business;
};

/**
 * Resolve an actor's SCOPE without requiring an active outlet.
 *
 * ## Why this is separate from `resolveActorOutlet`
 *
 * The outlet picker and the switch endpoint are the two places that must work BEFORE an
 * active outlet exists, or while the actor legitimately has none:
 *
 *   - a partner whose outlets are all suspended still needs to see and pick them
 *   - a new outlet appears; the client must be able to list it before working in it
 *   - `POST /session/outlet` needs the permitted set to validate the switch target
 *
 * Forcing those three through `resolveActorOutlet` would make the picker depend on an
 * active outlet, which is circular: you cannot pick an outlet without the picker, and
 * you cannot run the picker without an active outlet.
 *
 * ## What it deliberately does NOT do
 *
 * It does not pick one outlet and does not require one. `permittedOutletIds` here is the
 * full authorised set, which is exactly what a picker needs and nothing more. This must
 * never be used to authorise an action on an outlet: to act on one, use
 * `resolveActorOutlet`, which re-validates against scope and pins a single outlet.
 *
 * @param {string} userId the authenticated User id
 * @returns {Promise<{role: string, assignment: object|null, permittedOutletIds: string[],
 *                    groups: Array<{business: string, chain: string, role: string,
 *                                  scopeType: string, outlets: string[]}>,
 *                    isDriver: boolean}>}
 */
const resolveActorScope = async (userId) => {
  const userObjectId = new mongoose.Types.ObjectId(String(userId));

  // Driver first, same ordering rule as resolveActorOutlet: drivers have no
  // StoreRoleAssignment, so checking staff first would 403 every driver.
  const StoreDriver = mongoose.models.StoreDriver;
  if (StoreDriver) {
    const driver = await StoreDriver.findOne({
      user: userObjectId,
      status: { $in: ['active', 'inactive', 'suspended'] },
    })
      .select('store status')
      .lean();

    if (driver && driver.store) {
      const outlet = await StoreOutlet.findById(driver.store).populate('chain').lean();
      if (!outlet) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Driver outlet no longer exists');
      }
      await assertStoresTenant(outlet.chain);
      const ids = [String(outlet._id)];
      return {
        role: 'driver',
        assignment: null,
        permittedOutletIds: ids,
        isDriver: true,
        groups: [
          {
            business: outlet.chain.business,
            chain: outlet.chain._id,
            role: 'driver',
            scopeType: 'outlet',
            outlets: ids,
          },
        ],
      };
    }
  }

  const assignments = await StoreRoleAssignment.find({
    user: userObjectId,
    status: 'active',
    endedAt: { $exists: false },
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  if (!assignments.length) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'No local store outlet is linked to this account'
    );
  }

  const groups = [];
  for (const assignment of assignments) {
    // eslint-disable-next-line no-await-in-loop
    const ids = await permittedOutletIds(assignment);
    groups.push({
      business: assignment.business,
      chain: assignment.chain,
      role: assignment.role,
      scopeType: assignment.scopeType,
      lastActiveOutletId: assignment.lastActiveOutletId
        ? String(assignment.lastActiveOutletId)
        : null,
      outlets: ids,
    });
  }

  // Primary assignment wins for the actor's ambient role; the picker shows all groups.
  const primary = assignments.find((a) => a.isPrimary) || assignments[0];
  const primaryGroup = groups.find((g) => String(g.chain) === String(primary.chain)) || groups[0];

  return {
    role: primary.role,
    assignment: primary,
    permittedOutletIds: primaryGroup.outlets,
    groups,
    isDriver: false,
  };
};

/**
 * May this role do this, WITHIN its scope?
 *
 * Call this from the service layer. It is a convenience, not the boundary — the
 * boundary is the scope check in `resolveActorOutlet`, which already ran.
 *
 * @param {string} role
 * @param {string} right e.g. 'settlement.pay'
 * @returns {boolean}
 */
const can = (role, right) => {
  const granted = ROLE_PERMISSIONS[role];
  if (!granted) return false;

  // owner-only, regardless of what the role map says
  if (OWNER_ONLY.includes(right)) return role === 'owner';

  if (granted.includes('*')) return true;
  if (granted.includes(right)) return true;

  // prefix match, so 'orders.*' satisfies 'orders.accept'
  const [head] = right.split('.');
  return granted.includes(`${head}.*`);
};

/**
 * Throw a 403 unless the role may perform the right.
 * Owner-only rights are enforced here rather than trusted to each handler.
 */
const assertCan = (role, right) => {
  if (!can(role, right)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `Role '${role}' may not perform '${right}'`,
      true,
      '',
      { role, right }
    );
  }
  return true;
};

/** Every outlet in a chain that a role assignment would cover. Used by the picker. */
const listAssignableOutlets = async (userId) => {
  const assignments = await StoreRoleAssignment.find({
    user: new mongoose.Types.ObjectId(String(userId)),
    status: 'active',
  }).lean();

  const out = [];
  for (const a of assignments) {
    const ids = await permittedOutletIds(a);
    const outlets = await StoreOutlet.find({ _id: { $in: ids } })
      .select('name slug outletCode logo status operational chain')
      .lean();
    out.push({
      business: a.business,
      chain: a.chain,
      role: a.role,
      scopeType: a.scopeType,
      isPrimary: a.isPrimary,
      outlets,
    });
  }
  return out;
};

module.exports = {
  resolveActorOutlet,
  resolveActorScope,
  permittedOutletIds,
  assertStoresTenant,
  can,
  assertCan,
  listAssignableOutlets,
  ROLE_PERMISSIONS,
  OWNER_ONLY,
};