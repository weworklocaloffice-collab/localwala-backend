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
 * dispatch.service.js — the food vertical's rider-assignment engine.
 *
 * ## What replaced
 *
 * A single `$geoNear` query that offered the order to exactly one rider and then
 * waited forever. Nothing timed out, nothing escalated, and an order whose rider
 * ignored the push sat at `driverAssign: 'ideal'` where no operations queue could
 * see it.
 *
 * ## The ladder
 *
 *     round 0   2 km   offer 1 rider   wait 30s
 *     round 1   4 km   offer 3 riders  wait 45s
 *     round 2   8 km   offer 5 riders  wait 60s
 *     exhausted         driverAssign = 'notfound'   (retryable)
 *                        driverAssign = 'hardreject' once attempts are spent
 *
 * Each rung is a broadcast, not a single offer, so one silent rider does not stop
 * the order. The radius never exceeds `BusinessSettings.deliveryArea` converted to
 * metres, so the ladder cannot dispatch further than the platform already allows.
 *
 * ## Atomicity without transactions
 *
 * Two riders can tap Accept in the same instant. The contended resource is the
 * `Orders.driver` field, and a single-document `findOneAndUpdate` with
 * `driver: null` in the filter is atomic on any deployment, replica set or not.
 * `src/utils/optionalTransaction.js` exists for genuinely multi-document writes;
 * this is not one, and avoiding it means the accept path keeps working on a
 * standalone mongod.
 *
 * ## Rollout
 *
 * `DISPATCH_CASCADE_ENABLED=false` (the default) leaves `autoDriverNewOrder`
 * exactly as it was. With it off the engine still records what it *would* have
 * done, so the ranking can be compared against real assignments before anyone
 * depends on it. See `shadowDispatch()`.
 */

