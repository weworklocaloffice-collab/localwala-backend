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

const storeCancellationAttemptSchema = mongoose.Schema(
  {
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
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
    reason: {
      type: String,
      required: true,
    },
    reasonCategory: {
      type: String,
      required: true,
      enum: ['customer_request', 'out_of_stock', 'store_closed', 'payment_failed', 'delivery_unavailable', 'other'],
    },
    requestedBy: {
      type: String,
      required: true,
      enum: ['customer', 'store', 'admin', 'system'],
    },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected', 'expired'],
    },
    attemptedAt: {
      type: Date,
      default: Date.now,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    resolution: {
      type: String,
      enum: ['approved', 'rejected', 'expired'],
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

storeCancellationAttemptSchema.plugin(toJSON);
storeCancellationAttemptSchema.plugin(paginate);

storeCancellationAttemptSchema.index({ order: 1, status: 1 });
storeCancellationAttemptSchema.index({ outlet: 1, status: 1, attemptedAt: -1 });
storeCancellationAttemptSchema.index({ customer: 1, attemptedAt: -1 });

storeCancellationAttemptSchema.statics.findPending = async function (orderId) {
  return this.find({ order: orderId, status: 'pending' });
};

storeCancellationAttemptSchema.statics.findByOrder = async function (orderId) {
  return this.find({ order: orderId }).sort({ attemptedAt: -1 });
};

module.exports = mongoose.model('StoreCancellationAttempt', storeCancellationAttemptSchema);