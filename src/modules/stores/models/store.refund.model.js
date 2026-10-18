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

const storeRefundSchema = mongoose.Schema(
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
    componentKey: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      required: true,
      enum: ['store_rejected', 'product_unavailable', 'customer_cancellation', 'wrong_item', 'damaged_item', 'return_approved', 'partial_fulfilment', 'payment_issue', 'delivery_failed', 'other'],
    },
    fundingSource: {
      type: String,
      required: true,
      enum: ['connected_account', 'negative_balance', 'cash_payout', 'store_credit'],
    },
    settlementDebit: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Settlement',
    },
    gatewayRefundId: {
      type: String,
    },
    status: {
      type: String,
      default: 'REFUND_PENDING',
      enum: ['REFUND_PENDING', 'PROCESSING', 'REFUNDED', 'FAILED', 'REVERSED'],
    },
    timeline: [{
      _id: false,
      status: { type: String, required: true },
      at: { type: Date, default: Date.now },
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
      note: String,
    }],
    failureReason: {
      type: String,
    },
    reversedAt: {
      type: Date,
    },
    reversedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

storeRefundSchema.plugin(toJSON);
storeRefundSchema.plugin(paginate);

storeRefundSchema.index({ order: 1, componentKey: 1 }, { unique: true });
storeRefundSchema.index({ outlet: 1, status: 1, createdAt: -1 });
storeRefundSchema.index({ customer: 1, createdAt: -1 });

storeRefundSchema.statics.findByOrder = async function (orderId) {
  return this.find({ order: orderId }).sort({ createdAt: 1 });
};

storeRefundSchema.statics.findFailed = async function (outletId) {
  return this.find({ outlet: outletId, status: 'FAILED' });
};

storeRefundSchema.statics.assertRefundCeiling = async function (orderId, newAmount) {
  const order = await mongoose.model('StoreOrder').findById(orderId);
  if (!order) throw new Error('Order not found');
  const existing = await this.aggregate([
    { $match: { order: order._id, status: { $ne: 'REVERSED' } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const totalRefunded = existing.length ? existing[0].total : 0;
  if (totalRefunded + newAmount > order.grandTotal) {
    throw new Error(`REFUND_CEILING_EXCEEDED: total refunds would exceed grandTotal`);
  }
};

module.exports = mongoose.model('StoreRefund', storeRefundSchema);