const { status: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const config = require('../config/config');
const { resolveRiderPool, buildPoolQuery, resolveDeliveryRadius } = require('../utils/rider.pool');
const { resolveDeliveryPolicy } = require('../utils/delivery.policy');
const { computeSurgeMultiplier } = require('../kernel/dispatch/dispatch.surge');
const { recordAssignmentEvent, recordOfferedEvents, orderZoneTag } = require('./dispatch.events.service');
const { assertFoodDriverAssignTransition } = require('./food.delivery.transitions');
const { emitToUsers } = require('../utils/socket.emitter');
const { rankCandidates } = require('../kernel/dispatch/dispatch.scoring');
const { Orders, Driver, Restaurant, DriverNewOrderStatus, DispatchAttempt } = require('../models');

/**
 * The escalation ladder. Radii in metres.
 *
 * Tuned against a dense city: the first rung is walkable, and the last rung
 * reaches the edge of a typical 8 km delivery zone. The zone ceiling from
 * `BusinessSettings` still clamps whatever this says.
 */
const DEFAULT_LADDER = Object.freeze([
  Object.freeze({ radiusMeters: 2000, batchSize: 1, ttlSeconds: 30 }),
  Object.freeze({ radiusMeters: 4000, batchSize: 3, ttlSeconds: 45 }),
  Object.freeze({ radiusMeters: 8000, batchSize: 5, ttlSeconds: 60 }),
]);

/** Offer states that mean "nobody has taken this yet". */
const LIVE_OFFER_STATUSES = ['ideal'];

/** Anything past this means the order is already spoken for. */
const TERMINAL_OFFER_STATUSES = [
  'accepted',
  'driver_reached_restaurant',
  'driver_pickpup_order',
  'driver_reached_customer',
  'delivered',
  'accepted_another',
];

/** Order statuses at which a rider can still be dispatched. */
const DISPATCHABLE_ORDER_STATUSES = ['preparing', 'ready'];

const isCascadeEnabled = () =>
  config.dispatch && config.dispatch.cascadeEnabled === true;

/** The ladder, clamped to the platform's configured delivery area. */
const resolveLadder = async () => {
  const { radiusMeters } = await resolveDeliveryRadius();
  const configured = config.dispatch && Array.isArray(config.dispatch.ladder)
    ? config.dispatch.ladder
    : DEFAULT_LADDER;
  const ladder = configured.length ? configured : DEFAULT_LADDER;

  return {
    ladder,
    zoneCeilingMeters: radiusMeters,
    maxAttempts: (config.dispatch && config.dispatch.maxAttempts) || ladder.length,
  };
};

/**
 * Per-restaurant ladder (Phase 3, task 3-1). A restaurant's `deliveryConfig`
 * overrides per field; every absent field falls back to the platform values
 * from `resolveLadder()`, so a restaurant without a config dispatches exactly
 * as before. Deleting the config restores the old behaviour with no migration.
 *
 * @param {string} restaurantId
 * @returns {Promise<{ladder, zoneCeilingMeters, maxAttempts, policy}>}
 */
const resolveLadderForRestaurant = async (restaurantId) => {
  const platform = await resolveLadder();
  if (!restaurantId) return { ...platform, policy: null };
  let policy = null;
  try {
    policy = await resolveDeliveryPolicy(restaurantId);
  } catch (e) {
    logger.warn(`delivery policy fallback for restaurant ${restaurantId}: ${e.message}`);
    return { ...platform, policy: null };
  }
  return {
    ladder: policy.ladder && policy.ladder.length ? policy.ladder : platform.ladder,
    zoneCeilingMeters: policy.radiusMeters || platform.zoneCeilingMeters,
    maxAttempts: policy.maxAttempts || platform.maxAttempts,
    policy,
  };
};

/**
 * Best-effort surge quote for a rung. Informational: the multiplier is
 * snapshotted onto the order so operations can see peak pressure per rung,
 * but the charged total is never touched — checkout adoption is a separate
 * step. Never throws; a failed quote resolves to "no surge".
 *
 * Two demand lenses (Batch C-2): the restaurant's own backlog and, when the
 * order is zone-tagged, the zone's backlog. The higher quote wins — a quiet
 * kitchen in a slammed zone still prices the zone's pressure, and vice versa.
 *
 * @param {object} policy from `resolveDeliveryPolicy` (or null)
 * @param {string} restaurantId
 * @param {number} activeRiders candidates ranked for this rung
 * @param {string|null} [orderZoneId] customer-side zone for the zone lens
 * @returns {Promise<{multiplier: number, reason: string}>}
 */
const quoteSurgeForRung = async (policy, restaurantId, activeRiders, orderZoneId = null) => {
  try {
    const surgePolicy = (policy && policy.surge) || null;
    if (!surgePolicy || surgePolicy.enabled !== true) return { multiplier: 1, reason: 'surge_disabled' };
    let pendingOrders = 0;
    try {
      pendingOrders = await DriverNewOrderStatus.countDocuments({
        restaurant: new mongoose.Types.ObjectId(restaurantId),
        driverOrderStatus: 'ideal',
      }).maxTimeMS(2000);
    } catch {
      pendingOrders = 0;
    }
    const base = computeSurgeMultiplier({
      policy: surgePolicy,
      at: new Date(),
      pendingOrders,
      activeRiders,
    });

    // Zone lens: unassigned orders in the zone vs riders heartbeat-tagged
    // there. Assignment stays proximity-open; only the quote is zone-aware.
    if (orderZoneId && mongoose.Types.ObjectId.isValid(orderZoneId)) {
      try {
        const zoneOrderIds = await Orders.distinct('_id', {
          zone: new mongoose.Types.ObjectId(orderZoneId),
          driver: null,
          status: { $in: ['preparing', 'ready'] },
        }).maxTimeMS(2000);
        const [zonePending, zoneRiders] = await Promise.all([
          zoneOrderIds.length
            ? DriverNewOrderStatus.countDocuments({
                orderId: { $in: zoneOrderIds },
                driverOrderStatus: 'ideal',
              }).maxTimeMS(2000)
            : 0,
          Driver.countDocuments({
            zone: new mongoose.Types.ObjectId(orderZoneId),
            activeStatus: true,
            status: true,
            isBlocked: { $ne: true },
          }).maxTimeMS(2000),
        ]);
        const zoned = computeSurgeMultiplier({
          policy: surgePolicy,
          at: new Date(),
          pendingOrders: zonePending,
          activeRiders: zoneRiders,
        });
        if (zoned.multiplier > base.multiplier) {
          return { multiplier: zoned.multiplier, reason: 'high_demand_zone' };
        }
      } catch {
        /* zone lens is advisory; the restaurant quote stands */
      }
    }
    return { multiplier: base.multiplier, reason: base.reason };
  } catch {
    return { multiplier: 1, reason: 'surge_quote_failed' };
  }
};

/**
 * Rung `round`, clamped so the ladder can never dispatch outside the platform's
 * configured delivery zone. Without the clamp a wider ladder rung would silently
 * override `BusinessSettings.deliveryArea`.
 */
const rungFor = (ladder, round, radiusCeiling) => {
  const index = Math.min(Math.max(round, 0), ladder.length - 1);
  const rung = ladder[index];
  const requestedMeters = rung.radiusMeters;
  const effectiveMeters = radiusCeiling > 0 ? Math.min(requestedMeters, radiusCeiling) : requestedMeters;
  return {
    ...rung,
    radiusMeters: effectiveMeters,
    requestedRadiusMeters: requestedMeters,
    clamped: effectiveMeters !== requestedMeters,
  };
};

/**
 * Count how many live offers an order already has.
 *
 * Used as the idempotency guard: a second `dispatch()` for an order that is
 * already on the ladder must not broadcast a second wave on top of the first.
 */
const countLiveOffers = (orderId) =>
  DriverNewOrderStatus.countDocuments({
    orderId: new mongoose.Types.ObjectId(orderId),
    driverOrderStatus: { $in: LIVE_OFFER_STATUSES },
  });

/**
 * Riders who already declined this order. Re-offering to them on a later rung is
 * the single most common way a dispatch loop burns itself out.
 */
const rejectedDriverIds = (orderId) =>
  DriverNewOrderStatus.find(
    { orderId: new mongoose.Types.ObjectId(orderId), driverOrderStatus: 'rejected' },
    { driver: 1 }
  ).then((rows) => rows.map((r) => r.driver));

/**
 * Rank the pool for an order and return the top `batchSize` candidates.
 *
 * @param {string|null} [orderZoneId] customer-side zone for the affinity nudge
 * @returns {Promise<Array<{userId, score, distanceKm, etaMinutes, factors}>>}
 */
const selectCandidates = async (order, restaurantInfo, pool, rung, orderZoneId = null) => {
  const coords = restaurantInfo && restaurantInfo.location && restaurantInfo.location.coordinates;
  if (!coords || coords.length < 2) return [];

  const rejected = await rejectedDriverIds(order._id);
  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [coords[0], coords[1]] },
        maxDistance: rung.radiusMeters,
        distanceField: 'distanceKmRaw',
        distanceMultiplier: 1 / 1000,
        query: buildPoolQuery(pool, { userId: { $nin: rejected } }),
      },
    },
    // Keep the candidate set small before scoring. 20x the batch is ample headroom
    // for the score to reorder them, and bounds the work per dispatch.
    { $limit: Math.max(rung.batchSize * 5, 10) },
  ];

  const rows = await Driver.aggregate(pipeline);
  const rejectsByDriver = new Map();
  for (const id of rejected) {
    rejectsByDriver.set(String(id), (rejectsByDriver.get(String(id)) || 0) + 1);
  }

  const radiusKm = rung.radiusMeters / 1000;
  const ranked = rankCandidates(
    rows.map((r) => ({
      userId: r.userId,
      orderHandling: r.orderHandling,
      maxOrderLimit: pool.maxOrderLimit,
      rating: r.rating,
      updatedAt: r.updatedAt,
      isOwnFleet: pool.isOwnFleet,
      priorRejects: rejectsByDriver.get(String(r.userId)) || 0,
      distanceKm: r.distanceKmRaw,
      radiusKm,
      zoneId: r.zone ? String(r.zone) : null,
      orderZoneId: orderZoneId ? String(orderZoneId) : null,
    }))
  );

  return ranked.slice(0, rung.batchSize);
};

