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
  StoreRoleAssignment,
  StoreOutlet,
  StoreChain,
} = require('../../../models');
const profileService = require('./stores.profile.service');

/**
 * Staff role assignment (BR-40).
 *
 * Two rules make this safe:
 *
 *   1. GRANTING `owner` IS OWNER-ONLY. Otherwise any manager could promote a
 *      colleague to owner and then reach the bank details. The check lives here, in
 *      the service, not in a route guard, because a route guard is one of thirty
 *      places to forget.
 *
 *   2. SCOPE CAN ONLY BE NARROWED, never widened, by someone who already holds the
 *      wider scope. A Kukatpally dispatcher cannot hand themselves all of ABC Retail.
 *      `assertCanWidenScope` enforces that against the actor's own assignments.
 *
 * NO ONE IS EVER HARD-DELETED (BR-25). Deactivating sets `status`, so a historical
 * order still resolves the person who handled it.
 */

const ROLES = [
  'owner',
  'manager',
  'order_manager',
  'inventory_manager',
  'dispatcher',
  'regional_manager',
  'staff',
];

/**
 * Who may assign this role?
 *
 * ESCALATION IS NOT PERMITTED. Nobody may mint authority they do not themselves hold.
 *
 * The seven roles do not form an exact chain — `order_manager` and
 * `inventory_manager` have almost disjoint capability sets — so this uses a
 * conservative total order and fails closed:
 *
 *   owner             -> every role
 *   regional_manager  -> everything except owner
 *   manager           -> the floor roles: staff, dispatcher, inventory_manager,
 *                        order_manager. This is how a small store hires its floor team.
 *   order_manager     -> order_manager only
 *   inventory_manager -> inventory_manager only
 *   dispatcher        -> dispatcher only
 *   staff             -> staff only
 *
 * Why the floor roles cannot grant each other: granting `order_manager` to someone
 * gives them `orders.*`, `picking.*`, `packing.*` and `cancellations.*`, which a
 * dispatcher does not have. That is escalation even though the roles look like peers,
 * and it is the case a "floor roles may grant floor roles" shortcut would wave through.
 *
 * Being unable to add a stock-clerk is mild friction. An owner or manager can do it,
 * and every chain has an owner.
 */
const FLOOR_ROLES = ['staff', 'dispatcher', 'inventory_manager', 'order_manager'];

const assignableRolesFor = (actorRole) => {
  switch (actorRole) {
    case 'owner':
      return ROLES;
    case 'regional_manager':
      return ROLES.filter((r) => r !== 'owner');
    case 'manager':
      return FLOOR_ROLES;
    case 'order_manager':
    case 'inventory_manager':
    case 'dispatcher':
    case 'staff':
      return [actorRole];
    default:
      return [];
  }
};

/**
 * May `actor` assign authority over `targetOutletIds`?
 * The actor must already hold scope covering every one of them.
 */
const assertCanWidenScope = async (actorId, targetOutletIds, targetScopeType) => {
  if (targetScopeType === 'business') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'business-wide scope may only be granted by an owner',
      true,
      '',
      { targetScopeType }
    );
  }

  const actors = await StoreRoleAssignment.find({ user: actorId, status: 'active' }).lean();
  if (!actors.length) {
    throw new ApiError(httpStatus.FORBIDDEN, 'the actor holds no active scope');
  }

  const actorPermitted = new Set();
  let actorIsOwner = false;
  for (const a of actors) {
    if (a.role === 'owner') actorIsOwner = true;
    for (const id of await profileService.permittedOutletIds(a)) actorPermitted.add(id);
  }
  if (actorIsOwner) return true;

  const wanted = new Set((targetOutletIds || []).map(String));
  for (const id of wanted) {
    if (!actorPermitted.has(id)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'OUT_OF_SCOPE: you may not grant authority over an outlet you do not hold',
        true,
        '',
        { outlet: id, yourScope: [...actorPermitted] }
      );
    }
  }
  return true;
};

const listAssignments = async ({ chain, role, status, search, page = 1, limit = 20 }) => {
  const filter = {};
  if (chain) filter.chain = chain;
  if (role) filter.role = role;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreRoleAssignment.find(filter)
      .populate('user', 'name mobile email')
      .populate('outlets', 'name outletCode slug')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreRoleAssignment.countDocuments(filter),
  ]);

  return {
    assignments: items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

const assignRole = async ({ user, business, chain, role, scopeType, outlets, isPrimary, notes, actor }) => {
  // Enforce the documented escalation ladder, and do it HERE, in the service, not only
  // on the route. `assignableRolesFor` defines who may grant what, and for one specific
  // case — a dispatcher minting an order_manager, which comes with `orders.*` and
  // `cancellations.*` the dispatcher has never held — the route guard alone was a
  // trust boundary thirty other callers could bypass.
  if (actor && actor.role) {
    const grantable = assignableRolesFor(actor.role);
    if (!grantable.includes(role)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        `ESCALATION: role '${actor.role}' may not grant '${role}'`,
        true,
        '',
        { actorRole: actor.role, requestedRole: role, grantable }
      );
    }
  }

  if (role === 'owner' && actor && actor.role !== 'owner') {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "only an owner may grant 'owner'",
      true,
      '',
      { role, actorRole: actor.role }
    );
  }

  if (scopeType === 'outlet' && (!outlets || !outlets.length)) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      'outlets[] is required and must be non-empty when scopeType is "outlet"'
    );
  }

  await assertCanWidenScope(actor ? actor.userId : null, outlets, scopeType);

  // A user may hold one assignment per role per chain. A duplicate is almost always a
  // double-click, and silently keeping both makes scope maths unpredictable.
  const existing = await StoreRoleAssignment.findOne({ user, chain, role });
  if (existing) {
    if (existing.status === 'active') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `this user already holds the '${role}' role on this chain`,
        true,
        '',
        { assignment: existing._id }
      );
    }
    // reactivate rather than insert a second row
    existing.status = 'active';
    existing.endedAt = undefined;
    existing.scopeType = scopeType;
    existing.outlets = outlets || [];
    existing.permissions = profileService.ROLE_PERMISSIONS[role];
    existing.isPrimary = isPrimary || false;
    existing.notes = notes;
    existing.grantedBy = actor ? actor.userId : undefined;
    await existing.save();
    return existing;
  }

  return StoreRoleAssignment.create({
    user,
    business,
    chain,
    role,
    scopeType,
    outlets: outlets || [],
    permissions: profileService.ROLE_PERMISSIONS[role],
    isPrimary: isPrimary || false,
    notes,
    status: 'active',
    joinedAt: new Date(),
    grantedBy: actor ? actor.userId : undefined,
  });
};

