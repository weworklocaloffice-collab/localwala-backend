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
 * dispatch.metrics.service.js — dispatch observability (Phase 3, task 3-5).
 *
 * ## The six numbers operations watches
 *
 *   timeToAssignP50/P95  dispatch start → rider accept, seconds. The engine's
 *                        headline SLA: every rung adds a TTL, so a P95 that
 *                        keeps climbing past rung 2 says the ladder — not the
 *                        riders — is slow.
 *   offerAcceptRate      accepted offers / broadcast offers. Falls when the
 *                        ranking offers the wrong riders.
 *   avgBatchSize         riders offered per rung. Tells whether the ladder's
 *                        batch sizes match reality or every rung is really a
 *                        single offer with extra steps.
 *   reassignmentCount    orders that needed more than one rung or a manual
 *                        override. Churn, not coverage.
 *   overrideRate         manual selections after an engine broadcast, per
 *                        restaurant. THE tuning signal: high means vendors keep
 *                        second-guessing the ranking, which is where tuning
 *                        effort goes (plan §10, task 3-5).
 *   slaBreaches          orders un-assigned past the SLA. The number Phase 0
 *                        made visible and Phase 1 started draining.
 *
 * All pure reads — no writes, no side effects — so this is safe to call from
 * a dashboard poller every minute.
 */

const mongoose = require('mongoose');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const { Orders, DriverNewOrderStatus, DispatchAttempt, DeliveryZone, Driver, Restaurant } = require('../models');
const OrderAssignmentEvent = require('../kernel/dispatch/models/order.assignment.event.model');

/**
 * Percentile over a numeric array. Linear interpolation between closest
 * ranks — the same method most dashboards use, so the number here matches the
 * number in Grafana for the same data.
 *
 * @param {number[]} values
 * @param {number} p 0..100
 * @returns {number|null} null when there is nothing to measure
 */
const percentile = (values, p) => {
  const nums = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (nums.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return nums[lo];
  return nums[lo] + (nums[hi] - nums[lo]) * (rank - lo);
};

const slaMinutes = () =>
  config.dispatch && Number.isFinite(Number(config.dispatch.slaMinutes))
    ? Number(config.dispatch.slaMinutes)
    : 10;

const matchScope = ({ restaurantId, since, until }) => {
  const match = {};
  if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) {
    match.restaurant = new mongoose.Types.ObjectId(restaurantId);
  }
  if (since || until) {
    match.createdAt = {};
    if (since) match.createdAt.$gte = new Date(since);
    if (until) match.createdAt.$lte = new Date(until);
  }
  return match;
};

/**
 * Seconds from dispatch start to accept, per order. Start is the first
 * `DispatchAttempt` for the order; accept is the first `accepted` offer.
 * Orders with attempts but no accept are still waiting and excluded — they
 * count under `slaBreaches`, not here.
 *
 * @param {object} scope { restaurantId, since, until }
 * @returns {Promise<number[]>}
 */
const timeToAssignSamples = async (scope = {}) => {
  const match = matchScope(scope);
  const accepted = await DriverNewOrderStatus.aggregate([
    { $match: { driverOrderStatus: 'accepted', ...(match.restaurant ? { restaurant: match.restaurant } : {}) } },
    { $group: { _id: '$orderId', acceptedAt: { $min: '$updatedAt' } } },
    { $limit: 2000 },
  ]);
  if (!accepted.length) return [];
  const orderIds = accepted.map((a) => a._id);
  const starts = await DispatchAttempt.aggregate([
    { $match: { order: { $in: orderIds } } },
    { $group: { _id: '$order', startedAt: { $min: '$createdAt' } } },
  ]);
  const startByOrder = new Map(starts.map((s) => [String(s._id), s.startedAt]));
  const samples = [];
  for (const a of accepted) {
    const started = startByOrder.get(String(a._id));
    if (!started || !a.acceptedAt) continue;
    const seconds = (new Date(a.acceptedAt).getTime() - new Date(started).getTime()) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0 && seconds < 24 * 3600) samples.push(seconds);
  }
  return samples;
};

/**
 * @param {object} [scope] { restaurantId, since, until }
 * @returns {Promise<object>} the six numbers
 */
