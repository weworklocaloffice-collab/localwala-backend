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
 * jhatka.admin.operations.route.js — B1.5
 *
 * The variance console (weight fraud), yield specs, and three GET-only operational
 * consoles the plan names separately.
 *
 * ## Schema verified against `docs/JHATKA-ADMIN-SCHEMA-SURVEY.md`
 *
 *   JhatkaOutletVarianceFlag
 *     required : outlet, order, orderItem, weightConfirmation, direction, ratio,
 *                 variancePct, requestedGrams, actualGrams, policy.*, flaggedAt
 *     direction : over | under
 *     action    : none | observed | reviewed | escalated | calibrated | fraud_referred
 *
 *   JhatkaYieldSpec
 *     required : code, name, rawProduct, rawSku, cutType, expectedYieldPct,
 *                 shelfLifeHoursPrepared, effectiveFrom
 *     cutType  : whole | curry_cut | skinless | boneless | cleaned | fish_cleaned |
 *                prawn_peeled | portioned
 *     status   : draft | active | retired
 *
 * ## Why this console is the fraud surface
 *
 * -16 notes that the OLD blueprint watched only over-delivery. Both tails are recorded
 * because they are different crimes with different fixes:
 *
 *   `over`  — the outlet over-delivers. The customer is overcharged. That is theft.
 *   `under` — the outlet under-delivers. The customer gets less than they paid for,
 *             and the "generous butcher" reputation is bought with someone else's money.
 *
 * The `action` enum runs `observed -> reviewed -> escalated -> calibrated ->
 * fraud_referred`, and `calibrated` sits deliberately ABOVE `escalated`: a scale that
 * is reading wrong is an equipment fault, not a person, and escalating a miscalibrated
 * scale to fraud would teach every shop to stop reporting one.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const {
  JhatkaOutletVarianceFlag,
  JhatkaYieldSpec,
  JhatkaOrder,
  JhatkaRefund,
  JhatkaRecurringOrder,
  JhatkaSubscription,
  JhatkaWastage,
  JhatkaOutlet,
  JhatkaCompliance,
  JhatkaRecall,
} = require('../../../models');
const analyticsService = require('../services/jhatka.analytics.service');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

const FLAG_ACTIONS = ['none', 'observed', 'reviewed', 'escalated', 'calibrated', 'fraud_referred'];
const CUT_TYPES = [
  'whole', 'curry_cut', 'skinless', 'boneless', 'cleaned',
  'fish_cleaned', 'prawn_peeled', 'portioned',
];

/** Actions that STOP someone being accused. Deliberately not a linear ladder. */
const FLAG_ACTION_TRANSITIONS = {
  none: ['observed'],
  observed: ['reviewed', 'calibrated', 'escalated'],
  reviewed: ['escalated', 'calibrated'],
  // A scale fault is equipment, not a person.
  calibrated: ['reviewed', 'escalated'],
  escalated: ['calibrated', 'fraud_referred'],
  fraud_referred: [],
};

/**
 * GET /v1/jhatka/admin/operations/variance
 *
 * GET-ONLY CONSOLE. Flags are written by the weigh service as a side effect of a
 * weighing; an admin CONSIDERs them. Nothing here mutates a flag, because a flag whose
 * action could be edited in place has no audit trail of who decided what.
 */