const updateAssignment = async ({ assignmentId, patch, actor }) => {
  const assignment = await StoreRoleAssignment.findById(assignmentId);
  if (!assignment) throw new ApiError(httpStatus.NOT_FOUND, 'Assignment not found');

  // A role change is a NEW grant of that role, so the same escalation ladder applies.
  // Without this a manager could patch an existing order_manager record into 'manager'
  // even though they may not create a manager.
  if (patch.role && actor && actor.role) {
    const grantable = assignableRolesFor(actor.role);
    if (!grantable.includes(patch.role)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        `ESCALATION: role '${actor.role}' may not assign '${patch.role}'`,
        true,
        '',
        { actorRole: actor.role, requestedRole: patch.role, grantable }
      );
    }
  }

  if (patch.role === 'owner' && assignment.role !== 'owner' && actor && actor.role !== 'owner') {
    throw new ApiError(httpStatus.FORBIDDEN, "only an owner may promote to 'owner'");
  }

  if (patch.role) assignment.permissions = profileService.ROLE_PERMISSIONS[patch.role];

  if (patch.scopeType || patch.outlets) {
    const scopeType = patch.scopeType || assignment.scopeType;
    const outlets = patch.outlets || assignment.outlets;
    if (scopeType === 'outlet' && (!outlets || !outlets.length)) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'outlets[] must be non-empty for outlet scope');
    }
    await assertCanWidenScope(actor ? actor.userId : null, outlets, scopeType);
    assignment.scopeType = scopeType;
    assignment.outlets = outlets;
  }

  for (const field of ['isPrimary', 'notes', 'status', 'statusReason']) {
    if (patch[field] !== undefined) assignment[field] = patch[field];
  }
  if (patch.status === 'inactive' || patch.status === 'suspended') assignment.endedAt = new Date();

  await assignment.save();
  return assignment;
};

/**
 * Deactivate. NEVER delete — a historical order, a stock movement or a delivery must
 * keep resolving the person who did it.
 */
const deactivateAssignment = async ({ assignmentId, reason, actor }) => {
  const assignment = await StoreRoleAssignment.findById(assignmentId);
  if (!assignment) throw new ApiError(httpStatus.NOT_FOUND, 'Assignment not found');

  assignment.status = 'inactive';
  assignment.statusReason = reason;
  assignment.endedAt = new Date();
  assignment.isPrimary = false;
  await assignment.save();

  // Recompute `operational` for anything this person was the last actor on is NOT
  // needed: operational is about status + subscription, never about who is logged in.
  return assignment;
};

/** Everything one person may act on, grouped by chain. Drives the outlet switcher. */
const scopeForUser = async (userId) => {
  const assignments = await StoreRoleAssignment.find({ user: userId, status: 'active' }).lean();
  const out = [];
  for (const a of assignments) {
    const ids = await profileService.permittedOutletIds(a);
    const outlets = await StoreOutlet.find({ _id: { $in: ids } })
      .select('name slug outletCode logo status operational chain')
      .lean();
    const chain = await StoreChain.findById(a.chain).select('name slug logo status').lean();
    out.push({
      assignment: a._id,
      business: a.business,
      chain: a.chain,
      chainName: chain ? chain.name : null,
      role: a.role,
      scopeType: a.scopeType,
      isPrimary: a.isPrimary,
      outlets,
    });
  }
  return out;
};

/** Everyone with access to an outlet, for the outlet detail screen. */
const outletTeam = async (outletId) => {
  const outlet = await StoreOutlet.findById(outletId).select('chain').lean();
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

  const [chainWide, outletScoped] = await Promise.all([
    StoreRoleAssignment.find({ chain: outlet.chain, scopeType: { $in: ['chain', 'business'] }, status: 'active' })
      .populate('user', 'name mobile email')
      .lean(),
    StoreRoleAssignment.find({ chain: outlet.chain, scopeType: 'outlet', outlets: outletId, status: 'active' })
      .populate('user', 'name mobile email')
      .lean(),
  ]);

  return [...chainWide, ...outletScoped];
};

module.exports = {
  ROLES,
  assignableRolesFor,
  assignRole,
  updateAssignment,
  deactivateAssignment,
  listAssignments,
  scopeForUser,
  outletTeam,
  assertCanWidenScope,
};