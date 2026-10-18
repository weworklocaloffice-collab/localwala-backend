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
const { StoreOutlet, StoreChain, StoreSubscription } = require('../../../models');

/**
 * The lifecycle, and the only legal moves between states.
 *
 * A chain and each of its outlets carry their own status, so one suspended outlet
 * does not take the chain down. Per-outlet operational state always wins.
 */
const LIFECYCLE_TRANSITIONS = {
  draft: ['submitted', 'archived'],
  submitted: ['under_review', 'draft', 'archived'],
  under_review: ['changes_required', 'approved', 'rejected', 'archived'],
  changes_required: ['submitted', 'archived'],
  approved: ['subscription_payment', 'archived'],
  subscription_payment: ['active', 'archived'],
  active: ['suspended', 'archived'],
  suspended: ['reactivated', 'archived'],
  reactivated: ['active', 'suspended', 'archived'],
  rejected: ['draft', 'archived'],
  archived: [],
};

const SUSPENSION_REASONS = [
  'expired_subscription',
  'compliance_issue',
  'repeated_complaints',
  'fraud',
  'payment_issue',
  'operational_violation',
  'admin_action',
];

/**
 * Throws unless `from -> to` is a legal move.
 * The message lists what IS allowed, because "illegal transition" with no context is
 * the least useful error in a system an operator has to drive by hand.
 */
const assertTransition = (from, to) => {
  const allowed = LIFECYCLE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Illegal lifecycle transition: ${from} -> ${to}. ` +
        `Allowed from ${from}: ${allowed.join(', ') || 'none'}`,
      true,
      '',
      { from, to, allowed }
    );
  }
  return true;
};

/**
 * Subscription states, and the failed-renewal ladder.
 * PLAN FLOW
 *
 *     trial -> active -> payment_due -> retrying -> grace_period -> suspended -> expired
 *
 * FAILED RENEWAL
 *
 *     nextBillingDate reached
 *       -> charge fails            -> retrying    (notify, retries on the plan schedule)
 *       -> retries exhausted       -> grace_period  (3 days, charge may still succeed)
 *       -> grace expires           -> suspended     (read + fulfil, no new orders)
 *       -> 14 days                 -> expired       (subscription cancelled)
 *
 * There is no queue on this platform, so this ladder runs as an in-process cron in a
 * single pm2 instance. Every step below therefore carries a unique index and every
 * sweep is idempotent by construction.
 */
const SUBSCRIPTION_TRANSITIONS = {
  trial: ['active', 'payment_due', 'cancelled', 'expired'],
  active: ['payment_due', 'cancelled', 'expired'],
  payment_due: ['active', 'retrying', 'cancelled', 'expired'],
  retrying: ['active', 'grace_period', 'cancelled', 'expired'],
  grace_period: ['active', 'suspended', 'cancelled', 'expired'],
  suspended: ['active', 'expired', 'cancelled'],
  cancelled: ['active', 'expired'],
  expired: ['active'],
};

const assertSubscriptionTransition = (from, to) => {
  const allowed = SUBSCRIPTION_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Illegal subscription transition: ${from} -> ${to}. ` +
        `Allowed from ${from}: ${allowed.join(', ') || 'none'}`,
      true,
      '',
      { from, to, allowed }
    );
  }
  return true;
};

/**
 * BR-32 — the suspension capability matrix.
 *
 * The specification asks exactly this, so it is encoded rather than described.
 *
 * FULFILMENT IS NEVER BLOCKED. A suspended outlet must still deliver and settle what
 * customers already paid for. Blocking that is how a payment problem becomes a
 * customer-complaint and refund problem.
 *
 * `catalogue` and `inventory` are true only while the subscription is still in good
 * standing — grace period is the last point where an outlet can fix its catalogue.
 */
const SUBSCRIPTION_STATES = [
  'trial',
  'active',
  'payment_due',
  'retrying',
  'grace_period',
  'suspended',
  'cancelled',
  'expired',
];

const capabilitiesFor = (subscriptionState) => {
  const state = subscriptionState || 'expired';

  const good = ['trial', 'active'];
  const warning = ['payment_due', 'retrying'];
  const lastChance = ['grace_period'];
  const dead = ['suspended', 'cancelled', 'expired'];

  let catalogue = false;
  let inventory = false;
  let acceptNewOrders = false;
  let fulfilment = true;
  let finance = true;
  let planChange = true;
  let banner = null;

  if (good.includes(state)) {
    catalogue = true;
    inventory = true;
    acceptNewOrders = true;
  } else if (warning.includes(state)) {
    catalogue = true;
    inventory = true;
    acceptNewOrders = true; // with a visible warning banner
    banner = 'SUBSCRIPTION_PAST_DUE';
  } else if (lastChance.includes(state)) {
    catalogue = true;
    inventory = true;
    acceptNewOrders = false;
    banner = 'SUBSCRIPTION_GRACE_PERIOD';
  } else if (dead.includes(state)) {
    banner = 'SUBSCRIPTION_SUSPENDED';
  }

  if (!acceptNewOrders && !dead.includes(state)) banner = banner || 'SUBSCRIPTION_GRACE_PERIOD';

  return {
    state,
    viewDashboard: true,
    viewReviews: true,
    respondToReviews: true,
    manageCatalogue: catalogue,
    manageInventory: inventory,
    acceptNewOrders,
    // reject / cancel existing, picking, packing, dispatch, delivery, settlement view
    fulfilExisting: fulfilment,
    readSettlements: finance,
    managePayments: planChange,
    createPromotions: catalogue && !dead.includes(state),
    banner,
  };
};