/**
 * Broadcast one rung.
 *
 * @param {string} orderId
 * @param {string} restaurantId
 * @param {number} round
 * @param {string} trigger auto | reject | expiry | admin
 * @returns {Promise<{attempt: Object|null, offered: Object[]}>}
 */
const broadcastRung = async (orderId, restaurantId, round, trigger = 'auto') => {
  const order = await Orders.findById(orderId, {
    restaurant: 1,
    deliveryAddressRaw: 1,
    status: 1,
    driver: 1,
    driverAssign: 1,
  });
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  // Someone may have accepted while this rung was being prepared.
  if (order.driver || order.status === 'delivered') {
    return { attempt: null, offered: [] };
  }

  const pool = await resolveRiderPool(restaurantId);
  const { ladder, zoneCeilingMeters, policy } = await resolveLadderForRestaurant(restaurantId);
  // fleetFirst === false on an own-fleet restaurant means "platform backup"
  // (Batch E-3): the vendor's riders are unavailable (off-shift, short-staffed)
  // so this dispatch draws from the platform pool instead of offering nobody.
  // Engine-only: the manual picker keeps showing the vendor's own roster, and
  // an absent/null flag preserves today's own-fleet behaviour.
  const effectivePool =
    pool.isOwnFleet && policy && policy.fleetFirst === false
      ? { ...pool, isOwnFleet: false, fleetOwnerRestaurantId: null }
      : pool;
  const rung = rungFor(ladder, round, zoneCeilingMeters);
  const restaurantInfo = await Restaurant.findById(restaurantId, { location: 1, name: 1 });

  // Tagged before ranking: the customer-side zone feeds the affinity nudge.
  const zoneTag = await orderZoneTag(order._id);
  const candidates = await selectCandidates(order, restaurantInfo, effectivePool, rung, zoneTag.zone);

  // Recorded before the writes, so a crash mid-broadcast is still auditable.
  const attempt = await DispatchAttempt.create({
    order: order._id,
    restaurant: restaurantId,
    round,
    radiusMeters: rung.radiusMeters,
    batchSize: rung.batchSize,
    pool: effectivePool.isOwnFleet ? 'own_fleet' : 'platform',
    candidateCount: candidates.length,
    offeredTo: candidates.map((c) => c.userId),
    outcome: candidates.length ? 'broadcast' : 'no_candidates',
    expiresAt: new Date(Date.now() + rung.ttlSeconds * 1000),
    trigger,
    zone: zoneTag.zone ? new mongoose.Types.ObjectId(zoneTag.zone) : null,
    zoneVersion: zoneTag.zoneVersion,
  });

  if (!candidates.length) {
    return { attempt, offered: [] };
  }

  const expiresAt = new Date(Date.now() + rung.ttlSeconds * 1000);
  const offered = await DriverNewOrderStatus.insertMany(
    candidates.map((c) => ({
      orderId: order._id,
      driver: c.userId,
      restaurant: restaurantId,
      deliveryAddressRaw: order.deliveryAddressRaw,
      driverOrderStatus: 'ideal',
      orderFrom: 'auto',
      expiresAt,
      offerRound: round,
      dispatchScore: c.score,
      dispatchDistance: c.distanceKm,
      dispatchEtaMinutes: c.etaMinutes,
      dispatchFactors: c.factors,
    }))
  );

  await Orders.updateOne(
    { _id: order._id },
    {
      $set: {
        dispatchRound: round,
        dispatchAttempts: Math.max(round + 1, (order.dispatchAttempts || 0) + 1),
        dispatchLastAttemptAt: new Date(),
      },
      $setOnInsert: { dispatchStartedAt: new Date() },
    }
  );

  // Surge snapshot + audit trail. Both best-effort: neither may fail the
  // broadcast they describe.
  const surge = await quoteSurgeForRung(policy, restaurantId, candidates.length, zoneTag.zone);
  if (surge.multiplier !== 1) {
    await Orders.updateOne(
      { _id: order._id },
      { $set: { surgeMultiplier: surge.multiplier, surgeReason: surge.reason, surgeAppliedAt: new Date() } }
    ).catch(() => null);
  }
  await recordAssignmentEvent({
    order: String(order._id),
    restaurant: String(restaurantId),
    type: 'dispatched',
    actorType: 'system',
    reason: trigger,
    pool: effectivePool.isOwnFleet ? 'own_fleet' : 'platform',
    round,
    ...zoneTag,
  });
  await recordOfferedEvents({
    order: String(order._id),
    restaurant: String(restaurantId),
    riders: candidates,
    pool: effectivePool.isOwnFleet ? 'own_fleet' : 'platform',
    round,
    ...zoneTag,
  });

  // Realtime in addition to FCM. Before this, an offer only reached the rider
  // through a push notification or by polling `GET /driver/orders/newOrder`, so
  // an offer that a rider was looking at the screen for could sit unnoticed for
  // as long as the TTL.
  emitToUsers(
    candidates.map((c) => c.userId),
    'driver:newOffer',
    (userId) => ({
      orderId: String(order._id),
      restaurantId: String(restaurantId),
      round,
      offerCount: candidates.length,
      distanceKm: Number(candidates.find((c) => String(c.userId) === String(userId))?.distanceKm ?? 0),
      etaMinutes: candidates.find((c) => String(c.userId) === String(userId))?.etaMinutes ?? null,
      expiresAt,
    })
  );

  return { attempt, offered };
};