router.get('/operations/variance', webAuth('jhatka_inventory_read'), async (req, res, next) => {
  try {
    const { outlet, direction, action, minPct, page = 1, limit = 50 } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (direction) query.direction = direction;
    if (action) query.action = action;
    if (minPct) query.variancePct = { $gte: Number(minPct) };

    const [flags, total] = await Promise.all([
      JhatkaOutletVarianceFlag.find(query)
        .populate('outlet', 'name outletCode')
        .populate('order', 'orderNo customer lifecycle')
        .sort({ variancePct: -1, flaggedAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Math.min(200, Math.max(1, Number(limit))))
        .lean(),
      JhatkaOutletVarianceFlag.countDocuments(query),
    ]);

    // Both tails counted separately, so an operator sees "this shop is short-weighing"
    // rather than one blended number that hides both.
    const over = flags.filter((f) => f.direction === 'over');
    const under = flags.filter((f) => f.direction === 'under');

    return res.json({
      flags,
      page: Number(page),
      limit: Number(limit),
      total,
      count: flags.length,
      summary: {
        over: { count: over.length, worstPct: over.length ? Math.max(...over.map((f) => f.variancePct)) : 0 },
        under: { count: under.length, worstPct: under.length ? Math.max(...under.map((f) => f.variancePct)) : 0 },
        selfApproved: flags.filter((f) => f.selfApproved).length,
        unresolved: flags.filter((f) => !['calibrated', 'fraud_referred'].includes(f.action || 'none')).length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/operations/variance/:flag
 *
 * The ONLY write to a flag. Action moves through `FLAG_ACTION_TRANSITIONS`, so a flag
 * that has been escalated to fraud cannot be quietly marked `observed` again and
 * dropped from the queue.
 */
router.patch('/operations/variance/:flag', webAuth('jhatka_inventory_adjust'), validate(V.namedParam('flag')), async (req, res, next) => {
  try {
    const flag = await JhatkaOutletVarianceFlag.findById(req.params.flag);
    if (!flag) throw new ApiError(httpStatus.NOT_FOUND, 'Variance flag not found');

    const { action, note } = req.body || {};
    if (!action) throw new ApiError(httpStatus.BAD_REQUEST, 'action is required');

    if (!FLAG_ACTIONS.includes(action)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `action must be one of ${FLAG_ACTIONS.join(' | ')}`,
        true, '', { code: 'INVALID_ACTION', allowed: FLAG_ACTIONS, received: action }
      );
    }

    const current = flag.action || 'none';
    const allowed = FLAG_ACTION_TRANSITIONS[current] || [];
    if (action !== current && !allowed.includes(action)) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `A variance flag cannot move from ${current} to ${action}`,
        true, '',
        { code: 'ILLEGAL_ACTION_TRANSITION', from: current, to: action, allowed }
      );
    }

    // The REAL field names. An earlier draft wrote `reviewedAt` / `reviewedBy` /
// `reviewNote`, none of which exist — Mongoose would have dropped all three, so the
// operator's decision would have been recorded as an action with no record of who made
// it or when, which is exactly what an action audit is for.
flag.action = action;
flag.actionAt = new Date();
flag.actionBy = req.user._id;
flag.actionByName = req.user.name;
if (note) flag.actionNote = note;

    await flag.save();
    return res.json({ flag: flag.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/operations/refunds
 *
 * GET-ONLY CONSOLE over `JhatkaRefund`. The refund SETTLEMENT job is the only thing
 * that may change a refund's status; this is the operator's view of the queue, which
 * is what you need when one is stuck in `FAILED` with five attempts.
 */
router.get('/operations/refunds', webAuth('jhatka_payables_read'), async (req, res, next) => {
  try {
    const { outlet, status, reason, stuck, page = 1, limit = 50 } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (status) query.status = status;
    if (reason) query.reason = reason;
    // `parkedAt` is set when the settlement job gives up. That is the queue an
    // operator actually needs to see, and it is not reachable by filtering on status
    // alone — a parked refund is `FAILED`, same as one that failed once.
    if (stuck === 'true') query.parkedAt = { $ne: null };

    const [refunds, total] = await Promise.all([
      JhatkaRefund.find(query)
        .populate('outlet', 'name outletCode')
        .populate('order', 'orderNo')
        .sort({ createdAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Math.min(200, Math.max(1, Number(limit))))
        .lean(),
      JhatkaRefund.countDocuments(query),
    ]);

    return res.json({
      refunds,
      page: Number(page),
      limit: Number(limit),
      total,
      count: refunds.length,
      // Paise, matching the stored value, so an operator can total without converting.
      stuckTotalPaise: refunds
        .filter((r) => r.parkedAt)
        .reduce((s, r) => s + (r.netAmount || 0), 0),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/operations/recurring-orders
 *
 * GET-ONLY. Subscription occurrences across every outlet — the fulfillment view.
 */
router.get('/operations/recurring-orders', webAuth('jhatka_subscription_read'), async (req, res, next) => {
  try {
    const { outlet, generationStatus, from, to, limit = 100 } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (generationStatus) query.generationStatus = generationStatus;
    if (from || to) {
      query.occurrenceDate = {};
      if (from) query.occurrenceDate.$gte = new Date(from);
      if (to) query.occurrenceDate.$lt = new Date(to);
    }

    const occurrences = await JhatkaRecurringOrder.find(query)
      .populate('outlet', 'name outletCode')
      .populate('subscription', 'subscriptionNo scheduleType customer')
      .sort({ occurrenceDate: -1 })
      .limit(Math.min(500, Math.max(1, Number(limit))))
      .lean();

    // `reserved` is the health signal: it means -9.4 actually claimed stock. An
    // occurrence that is `generated` but not `reserved` promised meat it never held.
    return res.json({
      occurrences,
      count: occurrences.length,
      summary: {
        reserved: occurrences.filter((o) => o.stockReserved).length,
        unreserved: occurrences.filter((o) => o.generationStatus === 'generated' && !o.stockReserved).length,
        skippedNoStock: occurrences.filter((o) => o.generationStatus === 'skipped_no_stock').length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/operations/subscriptions
 *
 * GET-ONLY across every outlet.
 */
router.get('/operations/subscriptions', webAuth('jhatka_subscription_read'), async (req, res, next) => {
  try {
    const { outlet, status, limit = 100 } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (status) query.status = status;

    const subscriptions = await JhatkaSubscription.find(query)
      .populate('outlet', 'name outletCode')
      .sort({ nextOccurrenceDate: 1 })
      .limit(Math.min(500, Math.max(1, Number(limit))))
      .lean();

    return res.json({
      subscriptions,
      count: subscriptions.length,
      summary: {
        active: subscriptions.filter((s) => s.status === 'active').length,
        paused: subscriptions.filter((s) => s.status === 'paused').length,
        paymentFailed: subscriptions.filter((s) => s.status === 'payment_failed').length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/operations/cancellations
 *
 * GET-ONLY. Cancellations are counted by REASON rather than just listed, because the
 * interesting question is not "how many" but "why" — an `out_of_stock` cluster is a
 * procurement problem wearing a customer-service costume.
 */
router.get('/operations/cancellations', webAuth('jhatka_order_read'), async (req, res, next) => {
  try {
    const { outlet, from, to, limit = 200 } = req.query;

    const query = { lifecycle: 'CANCELLED' };
    if (outlet) query.outlet = outlet;
    if (from || to) {
      query.updatedAt = {};
      if (from) query.updatedAt.$gte = new Date(from);
      if (to) query.updatedAt.$lt = new Date(to);
    }

    const orders = await JhatkaOrder.find(query)
      .select('orderNo outlet lifecycle cancellation cancelledAt updatedAt')
      .populate('outlet', 'name outletCode')
      .sort({ updatedAt: -1 })
      .limit(Math.min(500, Math.max(1, Number(limit))))
      .lean();

    const byReason = {};
    for (const o of orders) {
      const r = o.cancellation?.reasonCategory || 'unspecified';
      byReason[r] = (byReason[r] || 0) + 1;
    }
    const byActor = {};
    for (const o of orders) {
      const a = o.cancellation?.cancelledBy || 'unspecified';
      byActor[a] = (byActor[a] || 0) + 1;
    }

    return res.json({ orders, count: orders.length, byReason, byActor });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/operations/yield-specs
 */
router.get('/operations/yield-specs', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.cutType) query.cutType = req.query.cutType;

    const specs = await JhatkaYieldSpec.find(query)
      .populate('rawProduct', 'name')
      .sort({ cutType: 1, name: 1 })
      .lean();

    return res.json({ yieldSpecs: specs, count: specs.length });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/operations/yield-specs
 *
 * `expectedYieldPct` is the number preparation is measured against, so it is required
 * and range-checked. A yield spec above 100% means the shop is inventing meat.
 */
router.post('/operations/yield-specs', webAuth('jhatka_catalog_write'), async (req, res, next) => {
  try {
    const {
      code, name, rawProduct, rawSku, cutType, expectedYieldPct,
      shelfLifeHoursPrepared, effectiveFrom, outputUnitCost, notes,
    } = req.body || {};

    for (const f of ['code', 'name', 'rawProduct', 'rawSku', 'cutType', 'expectedYieldPct', 'shelfLifeHoursPrepared', 'effectiveFrom']) {
      if (req.body?.[f] === undefined || req.body?.[f] === '') {
        throw new ApiError(httpStatus.BAD_REQUEST, `${f} is required`, true, '', {
          code: 'MISSING_REQUIRED_FIELD', field: f,
        });
      }
    }

    if (!CUT_TYPES.includes(cutType)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `cutType must be one of ${CUT_TYPES.join(' | ')}`,
        true, '', { code: 'INVALID_CUT_TYPE', allowed: CUT_TYPES, received: cutType }
      );
    }

    const yieldPct = Number(expectedYieldPct);
    if (!Number.isFinite(yieldPct) || yieldPct <= 0 || yieldPct > 100) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'expectedYieldPct must be > 0 and <= 100 — a yield above 100 means the shop is inventing meat',
        true, '', { code: 'INVALID_YIELD', received: expectedYieldPct }
      );
    }

    const spec = await JhatkaYieldSpec.create({
      code: String(code).toUpperCase().trim(),
      name,
      rawProduct,
      rawSku: String(rawSku).toUpperCase(),
      cutType,
      expectedYieldPct: yieldPct,
      shelfLifeHoursPrepared: Number(shelfLifeHoursPrepared),
      effectiveFrom: new Date(effectiveFrom),
      outputUnitCost,
      notes,
      status: 'draft',
    });

    return res.status(201).json({ yieldSpec: spec.toObject() });
  } catch (error) {
    return next(error);
  }
});

/** PATCH /v1/jhatka/admin/operations/yield-specs/:spec */
router.patch('/operations/yield-specs/:spec', webAuth('jhatka_catalog_write'), validate(V.namedParam('spec')), async (req, res, next) => {
  try {
    const spec = await JhatkaYieldSpec.findById(req.params.spec);
    if (!spec) throw new ApiError(httpStatus.NOT_FOUND, 'Yield spec not found');

    const { name, expectedYieldPct, shelfLifeHoursPrepared, effectiveFrom, status, notes } = req.body || {};

    if (name !== undefined) spec.name = name;
    if (expectedYieldPct !== undefined) {
      const y = Number(expectedYieldPct);
      if (!Number.isFinite(y) || y <= 0 || y > 100) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'expectedYieldPct must be > 0 and <= 100', true, '', {
          code: 'INVALID_YIELD', received: expectedYieldPct,
        });
      }
      spec.expectedYieldPct = y;
    }
    if (shelfLifeHoursPrepared !== undefined) spec.shelfLifeHoursPrepared = Number(shelfLifeHoursPrepared);
    if (effectiveFrom !== undefined) spec.effectiveFrom = new Date(effectiveFrom);
    if (notes !== undefined) spec.notes = notes;

    // `cutType` is immutable. Changing it would silently restate every historical
    // yield measured against the old one — the same reason an order's measurement
    // basis is frozen.
    if (req.body.cutType !== undefined && req.body.cutType !== spec.cutType) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'cutType is immutable. Create a new spec — changing it would restate historical yield.',
        true, '', { code: 'CUT_TYPE_IMMUTABLE' }
      );
    }

    if (status !== undefined) {
      if (!['draft', 'active', 'retired'].includes(status)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'status must be draft | active | retired',
          true, '', { code: 'INVALID_STATUS', received: status }
        );
      }
      spec.status = status;
    }

    await spec.save();
    return res.json({ yieldSpec: spec.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/analytics — platform-wide summary for the admin panel.
 *
 * ## Why this is in `operations` and not a new file
 *
 * The plan named an eighth admin file. But this is a READ-ONLY console over the same
 * collections the other operations consoles already reach, and §15.1 requires that
 * every route file maps to exactly one actor and that the mount table stays
 * duplicate-free. Adding a ninth file for one GET would have meant another mount to
 * register and another name to keep in sync with the verifier, for one read.
 *
 * ## It cannot be computed client-side, which is the whole point
 *
 * `absorbedOvercharge`, `refundRate` and `contributionAfterWastage` each require
 * joining money across orders, refunds and wastage. An admin panel that summed them in
 * TypeScript would disagree with `JhatkaSettlement` the first time one of them drifted.
 * One service, one definition of revenue.
 */
router.get('/analytics', webAuth('jhatka_analytics_read'), async (req, res, next) => {
  try {
    const summary = await analyticsService.platformSummary({
      models: {
        JhatkaOrder,
        JhatkaWastage,
        JhatkaOutlet,
        JhatkaRefund,
        JhatkaSubscription,
        JhatkaCompliance,
        JhatkaRecall,
        JhatkaRecurringOrder,
      },
      query: req.query,
    });
    return res.json({ analytics: summary });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.FLAG_ACTION_TRANSITIONS = FLAG_ACTION_TRANSITIONS;
module.exports.CUT_TYPES = CUT_TYPES;