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
 * The variance console (weight fraud), yield specs, read-only operational consoles,
 * and the two human escape hatches for refunds the automated queue cannot settle.
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
  JhatkaQualityRejectionReason,
  JhatkaOrder,
  JhatkaRefund,
  JhatkaRecurringOrder,
  JhatkaSubscription,
  JhatkaWastage,
  JhatkaOutlet,
  JhatkaCompliance,
  JhatkaRecall,
  PaymentInitiation,
  PaymentConfig,
} = require('../../../models');
const analyticsService = require('../services/jhatka.analytics.service');
const refundSettlement = require('../services/jhatka.refund.settlement');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

// `.lean()` bypasses the model's toJSON `id` virtual. The console acts on `id`, so
// every lean row returned here must carry the same identifier the model promises.
const withLeanId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc);

const FLAG_ACTIONS = ['none', 'observed', 'reviewed', 'escalated', 'calibrated', 'fraud_referred'];
const CUT_TYPES = [
  'whole', 'curry_cut', 'skinless', 'boneless', 'cleaned',
  'fish_cleaned', 'prawn_peeled', 'portioned',
];

const REASON_CODE_RE = /^[a-z0-9_]+$/;

const reasonResponse = (reason) => ({
  id: String(reason._id || reason.id),
  code: reason.code,
  label: reason.label,
  description: reason.description,
  category: reason.category,
  severity: reason.severity,
  autoReject: !!reason.autoReject,
  fault: reason.fault,
  wastageCause: reason.wastageCause,
  affectsSupplierRating: reason.affectsSupplierRating !== false,
  sortOrder: reason.sortOrder ?? 0,
  status: reason.status !== false,
  translations: reason.translations,
  createdAt: reason.createdAt,
  updatedAt: reason.updatedAt,
});

const reasonMeta = () => ({
  categories: JhatkaQualityRejectionReason.CATEGORIES,
  severities: JhatkaQualityRejectionReason.SEVERITIES,
  faults: JhatkaQualityRejectionReason.FAULTS,
  wastageCauses: JhatkaQualityRejectionReason.WASTAGE_CAUSES,
});

const rejectField = (field, code, message, extra = {}) => {
  throw new ApiError(httpStatus.BAD_REQUEST, message, true, '', {
    code,
    field,
    ...extra,
  });
};

/**
 * Validate and normalize the POST/PATCH body for a rejection reason.
 * Unknown keys are ignored; only the governed vocabulary is writable here.
 */