/**
 * Close the current rung and move to the next, or give up.
 *
 * @returns {Promise<{status: 'escalated'|'exhausted'|'terminal', round: number}>}
 */
const escalate = async (orderId, restaurantId, trigger = 'expiry') => {
  const order = await Orders.findById(orderId, {
    restaurant: 1,
    dispatchRound: 1,
    dispatchAttempts: 1,
    driver: 1,
    driverAssign: 1,
    status: 1,
  });
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  if (order.driver || TERMINAL_OFFER_STATUSES.includes(order.driverAssign)) {
    return { status: 'terminal', round: order.dispatchRound || 0 };
  }

  const { ladder, maxAttempts } = await resolveLadderForRestaurant(restaurantId);
  const nextRound = (order.dispatchRound || 0) + 1;
  const attempts = order.dispatchAttempts || 0;

  if (nextRound >= ladder.length || attempts >= maxAttempts) {
    // Attempts spent: the engine will not try again on its own, so this is the
    // terminal state. Anything short of that stays retryable.
    const terminal = attempts >= maxAttempts;
    const target = terminal ? 'hardreject' : 'notfound';
    // Already terminal (a retry racing the sweep) — leave the row alone.
    // Writing `hardreject` over `hardreject` is not a transition the table
    // allows, and asserting it would turn a harmless retry into a 409.
    if (order.driverAssign !== target) {
      assertFoodDriverAssignTransition(order.driverAssign || 'ideal', target);
      await Orders.updateOne(
        { _id: order._id },
        {
          $set: {
            driverAssign: target,
            dispatchExhaustedAt: new Date(),
          },
        }
      );
    }
    await DispatchAttempt.updateMany(
      { order: order._id, outcome: 'broadcast' },
      { $set: { outcome: 'exhausted', resolvedAt: new Date() } }
    );
    await recordAssignmentEvent({
      order: String(order._id),
      restaurant: String(restaurantId || order.restaurant),
      type: 'notfound',
      actorType: 'system',
      reason: terminal ? 'attempts_spent' : 'ladder_exhausted',
      round: nextRound,
      ...(await orderZoneTag(order._id)),
    });
    logger.warn(
      `dispatch exhausted for order ${order._id} after ${attempts} attempt(s); ` +
        `driverAssign=${target}`
    );
    return { status: 'exhausted', round: nextRound };
  }

  await DriverNewOrderStatus.updateMany(
    { orderId: order._id, driverOrderStatus: { $in: LIVE_OFFER_STATUSES } },
    { $set: { driverOrderStatus: 'cancelled' } }
  );

  const result = await broadcastRung(order._id, restaurantId, nextRound, trigger);
  await recordAssignmentEvent({
    order: String(order._id),
    restaurant: String(restaurantId || order.restaurant),
    type: 'escalated',
    actorType: 'system',
    reason: trigger,
    round: nextRound,
    ...(await orderZoneTag(order._id)),
  });
  return { status: 'escalated', round: nextRound, offered: result.offered.length };
};

