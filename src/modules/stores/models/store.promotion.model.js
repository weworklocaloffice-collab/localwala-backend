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
    stackable: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 0,
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
    // New promotions start as drafts until Admin approval. The legacy values stay in
    // the enum so already-shipped promotions are not invalidated by this lifecycle.
    status: {
      type: String,
      default: 'draft',
      enum: ['draft', 'scheduled', 'live', 'paused', 'expired', 'active', 'inactive', 'archived'],
    },
    // Admin moderation. Without this path in the schema, Mongoose strict silently dropped
    // `approval` written by `moderatePromotion`, so the admin screen re-opened every row
    // as unmoderated even after an approve/reject.
    approval: {
      status: {
        type: String,
        default: 'not_required',
        enum: ['not_required', 'pending', 'approved', 'rejected'],
      },
      by: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
      },
      at: Date,
      note: String,
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

storePromotionSchema.statics.redeemableFilter = function (now = new Date()) {
  return {
    status: { $in: ['active', 'live'] },
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    $and: [
      {
        $or: [
          { 'approval.status': { $in: ['approved', 'not_required'] } },
          { 'approval.status': { $exists: false } },
          { approval: { $exists: false } },
        ],
      },
    ],
  };
};

storePromotionSchema.statics.findActive = async function (chainId) {
  return this.find({
    chain: chainId,
    ...this.redeemableFilter(),
  });
};

storePromotionSchema.statics.findByCode = async function (code) {
  return this.findOne({ code: code.toUpperCase() });
};

module.exports = mongoose.model('StorePromotion', storePromotionSchema);