const normalizeReasonFields = (body, { requireCore = false } = {}) => {
  const input = body || {};
  const out = {};

  if (requireCore || input.code !== undefined) {
    const code = String(input.code || '').trim().toLowerCase();
    if (!code) rejectField('code', 'MISSING_REQUIRED_FIELD', 'code is required');
    if (code.length > 64) rejectField('code', 'INVALID_REASON_CODE', 'code must be at most 64 characters');
    if (!REASON_CODE_RE.test(code)) {
      rejectField(
        'code',
        'INVALID_REASON_CODE',
        'code must use lowercase letters, numbers and underscores only'
      );
    }
    out.code = code;
  }

  if (requireCore || input.label !== undefined) {
    const label = String(input.label || '').trim();
    if (!label) rejectField('label', 'MISSING_REQUIRED_FIELD', 'label is required');
    if (label.length > 120) rejectField('label', 'INVALID_LABEL', 'label must be at most 120 characters');
    out.label = label;
  }

  if (input.description !== undefined) {
    const description = String(input.description || '').trim();
    if (description.length > 1000) {
      rejectField('description', 'INVALID_DESCRIPTION', 'description must be at most 1000 characters');
    }
    out.description = description;
  }

  if (requireCore || input.category !== undefined) {
    if (!JhatkaQualityRejectionReason.CATEGORIES.includes(input.category)) {
      rejectField(
        'category',
        'INVALID_REASON_CATEGORY',
        `category must be one of ${JhatkaQualityRejectionReason.CATEGORIES.join(' | ')}`,
        { allowed: JhatkaQualityRejectionReason.CATEGORIES, received: input.category }
      );
    }
    out.category = input.category;
  }

  if (requireCore || input.severity !== undefined) {
    if (!JhatkaQualityRejectionReason.SEVERITIES.includes(input.severity)) {
      rejectField(
        'severity',
        'INVALID_REASON_SEVERITY',
        `severity must be one of ${JhatkaQualityRejectionReason.SEVERITIES.join(' | ')}`,
        { allowed: JhatkaQualityRejectionReason.SEVERITIES, received: input.severity }
      );
    }
    out.severity = input.severity;
  }

  if (input.fault !== undefined) {
    if (!JhatkaQualityRejectionReason.FAULTS.includes(input.fault)) {
      rejectField(
        'fault',
        'INVALID_REASON_FAULT',
        `fault must be one of ${JhatkaQualityRejectionReason.FAULTS.join(' | ')}`,
        { allowed: JhatkaQualityRejectionReason.FAULTS, received: input.fault }
      );
    }
    out.fault = input.fault;
  }

  if (input.wastageCause !== undefined) {
    if (!JhatkaQualityRejectionReason.WASTAGE_CAUSES.includes(input.wastageCause)) {
      rejectField(
        'wastageCause',
        'INVALID_WASTAGE_CAUSE',
        `wastageCause must be one of ${JhatkaQualityRejectionReason.WASTAGE_CAUSES.join(' | ')}`,
        {
          allowed: JhatkaQualityRejectionReason.WASTAGE_CAUSES,
          received: input.wastageCause,
        }
      );
    }
    out.wastageCause = input.wastageCause;
  }

  for (const field of ['autoReject', 'affectsSupplierRating', 'status']) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'boolean') {
        rejectField(field, 'INVALID_BOOLEAN', `${field} must be true or false`);
      }
      out[field] = input[field];
    }
  }

  if (input.sortOrder !== undefined) {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      rejectField('sortOrder', 'INVALID_SORT_ORDER', 'sortOrder must be a non-negative integer');
    }
    out.sortOrder = sortOrder;
  }

  if (input.translations !== undefined) {
    if (
      !input.translations ||
      typeof input.translations !== 'object' ||
      Array.isArray(input.translations)
    ) {
      rejectField('translations', 'INVALID_TRANSLATIONS', 'translations must be an object');
    }
    out.translations = input.translations;
  }

  return out;
};

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
      flags: flags.map(withLeanId),
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
 * The operator's view of the refund queue. Automatic settlement still owns the happy
 * path; this console shows the rows where that path stopped, and the two POST routes
 * below are the deliberate human escape hatches.
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
      refunds: refunds.map(withLeanId),
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
 * POST /v1/jhatka/admin/operations/refunds/:refund/retry
 *
 * Re-issue a parked or stuck refund through the SAME document. The service resets
 * the exhausted attempt counter but derives the idempotency key from the refund id,
 * so a gateway that already accepted the original request de-duplicates it instead
 * of paying twice.
 */
