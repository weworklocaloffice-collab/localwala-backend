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
 * jhatka.completion.service.js — moving DELIVERED orders to COMPLETED.
 *
 * ## Why COMPLETED had no writer at all
 *
 * `COMPLETED` is the table's only sink for a fulfilled order
 * (`DELIVERED: ['COMPLETED', 'REFUND_PENDING', 'CANCELLED']`), and nothing wrote it.
 * Every delivered order sat at `DELIVERED` forever, which meant "delivered" and
 * "finished" were the same thing — and they are not. A delivered order with a quality
 * complaint open is not finished; a delivered order with a refund in flight is not
 * finished; a delivered order from six weeks ago with neither is.
 *
 * ## Why a sweep, and why 48 hours
 *
 * Three candidates, and why the first two lose:
 *
 *   - the DRIVER marks it complete at the door. Wrong actor: the rider cannot know
 *     whether the chicken is off, and OD-08 gives the customer 2 hours for quality
 *     and 24 for shortfall. Completing at handover closes the complaint window
 *     before it opens.
 *   - the CUSTOMER confirms receipt. Nice in theory, unusable in practice: most
 *     customers never tap, so most orders would never complete and COMPLETED would
 *     mean "confirmed by the conscientious" rather than "finished".
 *   - TIME, with exceptions. 48 hours clears OD-08's 24-hour shortfall window with a
 *     day to spare, and anything still genuinely open at 48 hours — an unresolved
 *     complaint, an unsettled refund — holds the order back.
 *
 * ## What holds an order back, exactly
 *
 *   - an OPEN refund (`REFUND_PENDING` or `PROCESSING`). The order is not finished
 *     while money is still moving; when the last one settles the refund sync moves it
 *     to `REFUNDED` instead, which is the other terminal.
 *   - an OPEN complaint (`open`, `acknowledged`, `investigating`, `escalated`).
 *     `resolved` and `rejected` do not hold: a complaint that was looked at and closed
 *     is finished business even if the customer is unhappy about the outcome.
 *
 * ## Idempotency
 *
 * Guarded by the lifecycle itself: only `DELIVERED` orders are candidates, so a
 * re-run finds nothing to do. Concurrent sweeps both moving the same order is
 * harmless — `tryMoveTo` on an already-COMPLETED order is a no-op, not a throw.
 */

const lifecycleService = require('./jhatka.order-lifecycle.service');

/** Hours after delivery before an order may complete. Covers OD-08's windows + a day. */
const COMPLETION_AGE_HOURS = 48;

/** Complaint statuses that mean "still someones problem". */
const OPEN_COMPLAINT_STATUSES = ['open', 'acknowledged', 'investigating', 'escalated'];

/** Refund statuses that mean money is still moving. */
const OPEN_REFUND_STATUSES = ['REFUND_PENDING', 'PROCESSING'];

/**
 * Complete one order if nothing is still open on it.
 *
 * Exported separately from the sweep so a route or an admin action can complete a
 * single order — and so a test can prove the hold logic without waiting 48 hours.
 *
 * @returns {Promise<{completed: boolean, reason: string}>}
 */
async function completeOrder({ models, orderId, now = new Date(), actor } = {}) {
  const { JhatkaOrder, JhatkaRefund, JhatkaComplaint } = models;

  const order = await JhatkaOrder.findById(orderId);
  if (!order) return { completed: false, reason: 'missing' };
  if (order.lifecycle !== 'DELIVERED') {
    return { completed: false, reason: `already ${order.lifecycle}` };
  }

  const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : null;
  if (!deliveredAt || now - deliveredAt < COMPLETION_AGE_HOURS * 3600000) {
    return { completed: false, reason: 'too_fresh' };
  }

  const openRefunds = await JhatkaRefund.countDocuments({
    order: order._id,
    status: { $in: OPEN_REFUND_STATUSES },
  });
  if (openRefunds > 0) {
    return { completed: false, reason: 'open_refunds' };
  }

  const openComplaints = JhatkaComplaint
    ? await JhatkaComplaint.countDocuments({
        order: order._id,
        status: { $in: OPEN_COMPLAINT_STATUSES },
      })
    : 0;
  if (openComplaints > 0) {
    return { completed: false, reason: 'open_complaints' };
  }

  await lifecycleService.moveTo(order, 'COMPLETED', {
    completedAt: now,
    completedBy: actor?._id,
  });

  return { completed: true, reason: 'aged_out_clean' };
}

/**
 * The nightly sweep.
 *
 * Bounded by `limit` per run and oldest-first, because the backlog after a holiday
 * weekend is exactly when an unbounded sweep is most dangerous. Whatever is left is
 * picked up tomorrow; COMPLETED is not time-critical.
 *
 * @returns {Promise<{scanned: number, completed: number, held: object}>}
 */
async function sweepCompletions({ models, now = new Date(), limit = 500, ageHours, actor } = {}) {
  const { JhatkaOrder } = models;

  const cutoff = new Date(now.getTime() - (ageHours ?? COMPLETION_AGE_HOURS) * 3600000);

  const candidates = await JhatkaOrder.find({
    lifecycle: 'DELIVERED',
    deliveredAt: { $lte: cutoff },
  })
    .select('_id')
    .sort({ deliveredAt: 1 })
    .limit(limit)
    .lean();

  const summary = { scanned: candidates.length, completed: 0, held: {} };

  for (const row of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await completeOrder({ models, orderId: row._id, now, actor });
    if (result.completed) {
      summary.completed += 1;
    } else {
      summary.held[result.reason] = (summary.held[result.reason] || 0) + 1;
    }
  }

  return summary;
}

module.exports = {
  completeOrder,
  sweepCompletions,
  COMPLETION_AGE_HOURS,
  OPEN_COMPLAINT_STATUSES,
  OPEN_REFUND_STATUSES,
};