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

/**
 * JhatkaPromotion — a discount. §42's `Promotions`.
 *
 * ## Not copied from `StorePromotion`, and the difference is deliberate
 *
 * A grocery promotion is a percentage off a basket. A Jhatka promotion has to deal
 * with two things a grocery one does not:
 *
 *   1. **Variable weight.** "10% off chicken" on a weighed line is 10% off an
 *      ESTIMATE, and the weight can land anywhere. §3 means the customer's charge
 *      never rises, so a percentage discount on the estimate is a fixed discount
 *      even if the meat came out heavier — which is the correct behaviour, but only
 *      if the discount is computed from `estimatedAmount` and frozen, not
 *      recalculated from `finalAmount` at the door.
 *
 *   2. **Free delivery on a subscription is not a discount, it is a margin
 *      decision** on a line that recurs. The subscription's `chargeMode: 'ceiling'`
 *      already over-charges by up to 10% (BR-16); stacking a free-delivery
 *      concession on top needs to be visible in the same place.
 *
 * `discountBasis` therefore names which figure the discount is taken from, and
 * `appliesToMeasurementMode` lets a promotion target COUNT items without touching
 * WEIGHT ones.
 */
const PROMOTION_TYPES = [
  'percent_off',
  'fixed_off',
  'free_delivery',
  'free_packaging',
  'bundle',
  'first_order',
  'subscription_discount',
];

const DISCOUNT_BASES = [
  'estimated_line_total',
  'order_estimated_total',
  'delivery_fee',
  'packaging_fee',
];

const jhatkaPromotionSchema = mongoose.Schema(
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
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: false,
      default: undefined,
    },
    /** Null = platform-wide. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: false,
      default: undefined,
    },
    type: {
      type: String,
      required: true,
      enum: PROMOTION_TYPES,
    },
    /**
     * WHICH figure the discount is taken from. Named explicitly because on a
     * variable-weight line the two candidates differ by up to 10% and the
     * difference is real money.
     */
    discountBasis: {
      type: String,
      required: false,
      enum: DISCOUNT_BASES,
      default: 'estimated_line_total',
    },
    discountPercent: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
    },
    discountAmount: moneyField(0),
    /**
     * A percentage discount on a variable-weight line still needs a cap.
     *
     * Uncapped, "50% off" on a 3 kg line is a large fixed discount applied to an
     * estimate the meat may not reach — the platform carries the difference. Frozen
     * at application time, and capped so a promotion cannot exceed the estimate.
     */
    maxDiscountAmount: moneyField(0),
    minOrderAmount: moneyField(0),
    /**
     * Restrict to WEIGHT items, COUNT items, both, or neither of concern.
     *
     * `subscription_discount` on a COUNT line is meaningless when there is no
     * ceiling involved, and a `free_delivery` promotion that silently applies to a
     * weight line changes what the customer quoted.
     */
    appliesToMeasurementMode: {
      type: String,
      required: false,
      enum: ['WEIGHT', 'COUNT', 'any'],
      default: 'any',
    },
    categories: {
      type: [String],
      required: false,
      default: [],
    },
    products: [
      {
        _id: false,
        product: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaProduct',
          required: true,
        },
        variant: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaVariant',
          required: false,
          default: undefined,
        },
      },
    ],
    /**
     * For `bundle` and `first_order`: what has to be in the cart, and what is
     * discounted.
     */
    buyItems: [
      {
        _id: false,
        product: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaProduct',
          required: true,
        },
        variant: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaVariant',
          required: false,
          default: undefined,
        },
        minQuantity: { type: Number, required: false, min: 1 },
      },
    ],
    /** Discounted to zero rather than removed from the cart. */
    freeItems: [
      {
        _id: false,
        product: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaProduct',
          required: true,
        },
        variant: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaVariant',
          required: true,
        },
        maxQuantity: { type: Number, required: false, min: 1, default: 1 },
      },
    ],
    usageLimit: { type: Number, required: false, min: 0 },
    /** NULL means unlimited. Zero means none — the distinction matters. */
    usageLimitPerCustomer: {
      type: Number,
      required: false,
      min: 0,
      default: null,
    },
    usageCount: { type: Number, required: false, default: 0, min: 0 },
    startAt: { type: Date, required: true },
    endAt: {
      type: Date,
      required: true,
      validate: {
        validator: function (v) {
          return !this.startAt || v > this.startAt;
        },
        message: 'endAt must be after startAt',
      },
    },
    /**
     * Stackable with another promotion. Off by default: two percentage discounts
     * on one order is how a margin disappears without anyone deciding it should.
     */
    stackable: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * Whether this may apply to a subscription occurrence.
     *
     * Off by default. BR-16 means a subscription already over-charges by up to 10%
     * via the ceiling, and a further recurring discount compounds it invisibly.
     */
    appliesToSubscriptions: {
      type: Boolean,
      required: false,
      default: false,
    },
    status: {
      type: String,
      required: false,
      enum: ['draft', 'active', 'paused', 'expired', 'archived'],
      default: 'draft',
    },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
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
jhatkaPromotionSchema.plugin(toJSON);
jhatkaPromotionSchema.plugin(paginate);
jhatkaPromotionSchema.index({ code: 1 }, { unique: true });
// The checkout's promotion lookup: active, in-window, for this outlet or global.
jhatkaPromotionSchema.index({ status: 1, startAt: 1, endAt: 1 });
jhatkaPromotionSchema.index({ outlet: 1, status: 1 });
// The expiry sweep.
jhatkaPromotionSchema.index({ status: 1, endAt: 1 });

jhatkaPromotionSchema.statics.TYPES = PROMOTION_TYPES;
jhatkaPromotionSchema.statics.DISCOUNT_BASES = DISCOUNT_BASES;

/**
 * Is this promotion live right now?
 *
 * `status` and the date window are checked separately, because the expiry sweep
 * retires rows on a schedule and a promotion can be inside its window while already
 * `expired` in the collection.
 */
jhatkaPromotionSchema.methods.isLive = function (now = new Date()) {
  if (this.status !== 'active') return false;
  const d = new Date(now);
  return d >= new Date(this.startAt) && d < new Date(this.endAt);
};

/**
 * Is this promotion still usable by a given customer?
 *
 * `usageLimitPerCustomer === null` means UNLIMITED. That is distinct from `0`,
 * which means none — and conflating them would either let a promotion be reused
 * forever or reject a customer's first use entirely.
 *
 * @param {number} customerUsageCount how many times this customer has already used it
 * @returns {boolean}
 */
jhatkaPromotionSchema.methods.canBeUsedBy = function (customerUsageCount) {
  const used = Number(customerUsageCount) || 0;
  if (this.usageLimit !== undefined && this.usageLimit !== null && this.usageCount >= this.usageLimit) {
    return false;
  }
  if (this.usageLimitPerCustomer === null || this.usageLimitPerCustomer === undefined) return true;
  return used < this.usageLimitPerCustomer;
};

/**
 * @typedef JhatkaPromotion
 */
const JhatkaPromotion = mongoose.model('JhatkaPromotion', jhatkaPromotionSchema);

module.exports = JhatkaPromotion;