const getDispatchMetrics = async (scope = {}) => {
  const match = matchScope(scope);
  const sla = slaMinutes();
  const slaCutoff = new Date(Date.now() - sla * 60 * 1000);

  const [attemptStats, offerStats, eventStats, reassignStats, breachCount] = await Promise.all([
    DispatchAttempt.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          rungs: { $sum: 1 },
          orders: { $addToSet: '$order' },
          batchSum: { $sum: { $ifNull: ['$batchSize', 0] } },
          offeredSum: { $sum: { $size: { $ifNull: ['$offeredTo', []] } } },
        },
      },
    ]),
    DriverNewOrderStatus.aggregate([
      {
        $match: {
          ...(match.restaurant ? { restaurant: match.restaurant } : {}),
          ...(match.createdAt ? { createdAt: match.createdAt } : {}),
        },
      },
      {
        $group: {
          _id: null,
          offered: {
            $sum: { $cond: [{ $in: ['$orderFrom', ['auto', 'automatically']] }, 1, 0] },
          },
          accepted: {
            $sum: { $cond: [{ $eq: ['$driverOrderStatus', 'accepted'] }, 1, 0] },
          },
          manual: {
            $sum: { $cond: [{ $in: ['$orderFrom', ['manually']] }, 1, 0] },
          },
        },
      },
    ]),
    OrderAssignmentEvent.aggregate([
      { $match: match },
      { $group: { _id: '$type', count: { $sum: 1 }, orders: { $addToSet: '$order' } } },
    ]),
    DispatchAttempt.aggregate([
      { $match: match },
      { $group: { _id: '$order', rungs: { $sum: 1 }, maxRound: { $max: '$round' } } },
      { $group: { _id: null, multiRungOrders: { $sum: { $cond: [{ $gt: ['$rungs', 1] }, 1, 0] } }, orders: { $sum: 1 } } },
    ]),
    Orders.countDocuments({
      ...(match.restaurant ? { restaurant: match.restaurant } : {}),
      driver: null,
      driverAssign: { $in: ['ideal', 'rejected', 'notfound'] },
      status: { $in: ['preparing', 'ready'] },
      createdAt: { $lt: slaCutoff },
    }),
  ]);

  const attempts = attemptStats[0] || { rungs: 0, orders: [], batchSum: 0, offeredSum: 0 };
  const offers = offerStats[0] || { offered: 0, accepted: 0, manual: 0 };
  const reassign = reassignStats[0] || { multiRungOrders: 0, orders: 0 };
  const byType = new Map((eventStats || []).map((e) => [e._id, e]));
  const orderCount = (attempts.orders || []).length || reassign.orders || 0;

  const samples = await timeToAssignSamples(scope);
  const dispatched = (byType.get('dispatched') || { count: 0 }).count;
  const overridden = (byType.get('overridden') || { count: 0 }).count;

  return {
    scope: {
      restaurantId: scope.restaurantId || null,
      since: scope.since || null,
      until: scope.until || null,
    },
    slaMinutes: sla,
    timeToAssignP50Seconds: percentile(samples, 50),
    timeToAssignP95Seconds: percentile(samples, 95),
    timeToAssignSamples: samples.length,
    offerAcceptRate: offers.offered > 0 ? Number((offers.accepted / offers.offered).toFixed(4)) : null,
    offersBroadcast: offers.offered,
    offersAccepted: offers.accepted,
    manualOffers: offers.manual,
    avgBatchSize:
      attempts.rungs > 0 ? Number((attempts.offeredSum / attempts.rungs).toFixed(2)) : null,
    dispatchRungs: attempts.rungs,
    ordersDispatched: orderCount,
    reassignmentCount: reassign.multiRungOrders,
    overrideRate:
      dispatched > 0 ? Number((overridden / dispatched).toFixed(4)) : null,
    overridden: overridden,
    slaBreaches: breachCount,
  };
};

/**
 * Per-zone dispatch metrics (Batch A-4) — the city-master's "what is
 * happening" dashboard. Same signals as `getDispatchMetrics`, grouped by the
 * customer-side zone tag, plus supply (riders heartbeat-tagged in the zone)
 * and an explicit `ungrouped` bucket. The ungrouped bucket is the review
 * trigger: volume there means the zone map is rotting.
 *
 * Pure reads, no writes — safe for dashboard polling.
 *
 * @param {string} cityId
 * @param {object} [scope] { since, until }
 * @returns {Promise<{cityId, slaMinutes, zones, ungrouped}>}
 */