/**
 * Entry point. Safe to call repeatedly: an order already carrying live offers is
 * left alone, so a retried webhook cannot fan out duplicate waves.
 *
 * @param {string} orderId
 * @param {string} restaurantId
 * @returns {Promise<{status: string, offered?: number, reason?: string}>}
 */
const dispatch = async (orderId, restaurantId) => {
  if (!isCascadeEnabled()) {
    return { status: 'disabled', reason: 'DISPATCH_CASCADE_ENABLED is off' };
  }

  const order = await Orders.findById(orderId, {
    restaurant: 1,
    driver: 1,
    driverAssign: 1,
    status: 1,
    orderTo: 1,
  });
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  if (order.orderTo !== 'homedelivery') {
    return { status: 'skipped', reason: 'not a home delivery' };
  }
  if (order.driver) {
    return { status: 'skipped', reason: 'already has a rider' };
  }
  if (!DISPATCHABLE_ORDER_STATUSES.includes(order.status)) {
    return { status: 'skipped', reason: `order status ${order.status} is not dispatchable` };
  }

  const live = await countLiveOffers(orderId);
  if (live > 0) {
    return { status: 'skipped', reason: `${live} live offer(s) already outstanding` };
  }

  const result = await broadcastRung(orderId, restaurantId, 0, 'auto');
  return {
    status: result.offered.length ? 'broadcast' : 'no_candidates',
    offered: result.offered.length,
  };
};

/**
 * Record what the ladder *would* have done, without sending anything.
 *
 * This is what makes a safe rollout possible: run with the ladder off, compare
 * the ranked candidates against who actually took the order, and only then turn
 * it on.
 */
