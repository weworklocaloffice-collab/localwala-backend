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

const storeSubscriptionPaymentSchema = mongoose.Schema(
  {
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreSubscription',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    attemptNo: {
      type: Number,
      required: true,
      min: 1,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'success', 'failed'],
    },
    paymentMethod: {
      type: String,
      enum: ['card', 'upi', 'netbanking', 'wallet'],
    },
    gatewayReference: {
      type: String,
    },
    gatewayResponse: {
      type: Map,
      of: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    failureCode: {
      type: String,
    },
    failureReason: {
      type: String,
    },
    retryOf: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreSubscriptionPayment',
    },
    paidAt: {
      type: Date,
    },
    failedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

storeSubscriptionPaymentSchema.plugin(toJSON);
storeSubscriptionPaymentSchema.plugin(paginate);

storeSubscriptionPaymentSchema.index({ subscription: 1, attemptNo: 1 }, { unique: true });
storeSubscriptionPaymentSchema.index({ chain: 1, createdAt: -1 });
storeSubscriptionPaymentSchema.index({ status: 1, createdAt: -1 });

storeSubscriptionPaymentSchema.statics.findBySubscription = async function (subscriptionId) {
  return this.find({ subscription: subscriptionId }).sort({ attemptNo: -1 });
};

storeSubscriptionPaymentSchema.statics.findPending = async function () {
  return this.find({ status: 'pending' });
};

module.exports = mongoose.model('StoreSubscriptionPayment', storeSubscriptionPaymentSchema);