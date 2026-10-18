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
 * dispatch.shadow.compare.js — the cascade enablement report (Batch C-3).
 *
 * Run: node scripts/dispatch.shadow.compare.js [--days 7] [--restaurant <id>]
 *
 * ## Why this exists
 *
 * The ladder ships behind `DISPATCH_CASCADE_ENABLED=false`, and the rollout
 * plan says: run in shadow mode, compare what the ladder *would* have offered
 * against who actually took each order, then turn it on. This script is that
 * comparison: for every order accepted in the window it replays the ranking
 * *now* and reports whether the real acceptor was in the would-offer set.
 *
 * ## Read-only, exit 0
 *
 * A report tool, not a verify suite: it never writes, never fails the run on
 * low numbers. Low hit rate is a finding (retune before enabling), not an
 * error. Empty database → zeros, not a crash.
 *
 * ## The honest approximation
 *
 * Rider positions move, so a replay *now* is not the ranking *then*. Treat
 * the hit rate as directional: consistently high means the ranking agrees
 * with reality; consistently low means it disagrees and the flag stays off.
 * Pair with the override rate (`getDispatchMetrics`) — both must look
 * healthy before enablement.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const dispatchService = require('../src/services/dispatch.service');
const { Orders, DriverNewOrderStatus, DispatchAttempt } = require('../src/models');

const args = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const run = async () => {
  const days = Number(argOf('--days', 7)) > 0 ? Number(argOf('--days', 7)) : 7;
  const restaurantFilter = argOf('--restaurant', null);
  if (restaurantFilter && !mongoose.Types.ObjectId.isValid(restaurantFilter)) {
    console.log(JSON.stringify({ error: 'restaurant is not a valid id' }));
    return;
  }

  await mongoose.connect(process.env.MONGODB_URL);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const offerMatch = { driverOrderStatus: 'accepted', updatedAt: { $gte: since } };
  if (restaurantFilter) offerMatch.restaurant = new mongoose.Types.ObjectId(restaurantFilter);

  const accepted = await DriverNewOrderStatus.aggregate([
    { $match: offerMatch },
    { $group: { _id: '$orderId', driver: { $first: '$driver' }, acceptedAt: { $min: '$updatedAt' } } },
    { $limit: 500 },
  ]);

  const attemptMatch = { createdAt: { $gte: since } };
  if (restaurantFilter) attemptMatch.restaurant = new mongoose.Types.ObjectId(restaurantFilter);
  const dispatchedOrders = await DispatchAttempt.distinct('order', attemptMatch);

  let replayed = 0;
  let hits = 0;
  let skipped = 0;
  let totalOffered = 0;
  const misses = [];

  for (const row of accepted) {
    const order = await Orders.findById(row._id, { restaurant: 1, dispatchStartedAt: 1, createdAt: 1 }).lean();
    if (!order || !order.restaurant) {
      skipped += 1;
      continue;
    }
    const shadow = await dispatchService.shadowDispatch(String(row._id), String(order.restaurant));
    if (!shadow) {
      skipped += 1;
      continue;
    }
    replayed += 1;
    totalOffered += shadow.wouldOffer.length;
    const hit = shadow.wouldOffer.some((o) => String(o.driver) === String(row.driver));
    if (hit) {
      hits += 1;
    } else if (misses.length < 20) {
      misses.push({ order: String(row._id), acceptedBy: String(row.driver) });
    }
  }

  const report = {
    window: { days, since, restaurant: restaurantFilter },
    ordersDispatched: dispatchedOrders.length,
    ordersAccepted: accepted.length,
    replayed,
    skipped,
    hits,
    hitRate: replayed > 0 ? Number((hits / replayed).toFixed(4)) : null,
    avgWouldOffer: replayed > 0 ? Number((totalOffered / replayed).toFixed(2)) : null,
    sampleMisses: misses,
    guidance:
      replayed === 0
        ? 'no accepted orders to compare — seed traffic or widen the window'
        : 'pair with getDispatchMetrics overrideRate; enable only when both look healthy',
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\nshadow compare: ${hits}/${replayed} acceptor-in-set` +
      (replayed ? ` (hit rate ${(report.hitRate * 100).toFixed(1)}%)` : ' (nothing to compare)')
  );
};

run()
  .catch((e) => {
    console.log(JSON.stringify({ error: e && e.message ? e.message : String(e) }));
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      /* report must always exit cleanly */
    }
    process.exit(0);
  });
