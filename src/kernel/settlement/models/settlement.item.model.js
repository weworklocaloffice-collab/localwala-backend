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

const settlementItemSchema = mongoose.Schema(
  {
    settlement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Settlement',
      required: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
    },
    orderNo: {
      type: Number,
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    adjustmentAmount: {
      type: Number,
      default: 0,
    },
    platformFee: {
      type: Number,
      default: 0,
    },
    deliveryTip: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
      required: true,
    },
    customerVisibleTotal: {
      type: Number,
      required: true,
    },
    taxTotal: {
      type: Number,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    packagingFee: {
      type: Number,
      default: 0,
    },
    serviceFee: {
      type: Number,
      default: 0,
    },
    discountTotal: {
      type: Number,
      default: 0,
    },
    codAmount: {
      type: Number,
      default: 0,
    },
    itemCount: {
      type: Number,
      default: 0,
    },
    quantity: {
      type: Number,
      default: 0,
    },
    categorySnapshot: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreCategory',
      },
    ],
  },
  {
    timestamps: true,
  }
);

settlementItemSchema.plugin(toJSON);
settlementItemSchema.plugin(paginate);

settlementItemSchema.index({ settlement: 1 });
settlementItemSchema.index({ order: 1 });
settlementItemSchema.index({ outlet: 1, createdAt: -1 });
settlementItemSchema.index({ chain: 1, createdAt: -1 });

settlementItemSchema.statics.findBySettlement = async function (settlementId) {
  return this.find({ settlement: settlementId }).sort({ createdAt: 1 });
};

settlementItemSchema.statics.findByOrder = async function (orderId) {
  return this.findOne({ order: orderId });
};

module.exports = mongoose.model('SettlementItem', settlementItemSchema);