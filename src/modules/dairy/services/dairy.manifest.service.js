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
const {
  DairySubscription,
  DairyRecurringOrder,
  DairyOrder,
  DeliveryRun,
  DeliveryStop,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');
const deliveryRunService = require('../../../kernel/delivery/services/delivery.run.service');
const billingService = require('./dairy.subscription.billing.service');

/**
 * Subscription → recurring orders → delivery runs.
 *
 * The pipeline, per the specification:
 *
 *   Active Subscriptions → Recurring Orders Generated → DeliveryRun
 *                       → Driver → Multiple Customers → Completed
 *
 * Design points that matter:
 *
 *   1. **Idempotent.** `(subscription, occurrenceDate)` is uniquely indexed, so
 *      running the generator twice for the same date is a no-op rather than a
 *      duplicate round of deliveries. The nightly cron can be retried safely.
 *   2. **Grouped by business + slot, not one run per customer.** A milk route
 *      serves many customers, so occurrences are bucketed into one run per outlet
 *      and time window, and the rider is assigned once for the whole bucket.
 *   3. **Failures are isolated.** One out-of-stock plan must not stop the rest of
 *      the night's work, so each subscription is attempted independently and
 *      failures are collected for the report.
 */

const dayKey = (date) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Generates occurrences for a single date, without building runs.
 *
 * Split from run building so an admin can preview tomorrow's volume before
 * committing rider assignments.
 *
 * @param {Date} forDate
 * @returns {Promise<{generated: number, skipped: number, failed: Object[]}>}
 */
const generateOccurrences = async (forDate) => {
  const target = dayKey(forDate);

  // Only active plans. Paused and cancelled plans are excluded here because
  // `isScheduledFor` handles skip dates and pause windows, but status is a
  // first-class filter and not worth re-deriving per document.
  const candidates = await DairySubscription.find({
    status: 'active',
    startDate: { $lte: target },
  }).populate('sku', 'name packSize price inStock reusableContainer availableQty');

  let generated = 0;
  let skipped = 0;
  const failed = [];

  for (const subscription of candidates) {
    try {
      if (!subscription.isScheduledFor(target)) {
        skipped += 1;
        continue;
      }

      // Already done? Then this is a retry and there is nothing to do.
      const existing = await DairyRecurringOrder.findOne({
        subscription: subscription._id,
        occurrenceDate: target,
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      // No stock check here on purpose. Stock is reserved per occurrence, below,
      // as part of preparing the delivery, so the guard and the decrement happen
      // in one atomic step and cannot both pass on the last unit.
      const sku = subscription.sku;
      if (!sku || !sku.inStock) {
        await DairyRecurringOrder.create({
          subscription: subscription._id,
          user: subscription.user,
          business: subscription.business,
          sku: subscription.sku,
          occurrenceDate: target,
          quantity: subscription.quantity,
          unitPrice: subscription.unitPrice,
          amount: (subscription.unitPrice || 0) * subscription.quantity,
          deliverySlot: subscription.deliverySlot,
          status: 'skipped',
          skipReason: 'SKU out of stock',
        });
        skipped += 1;
        continue;
      }

      const occurrence = await DairyRecurringOrder.create({
        subscription: subscription._id,
        user: subscription.user,
        business: subscription.business,
        sku: subscription.sku,
        occurrenceDate: target,
        quantity: subscription.quantity,
        unitPrice: subscription.unitPrice,
        amount: (subscription.unitPrice || 0) * subscription.quantity,
        deliverySlot: subscription.deliverySlot,
        address: subscription.address,
        addressRaw: subscription.addressRaw,
        containerAssignment: subscription.containerAssignment,
        status: 'planned',
      });

      // Reserve the stock and take the money now, not at the door. An occurrence
      // that cannot be prepared is recorded as skipped with its reason, so the
      // shortfall is visible instead of becoming an unpaid delivery.
      const prepared = await billingService.prepareOccurrence(occurrence, subscription);

      if (!prepared.billed) {
        skipped += 1;
        continue;
      }

      subscription.stats = subscription.stats || {};
      subscription.stats.occurrencesGenerated = (subscription.stats.occurrencesGenerated || 0) + 1;
      subscription.stats.lastGeneratedAt = new Date();
      subscription.stats.nextDeliveryDate = subscription.nextOccurrenceAfter(target) || null;
      await subscription.save();

      generated += 1;
    } catch (error) {
      // Isolated so one bad plan cannot abandon the night's work.
      failed.push({
        subscription: subscription._id,
        subscriptionNo: subscription.subscriptionNo,
        error: error.message,
      });
      logger.error(`dairy manifest: subscription ${subscription.subscriptionNo} failed — ${error.message}`);
    }
  }

  return { generated, skipped, failed, total: candidates.length };
};

/**
 * Groups planned occurrences into runs, one per business + delivery slot.
 *
 * Slot is part of the key because a rider's crate and route differ between an
 * early and a late window — merging them would produce a run with two
 * incompatible time commitments.
 *
 * @param {Date} forDate
 * @returns {Promise<{runs: number, stops: number, failed: Object[]}>}
 */
const buildRuns = async (forDate) => {
  const target = dayKey(forDate);

  const planned = await DairyRecurringOrder.find({
    occurrenceDate: target,
    // `billed` is the normal state after generation. `planned` is included so a
    // run can still be built from occurrences prepared by an older build.
    status: { $in: ['planned', 'billed'] },
    run: { $exists: false },
  })
    .populate('subscription', 'containerAssignment paymentMode receiverName receiverContact')
    .populate('order', 'paymentStatus grandTotal');

  if (planned.length === 0) {
    return { runs: 0, stops: 0, failed: [], buckets: 0 };
  }

  // Bucket by outlet + slot window.
  const buckets = new Map();
  for (const occurrence of planned) {
    const slotKey = `${occurrence.deliverySlot.startTime}-${occurrence.deliverySlot.endTime}`;
    const key = `${occurrence.business}|${slotKey}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        business: occurrence.business,
        slot: occurrence.deliverySlot,
        occurrences: [],
      });
    }
    buckets.get(key).occurrences.push(occurrence);
  }

  let runCount = 0;
  let stopCount = 0;
  const failed = [];

  for (const bucket of buckets.values()) {
    try {
      // Prepaid occurrences were charged at generation, so nothing is due at the
      // door. The amount comes from the occurrence's own order rather than the
      // plan, so a subscription's billing mode and its actual occurrence can
      // never disagree about what the rider should collect.
      const isCod = (occurrence) =>
        !!occurrence.order && occurrence.order.paymentStatus !== 'paid';

      const run = await deliveryRunService.createRun({
        business: bucket.business,
        serviceDate: target,
        slot: bucket.slot,
        stops: bucket.occurrences.map((occurrence) => ({
          customer: occurrence.user,
          address: occurrence.address,
          addressRaw: occurrence.addressRaw,
          receiverName:
            occurrence.subscription && occurrence.subscription.receiverName,
          cansOut: occurrence.quantity,
          amountDue: isCod(occurrence) ? occurrence.amount : 0,
          paymentMode: isCod(occurrence) ? 'cod' : 'prepaid',
          subscription: occurrence.subscription._id,
        })),
      });

      // Link each occurrence back to its run and stop so the subscription screen
      // can show where its delivery went without a second query. The order is
      // linked too: that is what lets a completed stop mark the delivery
      // delivered, and what settlement reads as revenue.
      for (const occurrence of bucket.occurrences) {
        const stop = await DeliveryStop.findOne({
          run: run._id,
          subscription: occurrence.subscription._id,
        });
        occurrence.run = run._id;
        occurrence.stop = stop ? stop._id : undefined;
        occurrence.status = 'assigned';
        await occurrence.save();

        if (occurrence.order) {
          await DairyOrder.updateOne(
            { _id: occurrence.order },
            { $set: { run: run._id, stop: stop ? stop._id : undefined } }
          );
        }
      }

      runCount += 1;
      stopCount += bucket.occurrences.length;
    } catch (error) {
      failed.push({ business: bucket.business, error: error.message });
      logger.error(`dairy manifest: run build failed for business ${bucket.business} — ${error.message}`);
    }
  }

  return { runs: runCount, stops: stopCount, failed, buckets: buckets.size };
};

/**
 * Full nightly pipeline: occurrences, then runs.
 *
 * Safe to call repeatedly for the same date.
 *
 * @param {Date} forDate
 */
const generateManifest = async (forDate) => {
  const target = dayKey(forDate);

  const occurrenceResult = await generateOccurrences(target);
  const runResult = await buildRuns(target);

  // Plans past their end date are closed out here rather than by a second job.
  const completed = await DairySubscription.updateMany(
    { status: 'active', endDate: { $exists: true, $ne: null, $lt: target } },
    { $set: { status: 'completed' } }
  );

  const summary = {
    date: target,
    occurrencesGenerated: occurrenceResult.generated,
    occurrencesSkipped: occurrenceResult.skipped,
    plansConsidered: occurrenceResult.total,
    runsCreated: runResult.runs,
    stopsCreated: runResult.stops,
    plansCompleted: completed.modifiedCount,
    failed: [...occurrenceResult.failed, ...runResult.failed],
  };

  logger.info(
    `dairy manifest ${target.toISOString().slice(0, 10)} — ` +
      `${summary.occurrencesGenerated} occurrences, ${summary.runsCreated} runs, ${summary.stopsCreated} stops`
  );

  return summary;
};

/**
 * Previews what a date would produce, without writing anything.
 *
 * @param {Date} forDate
 */
const previewManifest = async (forDate) => {
  const target = dayKey(forDate);

  const candidates = await DairySubscription.find({
    status: 'active',
    startDate: { $lte: target },
  }).populate('sku', 'name inStock packSize');

  const due = candidates.filter((s) => s.isScheduledFor(target));
  const notDue = candidates.filter((s) => !s.isScheduledFor(target));

  // Bucket the same way buildRuns will, so the preview matches the outcome.
  const buckets = new Map();
  for (const subscription of due) {
    const slotKey = `${subscription.deliverySlot.startTime}-${subscription.deliverySlot.endTime}`;
    const key = `${subscription.business}|${slotKey}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        business: subscription.business,
        slot: subscription.deliverySlot,
        subscriptions: 0,
        cans: 0,
        amount: 0,
      });
    }
    const bucket = buckets.get(key);
    bucket.subscriptions += 1;
    bucket.cans += subscription.quantity;
    bucket.amount += (subscription.unitPrice || 0) * subscription.quantity;
  }

  const withStockIssue = due.filter((s) => !s.sku || !s.sku.inStock);

  return {
    date: target,
    activePlans: candidates.length,
    dueToday: due.length,
    notDueToday: notDue.length,
    expectedRuns: buckets.size,
    buckets: Array.from(buckets.values()),
    stockIssues: withStockIssue.map((s) => ({
      subscriptionNo: s.subscriptionNo,
      sku: s.sku ? s.sku.name : null,
    })),
  };
};