const shadowDispatch = async (orderId, restaurantId) => {
  try {
    const pool = await resolveRiderPool(restaurantId);
    // Per-restaurant ladder, so the shadow comparison reflects what the live
    // ladder would actually do for this restaurant — not the platform default.
    const { ladder, zoneCeilingMeters, policy } = await resolveLadderForRestaurant(restaurantId);
    const effectivePool =
      pool.isOwnFleet && policy && policy.fleetFirst === false
        ? { ...pool, isOwnFleet: false, fleetOwnerRestaurantId: null }
        : pool;
    const rung = rungFor(ladder, 0, zoneCeilingMeters);
    const order = await Orders.findById(orderId, { deliveryAddressRaw: 1 });
    if (!order) return null;
    const restaurantInfo = await Restaurant.findById(restaurantId, { location: 1 });
    // orderZoneTag never throws (best-effort by contract); untagged orders
    // simply rank with a neutral affinity factor.
    const zoneTag = await orderZoneTag(orderId);
    const candidates = await selectCandidates(order, restaurantInfo, effectivePool, rung, zoneTag.zone);
    return {
      orderId,
      wouldOffer: candidates.map((c) => ({
        driver: c.userId,
        score: c.score,
        distanceKm: c.distanceKm,
        etaMinutes: c.etaMinutes,
      })),
    };
  } catch (e) {
    // Shadow mode must never affect the order it is observing.
    logger.warn(`shadow dispatch failed for order ${orderId}: ${e.message}`);
    return null;
  }
};

/**
 * Cron sweep: close every offer whose TTL has run out and escalate its order.
 *
 * This is the function whose absence is why orders used to hang forever — the
 * engine had no clock of its own, so a silent rider stalled the order until a
 * person noticed.
 *
 * @param {object} [options]
 * @param {number} [options.limit]
 * @returns {Promise<{swept: number, escalated: number, terminal: number}>}
 */
const expireOffers = async (options = {}) => {
  const limit = options.limit || 200;
  const now = new Date();

  const expired = await DriverNewOrderStatus.find({
    driverOrderStatus: { $in: LIVE_OFFER_STATUSES },
    expiresAt: { $ne: null, $lt: now },
  })
    .limit(limit)
    .lean();

  if (!expired.length) return { swept: 0, escalated: 0, terminal: 0 };

  const orderIds = [...new Set(expired.map((o) => String(o.orderId)))];
  const res = await DriverNewOrderStatus.updateMany(
    { _id: { $in: expired.map((o) => o._id) } },
    { $set: { driverOrderStatus: 'cancelled' } }
  );

  let escalated = 0;
  let terminal = 0;
  for (const orderId of orderIds) {
    try {
      const order = await Orders.findById(orderId, { restaurant: 1, driver: 1, driverAssign: 1 });
      if (!order || order.driver) continue;
      await recordAssignmentEvent({
        order: String(orderId),
        restaurant: order.restaurant ? String(order.restaurant) : null,
        type: 'expired',
        actorType: 'system',
        reason: 'offer_ttl_elapsed',
        ...(await orderZoneTag(orderId)),
      });
      const result = await escalate(orderId, order.restaurant, 'expiry');
      if (result.status === 'escalated') escalated += 1;
      if (result.status === 'exhausted' || result.status === 'terminal') terminal += 1;
    } catch (e) {
      logger.error(`dispatch expiry failed for order ${orderId}: ${e.message}`);
    }
  }

  logger.info(
    `dispatch sweep: ${res.modifiedCount} offer(s) expired across ${orderIds.length} order(s); ` +
      `${escalated} escalated, ${terminal} terminal`
  );
  return { swept: res.modifiedCount, escalated, terminal };
};

/**
 * Re-dispatch after a rider declines.
 *
 * Lives here, not in the controller, so that the decline path, the expiry sweep
 * and a future manual retry all go through one implementation.
 */
const onDriverRejected = async (orderId, restaurantId) => {
  if (!isCascadeEnabled()) return { status: 'disabled' };
  return escalate(orderId, restaurantId, 'reject');
};

module.exports = {
  DEFAULT_LADDER,
  LIVE_OFFER_STATUSES,
  TERMINAL_OFFER_STATUSES,
  DISPATCHABLE_ORDER_STATUSES,
  isCascadeEnabled,
  resolveLadder,
  resolveLadderForRestaurant,
  quoteSurgeForRung,
  rungFor,
  countLiveOffers,
  selectCandidates,
  broadcastRung,
  escalate,
  dispatch,
  shadowDispatch,
  expireOffers,
  onDriverRejected,
};
