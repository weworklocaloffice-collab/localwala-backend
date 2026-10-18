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

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');
const { payoutDecision } = require('../utils/commercial.arithmetic');

/**
 * JhatkaOperatorPayout — LocalWala paying a commission partner or franchisee.
 *
 * ## BR-05 is why this document exists in this shape
 *
 * Under the source blueprint's §37, customer money went to the partner outlet and
 * a commission came back to LocalWala. That is not what happens here. **LocalWala
 * is Merchant of Record for all three models**: the customer pays LocalWala, and
 * the operator is paid an ACCOUNTS PAYABLE against a statement.
 *
 * Three consequences, all of them good:
 *
 *   1. A partner leaving tomorrow strands nothing. The statement closes, and that
 *      is the end of it.
 *   2. Refunds move from one entity to one customer, with no partner cooperation
 *      required on a money movement.
 *   3. This document is an AP statement, which is `DairyProviderPayable`'s shape
 *      — including its sign convention, `netAmount` positive when WE owe.
 *
 * ## `ruleSnapshot` on the header AND on every line. BR-26.
 *
 * The header snapshot proves which rule produced the statement. Each line's
 * snapshot proves which rule produced THAT line, which is what answers a dispute
 * raised six months later about one order in a period containing two hundred.
 *
 * ## Compensatable, not atomic
 *
 * Copied from `dairy.provider.payable.service`: the statement is written first,
 * the source records are claimed second, and a failed claim VOIDS the statement
 * rather than leaving a half-applied one. MongoDB is standalone in development, so
 * `withOptionalTransaction` degrades to sequential writes and correctness has to
 * come from compensating rather than from rollback.
 */
const PAYOUT_STATUSES = ['draft', 'approved', 'paid', 'disputed', 'void'];

const PAYOUT_TRANSITIONS = {
  draft: ['approved', 'disputed', 'void'],
  disputed: ['approved', 'void'],
  approved: ['paid', 'disputed', 'void'],
  paid: [],
  void: [],
};

const jhatkaOperatorPayoutSchema = mongoose.Schema(
  {
    payoutNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** One of these is set. `partner` for commission, `franchise` for franchise. */
    partner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaPartner',
      required: false,
      default: undefined,
    },
    franchise: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaFranchise',
      required: false,
      default: undefined,
    },
    /** The outlet the money relates to. A partner may operate several (BR-04). */
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    businessModel: {
      type: String,
      required: true,
      enum: ['commission_partner', 'franchise'],
    },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      label: { type: String, required: false, trim: true },
    },
    /**
     * BR-26. The frozen rule that produced this statement. A deep copy with no
     * `_id`, so it cannot start resolving to a different document later.
     */
    ruleSnapshot: {
      type: mongoose.SchemaTypes.Mixed,
      required: true,
    },

    totals: {
      orderCount: { type: Number, required: false, default: 0, min: 0 },
      /** Commissionable revenue before commission. */
      grossRevenue: moneyField(0),
      /** What the customer paid, for comparison with the commissionable figure. */
      grossOrderValue: moneyField(0),
      /** Refunds settled in the period. Informational — the basis already excludes them. */
      refundDeduction: moneyField(0),
      /** Upward weight variance the platform absorbed. Not the operator's cost. */
      absorbedOvercharge: moneyField(0),
      platformFee: moneyField(0),
      /** What the operator earned. */
      commissionEarned: moneyField(0),
      /** Franchise royalty, where applicable. */
      royalty: moneyField(0),
      adjustments: moneyField(0),
      /**
       * POSITIVE when the platform owes. Same convention as
       * `DairyProviderPayable`. A negative `netAmount` is a genuine anomaly and
       * `payoutDecision()` refuses to pay one.
       */
      netAmount: moneyField(0),
      /** What has actually been paid against this statement. */
      paidAmount: moneyField(0),
    },

    items: [
      {
        _id: false,
        order: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaOrder',
          required: true,
        },
        orderNo: { type: String, required: true, uppercase: true, trim: true },
        orderDate: { type: Date, required: true },
        /** What the customer was charged. */
        grossOrderValue: moneyField(0),
        /** What the meat was actually worth once weighed — the commission base. */
        commissionableRevenue: moneyField(0),
        /** Itemised so a dispute can see WHICH components counted. §10.1 */
        revenueComponents: {
          product: moneyField(0),
          delivery: moneyField(0),
          packaging: moneyField(0),
          service: moneyField(0),
        },
        refundDeduction: moneyField(0),
        platformFee: moneyField(0),
        commissionEarned: moneyField(0),
        /** BR-26, per line. This is what answers a single-order dispute. */
        ruleSnapshot: { type: mongoose.SchemaTypes.Mixed, required: false },
      },
    ],

    adjustments: [
      {
        _id: false,
        amount: moneyField(0),
        reason: { type: String, required: true, trim: true },
        recordedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        recordedByName: { type: String, required: false, trim: true },
        recordedAt: { type: Date, required: true },
      },
    ],

    status: {
      type: String,
      required: false,
      enum: PAYOUT_STATUSES,
      default: 'draft',
    },
    statusReason: { type: String, required: false, trim: true },

    /**
     * §4.3. The rate is a finance input, so it arrives with the statement rather
     * than being hard-coded. Indian TDS rates differ by income type.
     */
    tds: {
      applicable: { type: Boolean, required: false, default: false },
      ratePercent: { type: Number, required: false, default: 0 },
      tdsAmount: moneyField(0),
    },
    /** `netAmount − tdsAmount`. What actually reaches the bank. */
    netPayout: moneyField(0),

    payoutMethod: {
      type: String,
      required: false,
      enum: ['bank', 'wallet'],
      default: 'bank',
    },
    /**
     * Frozen from the operator's own bank details at payment time. Deliberately a
     * copy: a partner changing their bank account after a statement is approved
     * must not silently redirect an approved payout.
     */
    payoutDetails: {
      accountName: { type: String, required: false, trim: true },
      accountNumber: { type: String, required: false, trim: true },
      ifsc: { type: String, required: false, trim: true, uppercase: true },
      upiId: { type: String, required: false, trim: true },
    },
    paymentReference: { type: String, required: false, trim: true },
    paidAt: { type: Date, required: false },

    approvedAt: { type: Date, required: false },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedByName: { type: String, required: false, trim: true },

    /**
     * Why nothing was transferred when `netAmount > 0`. §10.3 — below the floor,
     * the balance rolls forward.
     */
    rolledForwardReason: { type: String, required: false, trim: true },

    /** Compensation pointer. Voiding claims the source records back. */
    voidedAt: { type: Date, required: false },
    voidedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    voidedByName: { type: String, required: false, trim: true },
    notes: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaOperatorPayoutSchema.plugin(toJSON);
