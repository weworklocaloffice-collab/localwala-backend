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

const storeExchangeItemSchema = new mongoose.Schema(
  {
    _id: false,
    originalProduct: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
      required: true,
    },
    originalVariant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
      required: true,
    },
    originalName: { type: String, required: true },
    originalSku: { type: String },
    exchangeForProduct: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
      required: true,
    },
    exchangeForVariant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
      required: true,
    },
    exchangeForName: { type: String, required: true },
    exchangeForSku: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    priceDifference: { type: Number, default: 0 },
    reason: { type: String, required: true },
    condition: {
      type: String,
      enum: ['unopened', 'opened_unused', 'defective', 'damaged', 'wrong_item', 'other'],
    },
  },
  { _id: false }
);

const storeExchangeRequestSchema = mongoose.Schema(
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
    items: [storeExchangeItemSchema],
    status: {
      type: String,
      default: 'requested',
      enum: ['requested', 'approved', 'rejected', 'picked_up', 'received', 'exchanged', 'cancelled'],
    },
    reason: {
      type: String,
      required: true,
    },
    reasonCategory: {
      type: String,
      enum: ['defective', 'wrong_item', 'damaged_in_delivery', 'not_as_described', 'size_fit', 'changed_mind', 'other'],
    },
    totalPriceDifference: {
      type: Number,
      default: 0,
    },
    paymentRequired: {
      type: Boolean,
      default: false,
    },
    paymentAmount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'not_required'],
      default: 'not_required',
    },
    paymentReference: {
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
    exchangedAt: {
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

storeExchangeRequestSchema.plugin(toJSON);
storeExchangeRequestSchema.plugin(paginate);

storeExchangeRequestSchema.index({ order: 1, status: 1 });
storeExchangeRequestSchema.index({ outlet: 1, status: 1, createdAt: -1 });
storeExchangeRequestSchema.index({ customer: 1, createdAt: -1 });

storeExchangeRequestSchema.statics.findByOrder = async function (orderId) {
  return this.find({ order: orderId }).sort({ createdAt: -1 });
};

storeExchangeRequestSchema.statics.findPending = async function (outletId) {
  return this.find({ outlet: outletId, status: { $in: ['requested', 'approved'] } });
};

module.exports = mongoose.model('StoreExchangeRequest', storeExchangeRequestSchema);