const getZoneMetrics = async (cityId, scope = {}) => {
  if (!cityId || !mongoose.Types.ObjectId.isValid(cityId)) {
    throw new ApiError(400, 'City is not valid');
  }
  const sla = slaMinutes();
  const slaCutoff = new Date(Date.now() - sla * 60 * 1000);
  const timeWindow = {};
  if (scope.since) timeWindow.$gte = new Date(scope.since);
  if (scope.until) timeWindow.$lte = new Date(scope.until);

  const zones = await DeliveryZone.find({
    city: new mongoose.Types.ObjectId(cityId),
    status: true,
  })
    .sort({ name: 1 })
    .lean();
  const restaurants = await Restaurant.find(
    { city: new mongoose.Types.ObjectId(cityId) },
    { _id: 1 }
  ).lean();
  const restaurantIds = restaurants.map((r) => r._id);

  const eventMatch = { restaurant: { $in: restaurantIds } };
  if (timeWindow.$gte || timeWindow.$lte) eventMatch.createdAt = timeWindow;

  const [eventsByZone, attemptsByZone, supplyByZone, pendingByZone, breachByZone, acceptedSamples] =
    await Promise.all([
      OrderAssignmentEvent.aggregate([
        { $match: eventMatch },
        { $group: { _id: { zone: '$zone', type: '$type' }, count: { $sum: 1 } } },
      ]),
      DispatchAttempt.aggregate([
        {
          $match: {
            restaurant: { $in: restaurantIds },
            ...(timeWindow.$gte || timeWindow.$lte ? { createdAt: timeWindow } : {}),
          },
        },
        {
          $group: {
            _id: '$zone',
            rungs: { $sum: 1 },
            offeredSum: { $sum: { $size: { $ifNull: ['$offeredTo', []] } } },
          },
        },
      ]),
      Driver.aggregate([
        {
          $match: {
            city: new mongoose.Types.ObjectId(cityId),
            activeStatus: true,
            status: true,
            isBlocked: { $ne: true },
          },
        },
        { $group: { _id: '$zone', riders: { $sum: 1 } } },
      ]),
      Orders.aggregate([
        {
          $match: {
            restaurant: { $in: restaurantIds },
            driver: null,
            status: { $in: ['preparing', 'ready'] },
          },
        },
        { $group: { _id: '$zone', orders: { $sum: 1 } } },
      ]),
      Orders.aggregate([
        {
          $match: {
            restaurant: { $in: restaurantIds },
            driver: null,
            status: { $in: ['preparing', 'ready'] },
            createdAt: { $lt: slaCutoff },
          },
        },
        { $group: { _id: '$zone', orders: { $sum: 1 } } },
      ]),
      DriverNewOrderStatus.aggregate([
        { $match: { restaurant: { $in: restaurantIds }, driverOrderStatus: 'accepted' } },
        { $group: { _id: '$orderId', acceptedAt: { $min: '$updatedAt' } } },
        { $limit: 2000 },
      ]),
    ]);

  // Time-to-assign per zone: order's own zone tag decides the bucket, start is
  // dispatch start when the engine ran, else order creation.
  const samplesByZone = new Map();
  if (acceptedSamples.length) {
    const orderIds = acceptedSamples.map((a) => a._id);
    const orderRows = await Orders.find(
      { _id: { $in: orderIds } },
      { zone: 1, dispatchStartedAt: 1, createdAt: 1 }
    ).lean();
    const orderById = new Map(orderRows.map((o) => [String(o._id), o]));
    for (const a of acceptedSamples) {
      const o = orderById.get(String(a._id));
      if (!o || !a.acceptedAt) continue;
      const start = o.dispatchStartedAt || o.createdAt;
      if (!start) continue;
      const seconds = (new Date(a.acceptedAt).getTime() - new Date(start).getTime()) / 1000;
      if (!Number.isFinite(seconds) || seconds < 0 || seconds >= 24 * 3600) continue;
      const key = o.zone ? String(o.zone) : null;
      if (!samplesByZone.has(key)) samplesByZone.set(key, []);
      samplesByZone.get(key).push(seconds);
    }
  }

  const countBy = (rows, keyFn) => {
    const map = new Map();
    for (const r of rows) {
      const key = keyFn(r);
      map.set(key, r);
    }
    return map;
  };
  const eventCounts = new Map();
  for (const e of eventsByZone) {
    const z = e._id.zone ? String(e._id.zone) : null;
    if (!eventCounts.has(z)) eventCounts.set(z, new Map());
    eventCounts.get(z).set(e._id.type, e.count);
  }
  const attempts = countBy(attemptsByZone, (r) => (r._id ? String(r._id) : null));
  const supply = countBy(supplyByZone, (r) => (r._id ? String(r._id) : null));
  const pending = countBy(pendingByZone, (r) => (r._id ? String(r._id) : null));
  const breaches = countBy(breachByZone, (r) => (r._id ? String(r._id) : null));

  const rowFor = (zoneId, name, version) => {
    const types = eventCounts.get(zoneId) || new Map();
    const offered = types.get('offered') || 0;
    const accepted = types.get('accepted') || 0;
    const att = attempts.get(zoneId) || { rungs: 0, offeredSum: 0 };
    const samples = samplesByZone.get(zoneId) || [];
    return {
      zone: zoneId,
      name,
      version,
      pending: (pending.get(zoneId) || { orders: 0 }).orders,
      slaBreaches: (breaches.get(zoneId) || { orders: 0 }).orders,
      activeRiders: (supply.get(zoneId) || { riders: 0 }).riders,
      offersBroadcast: types.get('dispatched') || 0,
      offersAccepted: accepted,
      offerAcceptRate: offered > 0 ? Number((accepted / offered).toFixed(4)) : null,
      dispatchRungs: att.rungs,
      avgBatchSize: att.rungs > 0 ? Number((att.offeredSum / att.rungs).toFixed(2)) : null,
      overridden: types.get('overridden') || 0,
      notfound: types.get('notfound') || 0,
      timeToAssignP50Seconds: percentile(samples, 50),
      timeToAssignP95Seconds: percentile(samples, 95),
    };
  };

  return {
    cityId: String(cityId),
    slaMinutes: sla,
    zones: zones.map((z) => rowFor(String(z._id), z.name, z.version)),
    ungrouped: rowFor(null, 'Ungrouped', null),
  };
};

module.exports = {
  percentile,
  slaMinutes,
  timeToAssignSamples,
  getDispatchMetrics,
  getZoneMetrics,
};
