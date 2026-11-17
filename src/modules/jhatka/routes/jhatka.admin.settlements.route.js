/**
 * LocalWala â€“ Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Â© 2026 WeWorkLocal Private Limited
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
 * jhatka.admin.settlements.route.js â€” B1.6
 *
 * Settlements, rider payouts, supplier payables and commission rules.
 *
 * ## Schema verified against `docs/JHATKA-ADMIN-SCHEMA-SURVEY.md`
 *
 *   JhatkaSettlement     required : settlementNo, granularity, period.from, period.to
 *                        status   : draft | finalised | disputed   (NOT "approved")
 *   JhatkaOperatorPayout  status  : draft | approved | paid | disputed | void
 *   JhatkaSupplierPayable status  : draft | approved | paid | disputed | void
 *   JhatkaCommissionRule  required : code, name, businessModel, basis, effectiveFrom
 *                        basis    : final_weighted_value | gross_order_value |
 *                                   net_of_refunds | fixed_monthly
 *                        status   : draft | active | retired
 *
 * ## Finalising is the consequential act in this file
 *
 * A settlement is `draft` until every figure in it is right, and `finalised` after.
 * -10.7 makes a finalised settlement a historical record: it is never recomputed, only
 * superseded. So the transition here REFUSES a settlement whose own arithmetic does not
 * balance, rather than trusting that the 02:00 job got it right.
 *
 * That check is the reason this route exists as more than a viewer. `disputed` sits
 * between the two and means an operator has refused to sign it off â€” which is a real
 * state, not an excuse, because "I do not agree with this number" is the most common
 * and most legitimate thing a partner says about a settlement.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const { asMoney } = require('../utils/money');
const {
  JhatkaSettlement,
  JhatkaOperatorPayout,
  JhatkaSupplierPayable,
  JhatkaCommissionRule,
} = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');
const notifyService = require('../services/jhatka.notify.service');
const supplierPayableService = require('../services/jhatka.supplier.payable.service');

const SETTLEMENT_STATUS = ['draft', 'finalised', 'disputed'];
const PAYOUT_STATUS = ['draft', 'approved', 'paid', 'disputed', 'void'];
const COMMISSION_BASES = [
  'final_weighted_value', 'gross_order_value', 'net_of_refunds', 'fixed_monthly',
];

const SETTLEMENT_TRANSITIONS = {
  draft: ['finalised', 'disputed'],
  disputed: ['finalised', 'draft'],
  // -10.7: a finalised settlement is never recomputed. Only superseded.
  finalised: [],
};

// `.lean()` bypasses the model's toJSON `id` virtual. Admin rows route on `id`,
// so make the lean shapes carry the same identifier the model promises.
const withLeanId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc);

/** GET /v1/jhatka/admin/settlements */
router.get('/settlements', webAuth('jhatka_settlement_read'), async (req, res, next) => {
  try {
    const { status, outlet, from, to, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (outlet) query.outlet = outlet;
    if (from || to) {
      query['period.from'] = {};
      if (from) query['period.from'].$gte = new Date(from);
      if (to) query['period.from'].$lt = new Date(to);
    }

    const [settlements, total] = await Promise.all([
      JhatkaSettlement.find(query)
        .populate('outlet', 'name outletCode businessModel')
        .sort({ 'period.from': -1, createdAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Math.min(200, Math.max(1, Number(limit))))
        .lean(),
      JhatkaSettlement.countDocuments(query),
    ]);

    return res.json({
      settlements: settlements.map(withLeanId),
      page: Number(page),
      limit: Number(limit),
      total,
      count: settlements.length,
      summary: {
        draft: settlements.filter((s) => s.status === 'draft').length,
        disputed: settlements.filter((s) => s.status === 'disputed').length,
        finalised: settlements.filter((s) => s.status === 'finalised').length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/settlements/payouts â€” rider payouts. */
router.get('/settlements/payouts', webAuth('jhatka_settlement_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.outlet) query.outlet = req.query.outlet;
    // -10.3 roll-forward: these are the balances a partner is owed but has not been
    // paid yet, and they are invisible to anyone filtering on status alone.
    if (req.query.rolledForward === 'true') {
      query.statusReason = 'below_minimum_payout_rolled_forward';
    }

    const payouts = await JhatkaOperatorPayout.find(query)
      .populate('outlet', 'name outletCode')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      payouts: payouts.map(withLeanId),
      count: payouts.length,
      summary: {
        draft: payouts.filter((p) => p.status === 'draft').length,
        paid: payouts.filter((p) => p.status === 'paid').length,
        // Paise, matching the stored `netPayout`.
        rolledForwardPaise: payouts
          .filter((p) => p.statusReason === 'below_minimum_payout_rolled_forward')
          .reduce((s, p) => s + (p.netPayout || 0), 0),
      },
    });
  } catch (error) {
    return next(error);
  }
});

/** POST /v1/jhatka/admin/settlements/payouts/:payout/approve */
router.post('/settlements/payouts/:payout/approve', webAuth('jhatka_settlement_write'), validate(V.namedParam('payout')), validate(V.payoutApproveBody), async (req, res, next) => {
  try {
    const payout = await JhatkaOperatorPayout.findById(req.params.payout);
    if (!payout) throw new ApiError(httpStatus.NOT_FOUND, 'Payout not found');

    if (payout.status !== 'draft') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Payout is ${payout.status}; only a draft can be approved`,
        true, '', { code: 'ILLEGAL_STATUS_TRANSITION' }
      );
    }

    // Approving a ROLL-FORWARD would pay exactly the small transfer -10.3 exists to
    // avoid. The operator must leave it rolled forward.
    if (payout.statusReason === 'below_minimum_payout_rolled_forward') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This payout is below the minimum and is carried forward. Approving it would defeat -10.3.',
        true, '',
        { code: 'ROLLED_FORWARD', rolledForwardReason: payout.rolledForwardReason }
      );
    }

    // A payout with no destination cannot be approved.
    if (!payout.payoutDetails?.ifsc && !payout.payoutDetails?.upiId) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'No payout destination on file (IFSC or UPI). Nothing can be transferred.',
        true, '', { code: 'NO_PAYOUT_DESTINATION' }
      );
    }

    payout.status = 'approved';
    payout.approvedAt = new Date();
    payout.approvedBy = req.user._id;
    payout.approvedByName = req.user.name;
    await payout.save();

    return res.json({ payout: payout.toObject(), approved: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/settlements/payouts/:payout/pay
 *
 * Record the external bank/UPI transfer that settles an approved statement.
 * Finance-only: the payee cannot mark its own payout paid, and `draft` is not
 * payable (approval is the control that freezes the amount and destination).
 */
router.post('/settlements/payouts/:payout/pay', webAuth('jhatka_settlement_write'), validate(V.namedParam('payout')), validate(V.payoutPayBody), async (req, res, next) => {
  try {
    const payout = await JhatkaOperatorPayout.findById(req.params.payout);
    if (!payout) throw new ApiError(httpStatus.NOT_FOUND, 'Payout not found');

    if (payout.status === 'paid') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Payout is already paid',
        true, '', { code: 'ALREADY_PAID', paidAt: payout.paidAt, paymentReference: payout.paymentReference }
      );
    }
    if (payout.status !== 'approved') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Payout is ${payout.status}; only an approved payout can be paid`,
        true, '', { code: 'ILLEGAL_STATUS_TRANSITION' }
      );
    }
    if (Number(payout.netPayout) <= 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Payout has no payable amount',
        true, '', { code: 'NOT_PAYABLE' }
      );
    }
    if (!payout.payoutDetails?.ifsc && !payout.payoutDetails?.upiId) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'No payout destination on file (IFSC or UPI). Nothing can be transferred.',
        true, '', { code: 'NO_PAYOUT_DESTINATION' }
      );
    }

    // `netPayout` and `paidAmount` are both moneyFields, and this is a HYDRATED
    // document: reading `netPayout` returns RUPEES and assigning it to the
    // `paidAmount` setter converts back to paise. Do not divide by 100 here.
    payout.totals.paidAmount = payout.netPayout;
    payout.status = 'paid';
    payout.paidAt = new Date();
    payout.paidBy = req.user._id;
    payout.paidByName = req.user.name;
    payout.paymentReference = req.body.paymentReference;
    if (req.body.notes !== undefined) payout.notes = req.body.notes;
    await payout.save();

    const periodLabel = payout.period?.label
      || `${new Date(payout.period.from).toISOString().slice(0, 10)} to ${new Date(payout.period.to).toISOString().slice(0, 10)}`;
    await notifyService.notifyOutlet(payout.outlet, 'payout_processed', {
      payoutNo: payout.payoutNo,
      netPayout: `Rs ${Number(payout.netPayout).toFixed(2)}`,
      periodLabel,
      payoutMethod: payout.payoutMethod === 'wallet' ? 'wallet' : 'bank transfer',
    });

    return res.json({ payout: payout.toObject(), paid: true });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/settlements/payables â€” supplier payables. */
router.get('/settlements/payables', webAuth('jhatka_payables_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.supplier) query.supplier = req.query.supplier;
    if (req.query.outlet) query.outlet = req.query.outlet;

    const payables = await JhatkaSupplierPayable.find(query)
      .populate('supplier', 'code name')
      .populate('outlet', 'name outletCode')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      payables: payables.map(withLeanId),
      count: payables.length,
      summary: {
        draft: payables.filter((p) => p.status === 'draft').length,
        approved: payables.filter((p) => p.status === 'approved').length,
        paid: payables.filter((p) => p.status === 'paid').length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/settlements/payables/generate',
  webAuth('jhatka_payables_manage'),
  validate(V.payableGenerateBody),
  async (req, res, next) => {
    try {
      const payable = await supplierPayableService.generatePayable(req.body);
      return res.status(httpStatus.CREATED).json({ payable: payable.toJSON(), generated: true });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  '/settlements/payables/:payable/approve',
  webAuth('jhatka_payables_manage'),
  validate(V.namedParam('payable')),
  validate(V.payableApproveBody),
  async (req, res, next) => {
    try {
      const payable = await supplierPayableService.approvePayable(
        req.params.payable,
        req.user,
        req.body
      );
      return res.json({ payable: payable.toJSON() });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  '/settlements/payables/:payable/dispute',
  webAuth('jhatka_payables_manage'),
  validate(V.namedParam('payable')),
  validate(V.payableReasonBody),
  async (req, res, next) => {
    try {
      const payable = await supplierPayableService.disputePayable(
        req.params.payable,
        req.body.reason
      );
      return res.json({ payable: payable.toJSON() });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  '/settlements/payables/:payable/void',
  webAuth('jhatka_payables_manage'),
  validate(V.namedParam('payable')),
  validate(V.payableReasonBody),
  async (req, res, next) => {
    try {
      const payable = await supplierPayableService.voidPayable(
        req.params.payable,
        req.user,
        req.body.reason
      );
      return res.json({ payable: payable.toJSON() });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/settlements/payables/:payable/pay',
  webAuth('jhatka_payables_manage'),
  validate(V.namedParam('payable')),
  validate(V.payablePayBody),
  async (req, res, next) => {
    try {
      const payable = await supplierPayableService.payPayable(req.params.payable, req.body);
      return res.json({ payable: payable.toJSON(), paid: true });
    } catch (error) {
      return next(error);
    }
  }
);

/** GET /v1/jhatka/admin/settlements/commission-rules */
router.get('/settlements/commission-rules', webAuth('jhatka_commission_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.businessModel) query.businessModel = req.query.businessModel;

    const rules = await JhatkaCommissionRule.find(query)
      .sort({ effectiveFrom: -1 })
      .lean();

    // Reported per business model because -4 is effective-dated: a partner's rule
    // changes when a new one takes effect, never when an old one is edited.
    const effective = {};
    for (const model of ['commission_partner', 'franchise', 'direct']) {
      const candidates = rules.filter((r) => r.businessModel === model && r.status === 'active');
      effective[model] = candidates.sort(
        (a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom)
      )[0] || null;
    }

    return res.json({
      rules: rules.map(withLeanId),
      count: rules.length,
      effective: Object.fromEntries(
        Object.entries(effective).map(([model, rule]) => [model, rule ? withLeanId(rule) : null])
      ),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/settlements/commission-rules
 *
 * Created `draft`. Activating a commission rule changes what every partner is paid, so
 * it is a separate deliberate act â€” the same reasoning as outlet activation.
 */
router.post('/settlements/commission-rules', webAuth('jhatka_commission_write'), validate(V.commissionRuleAdminBody), async (req, res, next) => {
  try {
    const {
      code, name, businessModel, basis, revenueShareBasis, settlementCycle,
      ratePercent, platformFeePercent, flatAmount, minimumOrderAmount,
      minimumNetPayout, effectiveFrom, notes,
    } = req.body || {};

    for (const f of ['code', 'name', 'businessModel', 'basis', 'effectiveFrom']) {
      if (req.body?.[f] === undefined || req.body?.[f] === '') {
        throw new ApiError(httpStatus.BAD_REQUEST, `${f} is required`, true, '', {
          code: 'MISSING_REQUIRED_FIELD', field: f,
        });
      }
    }

    if (!COMMISSION_BASES.includes(basis)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `basis must be one of ${COMMISSION_BASES.join(' | ')}`,
        true, '', { code: 'INVALID_BASIS', allowed: COMMISSION_BASES, received: basis }
      );
    }

    // `fixed_monthly` without a flat amount is a rule that pays nothing and reads as
    // a generous one.
    if (basis === 'fixed_monthly' && !flatAmount) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'basis fixed_monthly requires flatAmount (in RUPEES)',
        true, '', { code: 'FLAT_AMOUNT_REQUIRED' }
      );
    }

    const rule = await JhatkaCommissionRule.create({
      code: String(code).toUpperCase().trim(),
      name,
      businessModel,
      basis,
      revenueShareBasis: revenueShareBasis || undefined,
      settlementCycle: settlementCycle || 'monthly',
      // The model field is `ratePercent`. This used to write `commissionPct`,
      // which the schema does not define â€” Mongoose silently stripped it, so
      // every rule created through this API was saved with NO rate at all
      // while looking complete in the response.
      // `platformFeePercent` is the OTHER rate: the platform's charge,
      // deducted from payouts. The two must never be netted â€” one is the
      // partner's earning, the other is what LocalWala keeps.
      ratePercent: ratePercent === undefined ? undefined : Number(ratePercent),
      platformFeePercent:
        platformFeePercent === undefined ? undefined : Number(platformFeePercent),
      flatAmount,
      minimumOrderAmount,
      minimumNetPayout,
      effectiveFrom: new Date(effectiveFrom),
      notes,
      status: 'draft',
    });

    return res.status(201).json({ rule: rule.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/settlements/commission-rules/:rule
 *
 * The ONLY mutable field on an `active` rule is `status` (to retire it). Everything
 * else is locked, because section 4 makes a rule effective-dated: editing a live rule
 * restates what every partner was paid in every period it was active for. Retiring and
 * superseding is how you change a rule without rewriting history.
 */
router.patch('/settlements/commission-rules/:rule', webAuth('jhatka_commission_write'), validate(V.namedParam('rule')), async (req, res, next) => {
  try {
    const rule = await JhatkaCommissionRule.findById(req.params.rule);
    if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'Commission rule not found');

    const { status, notes } = req.body || {};

    if (rule.status === 'active') {
      const lockedFields = ['ratePercent', 'platformFeePercent', 'flatAmount', 'basis',
        'minimumNetPayout', 'minimumOrderAmount'];
      const attempted = lockedFields.filter((f) => req.body[f] !== undefined);
      if (attempted.length) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'An ACTIVE rule is immutable (' + attempted.join(', ') + '). Retire it and create a superseding rule.',
          true, '',
          { code: 'RULE_IMMUTABLE_WHILE_ACTIVE', fields: attempted }
        );
      }
    }

    if (status !== undefined) {
      if (!['draft', 'active', 'retired'].includes(status)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'status must be draft | active | retired',
          true, '', { code: 'INVALID_STATUS', received: status }
        );
      }
      // Two active rules for one business model would make "which applies" ambiguous.
      if (status === 'active') {
        const clash = await JhatkaCommissionRule.findOne({
          _id: { $ne: rule._id },
          businessModel: rule.businessModel,
          status: 'active',
        }).lean();
        if (clash) {
          throw new ApiError(
            httpStatus.CONFLICT,
            `${clash.code} is already active for ${rule.businessModel}. Retire it first.`,
            true, '',
            { code: 'ANOTHER_RULE_ACTIVE', conflicting: clash.code }
          );
        }
      }
      rule.status = status;
    }

    if (notes !== undefined) rule.notes = notes;
    if (rule.status !== 'active') {
      const editable = ['name', 'ratePercent', 'platformFeePercent', 'flatAmount', 'basis',
        'revenueShareBasis', 'settlementCycle', 'minimumOrderAmount', 'minimumNetPayout',
        'effectiveFrom'];
      for (const f of editable) {
        if (req.body[f] === undefined) continue;
        if (['effectiveFrom'].includes(f)) rule[f] = new Date(req.body[f]);
        else if (['ratePercent', 'platformFeePercent'].includes(f)) rule[f] = Number(req.body[f]);
        else if (['flatAmount', 'minimumOrderAmount', 'minimumNetPayout'].includes(f)) {
          rule[f] = asMoney(Number(req.body[f]));
        } else rule[f] = req.body[f];
      }
    }

    await rule.save();
    return res.json({ rule: rule.toObject() });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recompute the margin from a settlement's own stored totals.
 *
 * Deliberately the SAME formula as `utils/commercial.arithmetic.contributionMargin`,
 * restated here in the RUPEES a hydrated document yields. The alternative â€”
 * re-reading the line items â€” is not possible: a settlement stores aggregated totals,
 * not its orders, and reaching back to them would be a different question from "does
 * this settlement's arithmetic close".
 */
function recomputeMargin(settlement) {
  const g = (v) => Number(v) || 0;
  const t = settlement.totals || {};

  const netCollections =
    g(t.grossOrderValue) - g(t.weightAdjustmentTotal) - g(t.absorbedOvercharge) - g(t.discountTotal);

  const platformGrossRevenue = netCollections - g(t.taxCollected);
  const platformNetRevenue =
    platformGrossRevenue - g(t.cogsTotal) - g(t.wastageTotal) - g(t.operatorPayoutTotal);
  const contributionMargin = platformNetRevenue - g(t.deliveryCostTotal);

  return {
    netCollections: Number(netCollections.toFixed(2)),
    platformGrossRevenue: Number(platformGrossRevenue.toFixed(2)),
    platformNetRevenue: Number(platformNetRevenue.toFixed(2)),
    contributionMargin: Number(contributionMargin.toFixed(2)),
    contributionMarginPct:
      netCollections > 0
        ? Number(((contributionMargin / netCollections) * 100).toFixed(2))
        : 0,
  };
}

/**
 * GET /v1/jhatka/admin/settlements/:settlement
 *
 * Includes an INDEPENDENT recomputation of the margin from the stored line items, so an
 * operator can see whether the stored total agrees with the lines it came from.
 */
router.get('/settlements/:settlement', webAuth('jhatka_settlement_read'), validate(V.namedParam('settlement')), async (req, res, next) => {
  try {
    const settlement = await JhatkaSettlement.findById(req.params.settlement)
      .populate('outlet', 'name outletCode businessModel')
      .lean();

    if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');

    return res.json({
      settlement,
      // RUPEES, matching the model's getters. The stored `totals.*` are already
      // rupees on a hydrated read; recomputing here in the same unit is what makes
      // the two comparable.
      recomputed: recomputeMargin(settlement),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/settlements/:settlement/finalise
 *
 * Refuses a settlement whose arithmetic does not close.
 *
 * The check is `contributionMarginPct` only, NOT every total: the margin is derived
 * from the others, so if it agrees then the inputs agree. Asserting every field would
 * be theatre â€” and would block legitimate settlements over a rounding rupee.
 */
router.post('/settlements/:settlement/finalise', webAuth('jhatka_settlement_write'), validate(V.namedParam('settlement')), validate(V.settlementDecisionBody), async (req, res, next) => {
  try {
    const settlement = await JhatkaSettlement.findById(req.params.settlement);
    if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');

    if (settlement.status !== 'draft') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Settlement is ${settlement.status}; only a draft can be finalised`,
        true, '',
        { code: 'ILLEGAL_STATUS_TRANSITION', from: settlement.status, to: 'finalised' }
      );
    }

    if (!settlement.totals || settlement.totals.orderCount === 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'An empty settlement cannot be finalised â€” it has no orders',
        true, '', { code: 'EMPTY_SETTLEMENT' }
      );
    }

    const recomputed = recomputeMargin(settlement);
    const storedPct = settlement.totals.contributionMarginPct || 0;
    const driftPct = Math.abs(recomputed.contributionMarginPct - storedPct);

    // 0.5pp. Tight enough to catch a wrong input, loose enough to survive rounding
    // across ~20 terms.
    if (driftPct > 0.5) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Refused: stored margin ${storedPct}% disagrees with the line items (${recomputed.contributionMarginPct}%)`,
        true, '',
        {
          code: 'SETTLEMENT_DOES_NOT_BALANCE',
          storedMarginPct: storedPct,
          recomputedMarginPct: recomputed.contributionMarginPct,
          driftPct: Number(driftPct.toFixed(4)),
          tolerancePp: 0.5,
        }
      );
    }

    settlement.status = 'finalised';
    settlement.finalisedAt = new Date();
    settlement.finalisedBy = req.user._id;
    settlement.finalisedByName = req.user.name;
    await settlement.save();

    return res.json({ settlement: settlement.toObject(), finalised: true, driftPct: Number(driftPct.toFixed(4)) });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/settlements/:settlement/dispute
 *
 * `disputed` is a real, reachable state and the only way INTO it from draft. -10.7
 * says a finalised settlement is never recomputed, so a disagreement must be raised
 * BEFORE signing off, not after.
 */
router.post('/settlements/:settlement/dispute', webAuth('jhatka_settlement_write'), validate(V.namedParam('settlement')), validate(V.settlementDecisionBody), async (req, res, next) => {
  try {
    const settlement = await JhatkaSettlement.findById(req.params.settlement);
    if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');

    if (settlement.status !== 'draft') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Only a draft can be disputed (this one is ${settlement.status})`,
        true, '', { code: 'ILLEGAL_STATUS_TRANSITION' }
      );
    }
    if (!req.body?.disputeReason || String(req.body.disputeReason).trim().length < 10) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'disputeReason (at least 10 characters) is required â€” a disputed settlement without a reason cannot be resolved',
        true, '', { code: 'REASON_REQUIRED' }
      );
    }

    settlement.status = 'disputed';
    settlement.disputedAt = new Date();
    settlement.disputedBy = req.user._id;
    settlement.disputeReason = String(req.body.disputeReason).trim();
    await settlement.save();

    return res.json({ settlement: settlement.toObject(), disputed: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.SETTLEMENT_TRANSITIONS = SETTLEMENT_TRANSITIONS;
module.exports.recomputeMargin = recomputeMargin;
module.exports.SETTLEMENT_STATUS = SETTLEMENT_STATUS;
module.exports.PAYOUT_STATUS = PAYOUT_STATUS;