router.post(
  '/operations/refunds/:refund/retry',
  webAuth('jhatka_settlement_write'),
  validate(V.namedParam('refund')),
  validate(V.refundRetryBody),
  async (req, res, next) => {
    try {
      const refund = await refundSettlement.retryRefund({
        models: {
          JhatkaRefund, JhatkaOrder, PaymentInitiation, PaymentConfig,
        },
        refundId: req.params.refund,
        actor: { _id: req.user._id, name: req.user.name },
        note: req.body?.note,
      });

      return res.json({ refund: withLeanId(refund.toObject()) });
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /v1/jhatka/admin/operations/refunds/:refund/resolve
 *
 * Close a FAILED refund that finance settled OUTSIDE the gateway queue. Only a
 * FAILED row is eligible: a PROCESSING row may still be in flight, and marking that
 * paid could pay twice. The reference and operator note are both mandatory.
 */
router.post(
  '/operations/refunds/:refund/resolve',
  webAuth('jhatka_settlement_write'),
  validate(V.namedParam('refund')),
  validate(V.refundResolveBody),
  async (req, res, next) => {
    try {
      const refund = await refundSettlement.resolveRefundManually({
        models: { JhatkaRefund, JhatkaOrder },
        refundId: req.params.refund,
        actor: { _id: req.user._id, name: req.user.name },
        paymentReference: req.body.paymentReference,
        note: req.body.note,
      });

      return res.json({ refund: withLeanId(refund.toObject()) });
    } catch (error) {
      return next(error);
    }
  }
);

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
      occurrences: occurrences.map(withLeanId),
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
      subscriptions: subscriptions.map(withLeanId),
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

    return res.json({
      orders: orders.map(withLeanId), count: orders.length, byReason, byActor,
    });
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

    return res.json({ yieldSpecs: specs.map(withLeanId), count: specs.length });
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
 * GET /v1/jhatka/admin/operations/rejection-reasons
 *
 * The controlled rejection vocabulary, including inactive rows so an admin can
 * reactivate one. The partner picker only ever sees `status: true` rows.
 */
router.get('/operations/rejection-reasons', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status === 'true' || req.query.status === 'false') {
      query.status = req.query.status === 'true';
    }
    if (req.query.category) query.category = req.query.category;
    if (req.query.fault) query.fault = req.query.fault;

    const reasons = await JhatkaQualityRejectionReason.find(query)
      .sort({ category: 1, sortOrder: 1, label: 1 })
      .lean();

    return res.json({
      reasons: reasons.map(reasonResponse),
      count: reasons.length,
      meta: reasonMeta(),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/operations/rejection-reasons
 *
 * Creates a governed rejection reason. `category` and `severity` are required:
 * a reason without them cannot group the picker or drive the human-decision queue.
 */
router.post('/operations/rejection-reasons', webAuth('jhatka_catalog_write'), async (req, res, next) => {
  try {
    const fields = normalizeReasonFields(req.body, { requireCore: true });
    const reason = new JhatkaQualityRejectionReason({
      ...fields,
      autoReject: fields.autoReject ?? false,
      fault: fields.fault ?? 'unknown',
      wastageCause: fields.wastageCause ?? 'QUALITY_REJECTION',
      affectsSupplierRating: fields.affectsSupplierRating ?? true,
      sortOrder: fields.sortOrder ?? 0,
      status: fields.status ?? true,
    });
    await reason.save();
    return res.status(201).json({ reason: reasonResponse(reason) });
  } catch (error) {
    if (error && error.code === 11000) {
      return next(new ApiError(
        httpStatus.CONFLICT,
        'A rejection reason with this code already exists',
        true,
        '',
        { code: 'REASON_CODE_EXISTS' }
      ));
    }
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/operations/rejection-reasons/:reason
 *
 * `code` is immutable: historical receipt lines store the code, and renaming it
 * would orphan those decisions. Deactivate with `status: false` instead.
 */
router.patch(
  '/operations/rejection-reasons/:reason',
  webAuth('jhatka_catalog_write'),
  validate(V.namedParam('reason')),
  async (req, res, next) => {
    try {
      const reason = await JhatkaQualityRejectionReason.findById(req.params.reason);
      if (!reason) throw new ApiError(httpStatus.NOT_FOUND, 'Rejection reason not found');

      if (req.body?.code !== undefined && req.body.code !== reason.code) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'code is immutable. Create a new reason instead.',
          true,
          '',
          { code: 'REASON_CODE_IMMUTABLE' }
        );
      }

      const fields = normalizeReasonFields(req.body);
      delete fields.code;
      Object.assign(reason, fields);
      await reason.save();

      return res.json({ reason: reasonResponse(reason) });
    } catch (error) {
      return next(error);
    }
  }
);

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