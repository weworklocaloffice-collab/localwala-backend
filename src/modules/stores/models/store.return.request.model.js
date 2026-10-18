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

const storeReturnItemSchema = new mongoose.Schema(
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
    sku: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    refundAmount: { type: Number, required: true },
    taxAmount: { type: Number, default: 0 },
    reason: { type: String, required: true },
    condition: {
      type: String,
      enum: ['unopened', 'opened_unused', 'defective', 'damaged', 'wrong_item', 'other'],
    },
    notes: { type: String },
    images: { type: [String], default: [] },
  },
  { _id: false }
);

const storeReturnRequestSchema = mongoose.Schema(
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
    items: [storeReturnItemSchema],
    status: {
      type: String,
      default: 'requested',
      enum: ['requested', 'approved', 'rejected', 'picked_up', 'received', 'refunded', 'cancelled'],
    },
    reason: {
      type: String,
      required: true,
    },
    reasonCategory: {
      type: String,
      enum: ['defective', 'wrong_item', 'damaged_in_delivery', 'not_as_described', 'changed_mind', 'other'],
    },
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
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    approvedAt: {
      type: Date,
    },
    approvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    pickedUpAt: {
      type: Date,
    },
    receivedAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
    rejectedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
    },
    notes: {
      type: String,
    },
    images: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

storeReturnRequestSchema.plugin(toJSON);
storeReturnRequestSchema.plugin(paginate);

storeReturnRequestSchema.index({ order: 1, status: 1 });
storeReturnRequestSchema.index({ outlet: 1, status: 1, createdAt: -1 });
storeReturnRequestSchema.index({ customer: 1, createdAt: -1 });

storeReturnRequestSchema.statics.findByOrder = async function (orderId) {
  return this.find({ order: orderId }).sort({ createdAt: -1 });
};

storeReturnRequestSchema.statics.findPending = async function (outletId) {
  return this.find({ outlet: outletId, status: { $in: ['requested', 'approved'] } });
};

module.exports = mongoose.model('StoreReturnRequest', storeReturnRequestSchema);