/**
 * The subscription state that governs an outlet. Falls back to the most restrictive
 * assumption when nothing can be found — never to the permissive one.
 *
 * ## CHAIN-LEVEL, via the outlet's chain
 *
 * A partner pays once for the chain, so every outlet in it inherits the same state. A
 * chain with five outlets cannot have two of them trading while the other three are
 * suspended for non-payment.
 *
 * ## Why `effectiveStatus` and not `status`
 *
 * A trial that has run out is stored as `status: 'trial'` until the sweeper flips it.
 * Reading `status` directly would let a chain keep trading on a lapsed trial for as
 * long as the sweeper was late. `effectiveStatus` compares `trialEndsAt` against the
 * clock on the read, so the answer is correct immediately and the sweeper only makes it
 * durable.
 *
 * The query is NOT lean, for the same reason: a lean object has no virtuals. Reading
 * `sub.status` off a lean result after selecting `effectiveStatus` would silently be
 * the raw value again.
 *
 * @param {object} outlet a StoreOutlet document or a lean outlet with a `chain`
 * @returns {Promise<string>} one of the SUBSCRIPTION_STATUSES, never undefined
 */
const subscriptionStateFor = async (outlet) => {
  if (!outlet) {
    return 'expired';
  }

  // Accept either an id or a populated chain object.
  const chain = outlet.chain && outlet.chain._id ? outlet.chain._id : outlet.chain;

  if (!chain) {
    return 'expired';
  }

  const sub = await StoreSubscription.findOne({
    chain,
    status: { $in: ['trial', 'active', 'payment_due', 'retrying', 'grace_period', 'suspended'] },
  })
    .sort({ createdAt: -1 });

  if (!sub) return 'expired';

  // A hydrated document, so the virtual applies. Falls back to the raw status only if
  // the virtual is somehow absent.
  return sub.effectiveStatus || sub.status;
};

/**
 * BR-32 — refuse a mutation an outlet may not perform in its current state.
 *
 * Call this from every MUTATING service. Read paths deliberately do not call it, so a
 * suspended outlet can still read its history, its settlements and its reviews.
 *
 * @param {object} outlet        a StoreOutlet document (lean or hydrated)
 * @param {string} [operation]   'accept_order' | 'manage_catalogue' | 'create_promotion'
 */
const assertStoreOperational = async (outlet, operation = 'accept_order') => {
  if (!outlet) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Outlet not resolved');
  }

  const state = await subscriptionStateFor(outlet);
  const caps = capabilitiesFor(state);

  // A suspended outlet still accepts FULFILMENT operations.
  const fulfilmentOps = [
    'reject_order',
    'cancel_order',
    'pick',
    'pack',
    'dispatch',
    'assign_driver',
    'update_delivery',
    'process_return',
    'process_exchange',
  ];
  if (fulfilmentOps.includes(operation)) {
    if (outlet.status === 'archived') {
      throw new ApiError(httpStatus.FORBIDDEN, 'OUTLET_ARCHIVED');
    }
    return caps;
  }

  if (operation === 'manage_catalogue' && !caps.manageCatalogue) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUTLET_NOT_OPERATIONAL: the catalogue is read-only while the subscription is unresolved',
      true,
      '',
      { operation, subscriptionState: state, reasonCode: caps.banner }
    );
  }

  if (operation === 'manage_inventory' && !caps.manageInventory) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUTLET_NOT_OPERATIONAL: inventory is read-only while the subscription is unresolved',
      true,
      '',
      { operation, subscriptionState: state, reasonCode: caps.banner }
    );
  }

  if (operation === 'accept_order' && !caps.acceptNewOrders) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUTLET_NOT_OPERATIONAL: this outlet cannot accept new orders',
      true,
      '',
      { operation, subscriptionState: state, reasonCode: caps.banner }
    );
  }

  if (outlet.status === 'archived') {
    throw new ApiError(httpStatus.FORBIDDEN, 'OUTLET_ARCHIVED', true, '', { operation });
  }
  if (outlet.status === 'suspended' && !fulfilmentOps.includes(operation)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUTLET_SUSPENDED',
      true,
      '',
      { operation, status: outlet.status, reasonCode: outlet.suspension && outlet.suspension.reasonCode }
    );
  }

  return caps;
};

