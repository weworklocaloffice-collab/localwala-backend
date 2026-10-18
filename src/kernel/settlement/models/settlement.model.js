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

const settlementSchema = mongoose.Schema(
  {
    settlementNo: {
      type: Number,
      required: true,
    },
    vertical: {
      type: String,
      required: true,
      enum: ['stores', 'dairy'],
    },
    counterpartyType: {
      type: String,
      required: true,
      enum: ['store_owner', 'commission_partner', 'franchisee'],
    },
    counterparty: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    store: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
    },
    settlementType: {
      type: String,
      required: true,
      enum: ['order_revenue', 'subscription', 'adjustment', 'payout'],
    },
    period: {
      type: String,
      required: true,
      enum: ['daily', 'weekly', 'monthly', 'custom'],
    },
    from: {
      type: Date,
      required: true,
    },
    to: {
      type: Date,
      required: true,
    },
    totals: {
      orderCount: { type: Number, default: 0 },
      grossOrderValue: { type: Number, default: 0 },
      refunds: { type: Number, default: 0 },
      adjustments: { type: Number, default: 0 },
      platformFees: { type: Number, default: 0 },
      deliveryTips: { type: Number, default: 0 },
      netAmount: { type: Number, default: 0 },
    },
    lineItems: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'SettlementItem',
      },
    ],
    payoutMethod: {
      type: String,
      enum: ['bank', 'wallet'],
    },
    payoutDetails: {
      accountName: String,
      accountNumber: String,
      ifsc: String,
      upiId: String,
    },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'processing', 'settled', 'failed', 'reversed', 'disputed'],
    },
    settlementDate: {
      type: Date,
    },
    gatewayReference: {
      type: String,
    },
    failureReason: {
      type: String,
    },
    approvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

settlementSchema.plugin(toJSON);
settlementSchema.plugin(paginate);

settlementSchema.index({ settlementNo: 1 }, { unique: true });
settlementSchema.index({ vertical: 1, counterparty: 1, status: 1 });
settlementSchema.index({ store: 1, status: 1, createdAt: -1 });
settlementSchema.index({ chain: 1, status: 1 });
settlementSchema.index({ status: 1, settlementDate: 1 });
settlementSchema.index({ period: 1, from: 1, to: 1 });

settlementSchema.statics.findPending = async function (vertical) {
  return this.find({ vertical, status: { $in: ['pending', 'processing'] } });
};

settlementSchema.statics.findByCounterparty = async function (counterpartyId, { vertical } = {}) {
  const filter = { counterparty: counterpartyId };
  if (vertical) filter.vertical = vertical;
  return this.find(filter).sort({ createdAt: -1 });
};

settlementSchema.statics.findByStore = async function (storeId) {
  return this.find({ store: storeId }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Settlement', settlementSchema);