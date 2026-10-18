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
 * jhatka.admin.orders.route.js — B1.7
 *
 * Cross-outlet order search, lifecycle forensics, and the variable-weight console.
 *
 * ## Schema verified against `docs/JHATKA-ADMIN-SCHEMA-SURVEY.md`
 *
 *   JhatkaOrder              required : orderNo, customer, outlet, business,
 *                                     businessModel, lifecycle
 *                             money    : estimatedTotal, finalTotal, taxTotal,
 *                                     codAmount, refundedAmount, absorbedOverchargeTotal
 *   JhatkaOrderStatusHistory required : order, toStatus, actorType, at
 *   JhatkaReview             moderation: moderationReason, moderationNote,
 *                                     moderatedBy, moderatedByName, moderatedAt
 *   JhatkaComplaint          timeline[]: { status, at, by, byName, note }
 *
 * ## This file is READ-ONLY on purpose
 *
 * Not an oversight. An order's lifecycle is a guarded state machine: every move is
 * performed by the actor who owns it (the outlet accepts, the rider picks up, the
 * customer cancels) with its own permission and its own side effects. An admin route
 * that could move an order would be a THIRD path to the same transition with weaker
 * guardrails — no weight reconciliation, no COD freeze, no reservation.
 *
 * The plan says it plainly: *"GET-only consoles do not mutate, so a console can never
 * become a second path to the same write with weaker guardrails."*
 *
 * The one exception is REVIEW MODERATION, which is explicitly an editorial act and has
 * no lifecycle side effects.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const {
  JhatkaOrder,
  JhatkaOrderStatusHistory,
  JhatkaWeightConfirmation,
  JhatkaOutletVarianceFlag,
  JhatkaPreparationTicket,
  JhatkaRefund,
  JhatkaReview,
  JhatkaComplaint,
} = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

const MODERATION_STATUS = ['published', 'hidden', 'flagged'];
const MODERATION_REASONS = [
  'abusive_language', 'personal_information', 'competitor_spam', 'not_a_real_order',
  'duplicate', 'irrelevant', 'other',
];

/**
 * GET /v1/jhatka/admin/orders
 *
 * Cross-outlet search. Deliberately paginated and capped: an unfiltered order query on
 * a vertical with a year of history is the easiest way in this codebase to take the API
 * process down with it.
 */
