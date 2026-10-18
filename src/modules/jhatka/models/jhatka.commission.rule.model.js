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
const {
  REVENUE_SHARE_BASES,
  COMMISSION_BASES,
} = require('../utils/commercial.arithmetic');

/**
 * JhatkaCommissionRule — the versioned rule that produces a payout.
 *
 * ## Versioned, never mutated
 *
 * `JhatkaOperatorPayout` and `JhatkaFranchise` both carry a frozen `ruleSnapshot`.
 * This document changing must not restate a payout already approved — that is
 * BR-26, and the only way to guarantee it is for the live rule to be immutable
 * once used and for every payout to reference a snapshot rather than a ref.
 *
 * A rate change from 10% to 12% therefore creates a NEW row. The old one is
 * `retired`, not deleted, because a dispute six months later needs the rule that
 * was actually in force.
 *
 * ## ONE live rule per business model
 *
 * Partial-unique on `{businessModel}` where `status: 'active'`. Without it two
 * active rules exist and the payout generator has to guess, and a guess here
 * pays money.
 *
 * ## `basis` and `revenueShareBasis` are DIFFERENT QUESTIONS
 *
 *   `basis`             what revenue the commission is a percentage OF
 *                       final_weighted_value | gross_order_value | net_of_refunds
 *   `revenueShareBasis` which components a revenue-SHARE agreement counts
 *                       product_only | product_and_delivery | …
 *
 * A commission partner is normally on `final_weighted_value` — and that is a
 * direct consequence of BR-06. Because a short weight produces a refund the
 * partner never receives, commissioning on `gross_order_value` would charge them
 * commission on money that was returned to the customer. Under-delivery reduces
 * what they earn, which is correct: they prepared less.
 */
const jhatkaCommissionRuleSchema = mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    /** `direct` has no commission — LocalWala owns the counter. */
    businessModel: {
      type: String,
      required: true,
      enum: ['commission_partner', 'franchise', 'direct'],
    },
    basis: {
      type: String,
      required: true,
      enum: COMMISSION_BASES,
      default: 'final_weighted_value',
    },
    /** Percentage as a NUMBER (10 = 10%), not basis points. Read by a human. */
    ratePercent: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
      default: 0,
    },
    /** Used only when `basis: 'fixed_monthly'`. */
    flatAmount: moneyField(0),
    revenueShareBasis: {
      type: String,
      required: false,
      enum: REVENUE_SHARE_BASES,
      default: 'product_only',
    },
    /**
     * Applied on top of commission as a deduction. Kept separate from `ratePercent`
     * because they are different things — one is the partner's earning, the other
     * a platform charge — and netting them hides both in a statement.
     */
    platformFeePercent: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
      default: 0,
    },
    /** Limit to specific categories. Empty means all. */
    appliesToCategories: {
      type: [String],
      required: false,
      default: [],
    },
    /**
     * Below this counted revenue, no commission is earned at all. How a partner
     * agreement with a minimum basket behaves.
     */
    minimumOrderAmount: moneyField(0),
    /**
     * Below this net amount, the payout rolls forward rather than transferring.
     * A ₹40 bank transfer costs more than the ₹40 is worth.
     */
    minimumNetPayout: moneyField(500),
    paymentTermDays: {
      type: Number,
      required: false,
      min: 0,
      default: 0,
    },
    settlementCycle: {
      type: String,
      required: false,
      enum: ['weekly', 'monthly'],
      default: 'weekly',
    },
    /**
     * §4.3. Present on day one because deducting it after payouts have been made
     * means restating statements. Finance turns it on BEFORE the first partner is
     * paid, not after.
     */
    tdsApplicable: {
      type: Boolean,
      required: false,
      default: false,
    },
    tdsRatePercent: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
      default: 0,
    },
    effectiveFrom: {
      type: Date,
      required: true,
    },
    effectiveTo: {
      type: Date,
      required: false,
      default: undefined,
    },
    version: {
      type: Number,
      required: false,
      default: 1,
    },
    /** Superseded by a later version. Retired rows are never deleted. */
    supersedes: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaCommissionRule',
      required: false,
      default: undefined,
    },
    status: {
      type: String,
      required: false,
      enum: ['draft', 'active', 'retired'],
      default: 'draft',
    },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedByName: { type: String, required: false, trim: true },
    approvedAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaCommissionRuleSchema.plugin(toJSON);
jhatkaCommissionRuleSchema.plugin(paginate);
jhatkaCommissionRuleSchema.index({ code: 1 }, { unique: true });
/**
 * ONE LIVE RULE PER BUSINESS MODEL.
 *
 * Two active rules means the payout generator has to choose, and a choice here
 * pays money to one of two partners. Partial-unique on `status: 'active'` so a
 * retired rule and its successor can coexist.
 */
jhatkaCommissionRuleSchema.index(
  { businessModel: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'one_active_commission_rule_per_business_model',
  }
);
// The payout generator's lookup.
jhatkaCommissionRuleSchema.index({ status: 1, effectiveFrom: -1 });

jhatkaCommissionRuleSchema.statics.COMMISSION_BASES = COMMISSION_BASES;
jhatkaCommissionRuleSchema.statics.REVENUE_SHARE_BASES = REVENUE_SHARE_BASES;

/**
 * The snapshot a payout freezes. BR-26.
 *
 * A deep copy of exactly the fields the arithmetic reads, with no `_id` and no
 * timestamps — a snapshot that carries a mutable ObjectId is not a snapshot, it is
 * a reference that can start resolving to a different document.
 *
 * @returns {object}
 */
jhatkaCommissionRuleSchema.methods.toSnapshot = function () {
  return {
    code: this.code,
    name: this.name,
    businessModel: this.businessModel,
    basis: this.basis,
    ratePercent: this.ratePercent,
    flatAmount: this.flatAmount,
    revenueShareBasis: this.revenueShareBasis,
    platformFeePercent: this.platformFeePercent,
    minimumOrderAmount: this.minimumOrderAmount,
    minimumNetPayout: this.minimumNetPayout,
    settlementCycle: this.settlementCycle,
    tdsApplicable: this.tdsApplicable,
    tdsRatePercent: this.tdsRatePercent,
    version: this.version,
    effectiveFrom: this.effectiveFrom,
    frozenAt: new Date(),
  };
};

/**
 * Is this rule in force on a given date?
 *
 * Both bounds are inclusive of `effectiveFrom` and exclusive of `effectiveTo`, so
 * back-to-back versions do not overlap on a single day — an overlap would leave
 * two rules claiming the same order.
 */
jhatkaCommissionRuleSchema.methods.isInForceOn = function (date = new Date()) {
  const d = new Date(date);
  if (d < new Date(this.effectiveFrom)) return false;
  if (this.effectiveTo && d >= new Date(this.effectiveTo)) return false;
  return true;
};

/**
 * @typedef JhatkaCommissionRule
 */
const JhatkaCommissionRule = mongoose.model(
  'JhatkaCommissionRule',
  jhatkaCommissionRuleSchema
);

module.exports = JhatkaCommissionRule;