/**
 * Guards for entering `active`. This is the transition most worth defending, because
 * it is the only one that makes an outlet customer-visible.
 */
const assertCanBecomeActive = async ({ chain, outlet, mandatoryDocuments }) => {
  const problems = [];

  if (!chain || chain.status !== 'approved') {
    problems.push({ field: 'chain.status', message: 'chain must be approved first' });
  }
  if (outlet.status !== 'subscription_payment') {
    problems.push({
      field: 'outlet.status',
      message: `outlet must be in subscription_payment, is ${outlet.status}`,
    });
  }
  if (!outlet.location || !outlet.location.coordinates || !outlet.location.coordinates.length) {
    problems.push({ field: 'outlet.location', message: 'a map pin is required before activation' });
  }
  if (!outlet.categories || !outlet.categories.length) {
    problems.push({ field: 'outlet.categories', message: 'at least one category is required' });
  }
  if (!outlet.taxIdentity || !outlet.taxIdentity.gstin) {
    problems.push({ field: 'outlet.taxIdentity.gstin', message: 'GSTIN is required (BR-42)' });
  }

  const unapproved = (mandatoryDocuments || []).filter((d) => d.status !== 'approved');
  for (const doc of unapproved) {
    problems.push({
      field: `document.${doc.type}`,
      message: `mandatory document '${doc.type}' is ${doc.status}`,
    });
  }

  if (problems.length) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      'OUTLET_NOT_READY_FOR_ACTIVATION',
      true,
      '',
      { problems }
    );
  }
  return true;
};

/**
 * Move an outlet through the lifecycle, appending the history row that makes the
 * move auditable. Used by both the partner and the Admin paths.
 */
const changeOutletStatus = async ({ outlet, to, actor, actorRole, reason }) => {
  const from = outlet.status;
  assertTransition(from, to);

  if (to === 'suspended') {
    if (!reason || !reason.reasonCode) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'a suspension reasonCode is required',
        true,
        '',
        { allowed: SUSPENSION_REASONS }
      );
    }
    if (!SUSPENSION_REASONS.includes(reason.reasonCode)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `unknown suspension reasonCode '${reason.reasonCode}'`,
        true,
        '',
        { allowed: SUSPENSION_REASONS }
      );
    }
  }

  if (to === 'archived') {
    const openOrders = await mongoose.model('StoreOrder').countDocuments({
      outlet: outlet._id,
      lifecycle: { $nin: ['delivered', 'completed', 'cancelled', 'rejected'] },
    });
    if (openOrders > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `cannot archive: ${openOrders} order(s) are still open`,
        true,
        '',
        { openOrders }
      );
    }
  }

  const update = {
    status: to,
    statusChangedAt: new Date(),
    statusHistory: {
      from,
      to,
      by: actor ? actor._id || actor : undefined,
      actorRole,
      reason: reason ? reason.reasonCode || reason.reason : reason,
      at: new Date(),
    },
  };

  if (to === 'suspended') {
    update.suspension = {
      reasonCode: reason.reasonCode,
      reason: reason.reason,
      suspendedAt: new Date(),
      suspendedBy: actor ? actor._id || actor : undefined,
    };
    update.operational = false;
  }
  if (to === 'active' || to === 'reactivated') {
    update.operational = true;
    if (to === 'reactivated') update.suspension = { reactivatedAt: new Date() };
  }
  if (to !== 'active' && to !== 'reactivated') update.operational = false;

  const updated = await StoreOutlet.findByIdAndUpdate(outlet._id, { $set: update, $push: { statusHistory: update.statusHistory } }, { new: true });
  return updated;
};

/**
 * Recompute the cached `operational` flag. Called on status change and by the nightly
 * subscription sweep. Never call this from a money path — assert `status` there.
 */
const refreshOperational = async (outlet) => {
  const state = await subscriptionStateFor(outlet);
  const caps = capabilitiesFor(state);
  const operational = outlet.status === 'active' && caps.acceptNewOrders;
  if (outlet.operational !== operational) {
    await StoreOutlet.updateOne({ _id: outlet._id }, { $set: { operational } });
    outlet.operational = operational;
  }
  return operational;
};

module.exports = {
  LIFECYCLE_TRANSITIONS,
  SUBSCRIPTION_TRANSITIONS,
  SUSPENSION_REASONS,
  SUBSCRIPTION_STATES,
  assertTransition,
  assertSubscriptionTransition,
  capabilitiesFor,
  subscriptionStateFor,
  assertStoreOperational,
  assertCanBecomeActive,
  changeOutletStatus,
  refreshOperational,
};