jhatkaOperatorPayoutSchema.plugin(paginate);
jhatkaOperatorPayoutSchema.index({ payoutNo: 1 }, { unique: true });
/**
 * Idempotency.
 *
 * UNIQUE on `{operatorKey, 'period.from'}` where `operatorKey` is `partner` XOR
 * `franchise`. One statement per operator per period — two would double the
 * payout.
 *
 * `stores.settlement.service` gets this wrong: it queries for an existing
 * settlement and finds none, with no unique index behind it, so two concurrent
 * generators produce two settlements (F-3).
 */
jhatkaOperatorPayoutSchema.index(
  { operatorKey: 1, 'period.from': 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: 'void' } },
    name: 'one_live_payout_per_operator_and_period',
  }
);
// The weekly/monthly generator's hot query.
jhatkaOperatorPayoutSchema.index({ outlet: 1, status: 1, 'period.from': -1 });
jhatkaOperatorPayoutSchema.index({ partner: 1, status: 1 });
jhatkaOperatorPayoutSchema.index({ franchise: 1, status: 1 });
// "Which statement contains this order?" — a dispute lookup.
jhatkaOperatorPayoutSchema.index({ 'items.order': 1 });
// The payout floor queue: statements waiting to clear the minimum.
jhatkaOperatorPayoutSchema.index({ status: 1, 'totals.netAmount': 1 });

jhatkaOperatorPayoutSchema.statics.STATUSES = PAYOUT_STATUSES;
jhatkaOperatorPayoutSchema.statics.PAYOUT_TRANSITIONS = PAYOUT_TRANSITIONS;

/** May this payout move from `from` to `to`? */
jhatkaOperatorPayoutSchema.statics.canTransition = function (from, to) {
  const allowed = PAYOUT_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * The partner or franchise this statement pays, whichever is set.
 *
 * Exactly one of the two is required, enforced by `operatorKey`'s partial-unique
 * index above — a statement with neither has nobody to pay, and one with both is
 * ambiguous about which agreement governs.
 */
jhatkaOperatorPayoutSchema.methods.counterpartyId = function () {
  return this.partner || this.franchise || null;
};

/**
 * Is this statement payable now? §10.3.
 *
 * Delegates to `commercial.arithmetic.payoutDecision` rather than re-implementing
 * the floor rule, because a floor check duplicated between the generator and this
 * model is how a ₹40 transfer gets sent anyway.
 */
jhatkaOperatorPayoutSchema.methods.isPayable = function (minimumNetPayout) {
  const floor = minimumNetPayout ?? this.ruleSnapshot?.minimumNetPayout ?? 0;
  return payoutDecision(this.totals.netAmount, floor);
};

/**
 * @typedef JhatkaOperatorPayout
 */
const JhatkaOperatorPayout = mongoose.model('JhatkaOperatorPayout', jhatkaOperatorPayoutSchema);

module.exports = JhatkaOperatorPayout;