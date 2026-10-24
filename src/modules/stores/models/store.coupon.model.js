/**
 * LocalWala �?" Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * A customer-entered code, distinct from an automatic StorePromotion.
 *
 * The two are separate documents because they answer different questions. A promotion is
 * a commercial decision (percentage off a category, free delivery above a threshold) and
 * may run with no code at all. A coupon is a redeemable voucher: it has a code the
 * customer types, its own redemption ledger and a per-customer limit. Folding coupons into
 * promotions made the order's `promo` snapshot claim a voucher was a promotion, and left
 * `StoreOrder.coupon` permanently empty.
 */
const storeCouponSchema = mongoose.Schema(
  {
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      default: 'percent_off',
      enum: ['percent_off', 'fixed_off', 'free_delivery'],
    },
    value: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxDiscount: {
      type: Number,
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    usageLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    perCustomerLimit: {
      type: Number,
      default: 1,
      min: 0,
    },
    startsAt: {
      type: Date,
      required: true,
    },
    endsAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      default: 'active',
      enum: ['active', 'inactive', 'expired', 'archived'],
    },
    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

storeCouponSchema.plugin(toJSON);
storeCouponSchema.plugin(paginate);

// A code is unique within its chain, not globally: two chains may both run "WELCOME10".
storeCouponSchema.index({ chain: 1, code: 1 }, { unique: true });
storeCouponSchema.index({ outlet: 1, status: 1 });
storeCouponSchema.index({ startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('StoreCoupon', storeCouponSchema);
