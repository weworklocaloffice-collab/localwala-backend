/*
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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');

/**
 * RealEstateCommissionRule — versioned rate data, never a payout.
 *
 * The payout is `RealEstateCommission`, which freezes a snapshot of
 * the rule in force at resolution time (BR-15). A 2026 sale at 2%
 * still reads 2% after admin sets 1.5% — because the sale never reads
 * this table at read time.
 *
 * ## One active rule per type per slab per moment (F-8)
 *
 * Enforced by the partial unique index on
 * `(type, slabFrom, effectiveFrom)` where `status: 'ACTIVE'`, plus
 * service-level overlap validation on retire (F-9).
 *
 * ## Rate convention (plan §4.4)
 *
 * `rate` is percentage POINTS: 2.0 means 2%. Never store 0.02 and
 * call it 2 — that is how a rate becomes 200%.
 *
 * Seeded slabs (plan §5.9, data not code):
 * `0 – 99,99,999 → 2.0%`, `1,00,00,000+ → 1.0%` on SALE_VALUE.
 */

const realEstateCommissionRuleSchema = mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'PROPERTY_SALE',
        'BANK_LOAN',
        'CUSTOMER_REFERRAL',
        'EXECUTIVE',
        'HOLD_FEE',
        'LISTING_PACKAGE',
        'PROMOTION',
      ],
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    /** Percentage points, e.g. 2.0 for 2%. */
    rate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    calculationBasis: {
      type: String,
      required: true,
      enum: [
        'SALE_VALUE',
        'LOCALWALA_COMMISSION',
        'LOAN_DISBURSED',
        'SANCTION_AMOUNT',
        'FIXED_AMOUNT',
        'HOLD_PRINCIPAL',
        'FLAT',
      ],
    },

    minAmount: moneyField(0),
    maxAmount: moneyField(0),

    /** Inclusive lower slab bound (paise inside), e.g. 0. */
    slabFrom: moneyField(0),

    /** Exclusive upper slab bound; null = infinity. */
    slabTo: moneyField(0),

    effectiveFrom: {
      type: Date,
      required: true,
    },

    /** Null = open-ended. */
    effectiveTo: {
      type: Date,
      required: false,
    },

    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },

    status: {
      type: String,
      required: true,
      default: 'DRAFT',
      enum: ['DRAFT', 'ACTIVE', 'RETIRED'],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateCommissionRuleSchema.plugin(toJSON);
realEstateCommissionRuleSchema.plugin(paginate);

// F-8: at most ONE active rule per type per slab per moment.
realEstateCommissionRuleSchema.index(
  { type: 1, slabFrom: 1, effectiveFrom: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'one_active_rule_per_slab' }
);
realEstateCommissionRuleSchema.index({ type: 1, status: 1, effectiveFrom: -1 });
realEstateCommissionRuleSchema.index({ status: 1, effectiveFrom: 1 });

/* istanbul ignore next */
async function retireRule(ruleId) {
  const rule = await this.findById(ruleId);
  if (!rule) {
    throw new Error('Rule not found');
  }

  if (rule.status !== 'ACTIVE') {
    throw new Error('Only ACTIVE rules can be retired');
  }

  // Check for overlapping ACTIVE rules
  const overlapping = await this.findOne({
    type: rule.type,
    status: 'ACTIVE',
    _id: { $ne: ruleId },
    $or: [
      {
        effectiveFrom: {
          $gte: rule.effectiveFrom,
          $lte: rule.effectiveTo,
        },
      },
      {
        effectiveTo: {
          $gte: rule.effectiveFrom,
          $lte: rule.effectiveTo,
        },
      },
      {
        effectiveFrom: { $lte: rule.effectiveFrom },
        effectiveTo: { $gte: rule.effectiveTo },
      },
    ],
  });

  if (overlapping) {
    throw new Error(
      `Cannot retire rule: overlapping ACTIVE rule exists (ruleId: ${overlapping._id})`
    );
  }

  rule.status = 'RETIRED';
  await rule.save();
  return rule;
}

/* istanbul ignore next */
module.exports.retireRule = retireRule;

/**
 * @typedef RealEstateCommissionRule
 */
const RealEstateCommissionRule = mongoose.model('RealEstateCommissionRule', realEstateCommissionRuleSchema);

/* istanbul ignore next */
module.exports = RealEstateCommissionRule;