router.get('/orders', webAuth('jhatka_order_read'), async (req, res, next) => {
  try {
    const { outlet, lifecycle, customer, from, to, search, hasVariance, page = 1, limit = 50 } =
      req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (lifecycle) query.lifecycle = lifecycle;
    if (customer) query.customer = customer;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lt = new Date(to);
    }
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.orderNo = new RegExp(`^${safe}$`, 'i');
    }
    if (hasVariance === 'true') {
      const flagged = await JhatkaOutletVarianceFlag.distinct('order');
      query._id = { $in: flagged };
    }

    const [orders, total] = await Promise.all([
      JhatkaOrder.find(query)
        .populate('outlet', 'name outletCode businessModel')
        .sort({ createdAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Math.min(200, Math.max(1, Number(limit))))
        .limit(Math.min(200, Math.max(1, Number(limit))))
        .lean(),
      JhatkaOrder.countDocuments(query),
    ]);

    return res.json({
      orders: orders.map(summariseOrder),
      page: Number(page),
      limit: Number(limit),
      total,
      count: orders.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/orders/variable-weight
 *
 * THE VARIABLE-WEIGHT CONSOLE. §16's second blueprint.
 *
 * Read-only, and it reports the RATIO rather than only the percentage, because a
 * percentage alone hides the direction: +20% could be a customer over-charged or a
 * mis-keyed scale, and those need different responses.
 *
 * `isSplitAllocation` is surfaced per line because of B6: a line filled from two
 * batches has an expiry governed by the SHORTER of them, and an operator looking at a
 * single-batch line would not know why its use-by is earlier than expected.
 */
router.get('/orders/variable-weight', webAuth('jhatka_order_read'), async (req, res, next) => {
  try {
    const { outlet, direction, from, to, limit = 100 } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lt = new Date(to);
    }
    // Only orders that actually had a WEIGHT line, else the console is a list of
    // egg orders.
    query['items.measurementMode'] = 'WEIGHT';

    const orders = await JhatkaOrder.find(query)
      .populate('outlet', 'name outletCode')
      .sort({ createdAt: -1 })
      .limit(Math.min(500, Math.max(1, Number(limit))))
      .lean();

    const orderIds = orders.map((o) => o._id);
    const [confirmations, flags] = await Promise.all([
      JhatkaWeightConfirmation.find({ order: { $in: orderIds } }).lean(),
      JhatkaOutletVarianceFlag.find({ order: { $in: orderIds } }).lean(),
    ]);

    const confByOrderItem = new Map(confirmations.map((c) => [`${c.order}:${c.orderItem}`, c]));
    const flagByOrderItem = new Map(flags.map((f) => [`${f.order}:${f.orderItem}`, f]));

    const rows = [];
    for (const order of orders) {
      for (const item of order.items || []) {
        if (item.measurementMode !== 'WEIGHT') continue;
        const key = `${order._id}:${item._id}`;
        const conf = confByOrderItem.get(key);
        const flag = flagByOrderItem.get(key);
        if (!conf) continue;

        rows.push({
          orderId: String(order._id),
          orderNo: order.orderNo,
          outlet: order.outlet?.name || String(order.outlet),
          lifecycle: order.lifecycle,
          sku: item.sku,
          // Direction is reported as a SIGNED value so an operator can tell
          // over-delivery from under-delivery without consulting a legend.
          variancePct: item.variancePct ?? conf.variancePct,
          ratio: conf.ratio,
          direction: flag?.direction || (conf.variancePct > 0 ? 'over' : 'under'),
          requestedGrams: flag?.requestedGrams,
          actualGrams: flag?.actualGrams,
          attempt: conf.attempt,
          isCurrent: conf.isCurrent,
          isOverride: !!conf.override,
          overrideReason: conf.override?.reason,
          policy: conf.policy,
          // B6: more than one allocation means a split, and the use-by is the
          // shortest expiry across all of them.
          isSplitAllocation: (item.allocations || []).length > 1,
          allocationCount: (item.allocations || []).length,
          action: flag?.action || null,
          selfApproved: !!flag?.selfApproved,
        });
      }
    }

    const filtered = direction ? rows.filter((r) => r.direction === direction) : rows;

    return res.json({
      rows: filtered,
      count: filtered.length,
      summary: {
        over: filtered.filter((r) => r.direction === 'over').length,
        under: filtered.filter((r) => r.direction === 'under').length,
        overrides: filtered.filter((r) => r.isOverride).length,
        // Self-approval is the number that matters: a shop that both overrides its own
        // variance AND receives the money is the shape of fraud.
        selfApproved: filtered.filter((r) => r.selfApproved).length,
        splitAllocations: filtered.filter((r) => r.isSplitAllocation).length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/orders/reviews
 *
 * Declared BEFORE `/orders/:order`, and that ordering is load-bearing: Express matches
 * in registration order, so a literal declared after `:order` is UNREACHABLE.
 *
 * This is the THIRD file in this vertical to trip the same shadowing (after
 * `/suppliers/expiring-documents` and `/settlements/payouts`), and in all three cases
 * the code read correctly and only `verify.jhatka.vertical.js` caught it.
 */
router.get('/orders/reviews', webAuth('jhatka_review_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.outlet) query.outlet = req.query.outlet;
    if (req.query.minRating) query.outletRating = { $gte: Number(req.query.minRating) };

    const reviews = await JhatkaReview.find(query)
      .populate('outlet', 'name outletCode')
      .populate('order', 'orderNo deliveredAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const rated = reviews.filter((r) => Number.isFinite(r.outletRating));
    const avg = rated.length
      ? Number((rated.reduce((s, r) => s + r.outletRating, 0) / rated.length).toFixed(2))
      : 0;

    return res.json({
      reviews,
      count: reviews.length,
      summary: {
        averageOutletRating: avg,
        flagged: reviews.filter((r) => r.status === 'flagged').length,
        hidden: reviews.filter((r) => r.status === 'hidden').length,
        distribution: [1, 2, 3, 4, 5].map((n) => ({
          rating: n,
          count: rated.filter((r) => r.outletRating === n).length,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/orders/reviews/:review
 *
 * The ONE write in this file, and it is editorial rather than operational.
 *
 * `status: 'hidden'` or `'flagged'` REQUIRES `moderationReason`. A hidden review with
 * no reason cannot be appealed, cannot be audited, and cannot be distinguished from an
 * operator having a bad day.
 */
router.patch('/orders/reviews/:review', webAuth('jhatka_review_write'), validate(V.namedParam('review')), validate(V.reviewDecisionBody), async (req, res, next) => {
  try {
    const review = await JhatkaReview.findById(req.params.review);
    if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');

    const { status, moderationReason, moderationNote } = req.body || {};

    if (status !== undefined) {
      if (!MODERATION_STATUS.includes(status)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `status must be one of ${MODERATION_STATUS.join(' | ')}`,
          true, '', { code: 'INVALID_STATUS', allowed: MODERATION_STATUS, received: status }
        );
      }

      if (['hidden', 'flagged'].includes(status) && !(moderationReason || review.moderationReason)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `moderationReason is required to ${status} a review — ${MODERATION_REASONS.join(' | ')}`,
          true, '', { code: 'MODERATION_REASON_REQUIRED', allowed: MODERATION_REASONS }
        );
      }

      review.status = status;
      review.moderatedAt = new Date();
      review.moderatedBy = req.user._id;
      review.moderatedByName = req.user.name;
    }

    if (moderationReason !== undefined) review.moderationReason = moderationReason;
    if (moderationNote !== undefined) review.moderationNote = moderationNote;

    await review.save();
    return res.json({ review: review.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/orders/complaints
 *
 * Complaints are grouped by category because the actionable question is "which kind",
 * not "how many".
 */
router.get('/orders/complaints', webAuth('jhatka_complaint_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.outlet) query.outlet = req.query.outlet;
    if (req.query.category) query.category = req.query.category;

    const complaints = await JhatkaComplaint.find(query)
      .populate('outlet', 'name outletCode')
      .populate('order', 'orderNo')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const byCategory = {};
    for (const c of complaints) {
      byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    }

    return res.json({
      complaints,
      count: complaints.length,
      byCategory,
      byStatus: {
        open: complaints.filter((c) => c.status === 'open').length,
        escalated: complaints.filter((c) => c.status === 'escalated').length,
        resolved: complaints.filter((c) => c.status === 'resolved').length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Order summary for list views.
 *
 * `.lean()` returns raw PAISE for every moneyField, so these are paise and are NOT
 * divided here — dividing a lean read is how the hundred-fold errors in this vertical
 * started. The caller sees paise and knows it.
 */
function summariseOrder(order) {
  const hasVariance = (order.items || []).some((i) => (i.allocations || []).length > 0);
  return {
    id: String(order._id),
    orderNo: order.orderNo,
    customer: String(order.customer),
    customerName: order.customerName,
    outlet: order.outlet,
    lifecycle: order.lifecycle,
    fulfilmentMode: order.fulfilmentMode,
    paymentMode: order.paymentMode,
    // All paise.
    estimatedTotal: order.estimatedTotal,
    finalTotal: order.finalTotal,
    codAmount: order.codAmount,
    refundedAmount: order.refundedAmount,
    itemCount: (order.items || []).length,
    hasAllocations: hasVariance,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
  };
}

/**
 * GET /v1/jhatka/admin/orders/:order
 *
 * The forensic view: the lifecycle timeline, every weight confirmation with its
 * snapshot policy, any variance flags, refunds, and the review.
 *
 * This is what you open when a customer says they were short-changed. It answers the
 * question from RECORDS rather than from anyone's memory.
 */
router.get('/orders/:order', webAuth('jhatka_order_read'), validate(V.namedParam('order')), async (req, res, next) => {
  try {
    const order = await JhatkaOrder.findById(req.params.order)
      .populate('outlet', 'name outletCode businessModel')
      .lean();

    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

    const [history, confirmations, flags, refunds, review, complaints, tickets] = await Promise.all([
      JhatkaOrderStatusHistory.find({ order: order._id }).sort({ at: 1 }).lean(),
      JhatkaWeightConfirmation.find({ order: order._id }).sort({ attempt: 1 }).lean(),
      JhatkaOutletVarianceFlag.find({ order: order._id }).lean(),
      JhatkaRefund.find({ order: order._id }).sort({ createdAt: 1 }).lean(),
      JhatkaReview.findOne({ order: order._id }).lean(),
      JhatkaComplaint.find({ order: order._id }).lean(),
      JhatkaPreparationTicket.find({ order: order._id }).sort({ attempt: 1 }).lean(),
    ]);

    return res.json({
      order: { ...order, items: (order.items || []).map((i) => ({ ...i, allocations: i.allocations || [] })) },
      history,
      confirmations,
      varianceFlags: flags,
      refunds,
      review: review || null,
      complaints,
      preparationTickets: tickets,
      // The one-line answer to "was the customer treated correctly".
      integrity: {
        hasVariance: flags.length > 0,
        refundedRupees: refunds.reduce((s, r) => s + (r.netAmount || 0), 0),
        finalWithinEstimate:
          order.finalTotal != null && order.estimatedTotal != null
            ? order.finalTotal <= order.estimatedTotal
            : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.MODERATION_STATUS = MODERATION_STATUS;
module.exports.MODERATION_REASONS = MODERATION_REASONS;
