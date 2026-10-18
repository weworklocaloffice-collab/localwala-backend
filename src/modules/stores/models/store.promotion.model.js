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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const storePromotionSchema = mongoose.Schema(
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
    name: {
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
      required: true,
      enum: ['percent_off', 'fixed_off', 'min_order_offer', 'free_delivery', 'product_discount'],
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    maxDiscount: {
      type: Number,
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
    },
    applicableProducts: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'ChainProduct',
      },
    ],
    applicableCategories: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreCategory',
      },
    ],
    applicableVariants: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'ChainProductVariant',
      },
    ],
    code: {
      type: String,
      trim: true,
      uppercase: true,
    },
    usageLimit: {
      type: Number,
      default: 0,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    perCustomerLimit: {
      type: Number,
      default: 1,
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
    approvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

storePromotionSchema.plugin(toJSON);
storePromotionSchema.plugin(paginate);

storePromotionSchema.index({ chain: 1, status: 1, isActive: 1 });
storePromotionSchema.index({ outlet: 1, status: 1 });
storePromotionSchema.index({ code: 1 }, { sparse: true });
storePromotionSchema.index({ startsAt: 1, endsAt: 1 });
storePromotionSchema.index({ applicableCategories: 1 });
storePromotionSchema.index({ applicableProducts: 1 });

storePromotionSchema.statics.findActive = async function (chainId) {
  const now = new Date();
  return this.find({
    chain: chainId,
    status: 'active',
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  });
};

storePromotionSchema.statics.findByCode = async function (code) {
  return this.findOne({ code: code.toUpperCase() });
};

module.exports = mongoose.model('StorePromotion', storePromotionSchema);