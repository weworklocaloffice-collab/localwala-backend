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

const storeCancellationSchema = mongoose.Schema(
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
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
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
    cancelledBy: {
      type: String,
      required: true,
      enum: ['customer', 'store', 'admin', 'system'],
    },
    cancelledByUserId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    items: [
      {
        _id: false,
        product: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'ChainProduct',
          required: true,
        },
        variant: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'ChainProductVariant',
          required: true,
        },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
        refundAmount: { type: Number, required: true },
        taxAmount: { type: Number, default: 0 },
      },
    ],
    totalRefundAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    refundMethod: {
      type: String,
      enum: ['original_payment', 'wallet', 'bank_transfer'],
    },
    refundReference: {
      type: String,
    },
    refundedAt: {
      type: Date,
    },
    status: {
      type: String,
      default: 'cancelled',
      enum: ['cancelled', 'partially_cancelled', 'refund_pending', 'refunded'],
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

storeCancellationSchema.plugin(toJSON);
storeCancellationSchema.plugin(paginate);

storeCancellationSchema.index({ order: 1 });
storeCancellationSchema.index({ outlet: 1, status: 1, createdAt: -1 });
storeCancellationSchema.index({ customer: 1, createdAt: -1 });

storeCancellationSchema.statics.findByOrder = async function (orderId) {
  return this.find({ order: orderId }).sort({ createdAt: -1 });
};

storeCancellationSchema.statics.findPendingRefund = async function (outletId) {
  return this.find({ outlet: outletId, status: { $in: ['cancelled', 'partially_cancelled'] } });
};

module.exports = mongoose.model('StoreCancellation', storeCancellationSchema);