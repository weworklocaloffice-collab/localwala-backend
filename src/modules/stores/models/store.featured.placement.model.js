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

const storeFeaturedPlacementSchema = mongoose.Schema(
  {
    subjectType: {
      type: String,
      required: true,
      enum: ['store', 'product', 'banner'],
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
    },
    slot: {
      type: String,
      required: true,
    },
    startsAt: {
      type: Date,
      required: true,
    },
    endsAt: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    invoice: {
      type: String,
    },
    status: {
      type: String,
      default: 'pending_payment',
      enum: ['pending_payment', 'paid', 'approved', 'rejected', 'live', 'expired'],
    },
    approvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

storeFeaturedPlacementSchema.plugin(toJSON);
storeFeaturedPlacementSchema.plugin(paginate);

storeFeaturedPlacementSchema.index({ outlet: 1, status: 1, startsAt: 1 });
storeFeaturedPlacementSchema.index({ chain: 1, status: 1 });
storeFeaturedPlacementSchema.index({ product: 1, status: 1 });
storeFeaturedPlacementSchema.index({ slot: 1, startsAt: 1, endsAt: 1 });

storeFeaturedPlacementSchema.statics.findLive = async function (outletId) {
  const now = new Date();
  return this.find({
    outlet: outletId,
    status: 'live',
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  });
};

storeFeaturedPlacementSchema.statics.findPendingApproval = async function () {
  return this.find({ status: 'paid' }).sort({ createdAt: 1 });
};

module.exports = mongoose.model('StoreFeaturedPlacement', storeFeaturedPlacementSchema);