/**
 * Runs the generator for the delivery date in `config`.
 *
 * @param {string} [dateOverride] YYYY-MM-DD, for manual backfills
 */
const runManifestJob = async (dateOverride) => {
  let forDate = new Date();
  if (dateOverride) {
    const parsed = new Date(dateOverride);
    if (Number.isNaN(parsed.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Invalid date: ${dateOverride}`);
    }
    forDate = parsed;
  }

  try {
    return await generateManifest(forDate);
  } catch (error) {
    logger.error(`dairy manifest job failed — ${error.message}`);
    throw error;
  }
};

/**
 * Today's runs for the rider app's history, used by the admin dashboard.
 */
const getDaySummary = async (forDate) => {
  const target = dayKey(forDate);

  const [runs, occurrences] = await Promise.all([
    DeliveryRun.find({ serviceDate: target }).select('status agentMode slot totals'),
    DairyRecurringOrder.aggregate([
      { $match: { occurrenceDate: target } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = occurrences.reduce((acc, o) => ({ ...acc, [o._id]: o.count }), {});

  return {
    date: target,
    runs: runs.length,
    runsByStatus: runs.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}),
    runsByAgentMode: runs.reduce(
      (acc, r) => ({ ...acc, [r.agentMode]: (acc[r.agentMode] || 0) + 1 }),
      {}
    ),
    occurrencesByStatus: byStatus,
  };
};

/** Total cans owed out for a date, for procurement planning. */
const getDemandForecast = async (forDate, daysAhead = 3) => {
  const target = dayKey(forDate);
  const results = [];

  for (let i = 0; i <= daysAhead; i += 1) {
    const date = new Date(target);
    date.setDate(target.getDate() + i);

    // Read the plans then filter in JS, because `isScheduledFor` is a model
    // method and cannot run inside an aggregation. Duplicating the recurrence
    // rules as pipeline expressions would drift from the model, which is the
    // exact bug the method exists to prevent.
    const planDocs = await DairySubscription.find({ status: 'active', startDate: { $lte: date } }).populate(
      'sku',
      'name packSize'
    );

    const bySku = new Map();
    for (const plan of planDocs) {
      if (!plan.isScheduledFor(date)) continue;
      const key = plan.sku._id.toString();
      const entry = bySku.get(key) || {
        skuId: key,
        sku: plan.sku.name,
        packSize: plan.sku.packSize,
        cans: 0,
        plans: 0,
      };
      entry.cans += plan.quantity;
      entry.plans += 1;
      bySku.set(key, entry);
    }

    results.push({
      date,
      planCount: planDocs.length,
      deliveringPlans: Array.from(bySku.values()).reduce((s, e) => s + e.plans, 0),
      skus: Array.from(bySku.values()),
    });
  }

  return results;
};

module.exports = {
  dayKey,
  generateOccurrences,
  buildRuns,
  generateManifest,
  previewManifest,
  runManifestJob,
  getDaySummary,
  getDemandForecast,
};