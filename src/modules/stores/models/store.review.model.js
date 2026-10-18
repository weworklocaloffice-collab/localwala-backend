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

const storeReviewSchema = mongoose.Schema(
  {
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    title: {
      type: String,
      trim: true,
    },
    comment: {
      type: String,
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: false,
    },
    isHelpful: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected', 'archived'],
    },
    reply: {
      text: String,
      repliedAt: Date,
      repliedBy: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
      },
    },
    reportedCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

storeReviewSchema.plugin(toJSON);
storeReviewSchema.plugin(paginate);

storeReviewSchema.index({ outlet: 1, status: 1, createdAt: -1 });
storeReviewSchema.index({ chain: 1, status: 1, rating: -1 });
storeReviewSchema.index({ customer: 1, createdAt: -1 });
storeReviewSchema.index({ product: 1, status: 1 });
storeReviewSchema.index({ order: 1 }, { sparse: true });

storeReviewSchema.statics.findByOutlet = async function (outletId, { status = 'approved' } = {}) {
  return this.find({ outlet: outletId, status }).sort({ createdAt: -1 });
};

storeReviewSchema.statics.findByProduct = async function (productId) {
  return this.find({ product: productId, status: 'approved' }).sort({ createdAt: -1 });
};

storeReviewSchema.statics.getAverageRating = async function (outletId) {
  const result = await this.aggregate([
    { $match: { outlet: outletId, status: 'approved' } },
    { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  return result.length ? { avgRating: Math.round(result[0].avgRating * 10) / 10, count: result[0].count } : { avgRating: 0, count: 0 };
};

module.exports = mongoose.model('StoreReview', storeReviewSchema);