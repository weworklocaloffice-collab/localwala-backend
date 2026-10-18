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

const storeStockReservationSchema = mongoose.Schema(
  {
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
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
      required: true,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
      required: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    status: {
      type: String,
      default: 'held',
      enum: ['held', 'committed', 'released', 'expired'],
    },
    heldAt: {
      type: Date,
      default: Date.now,
    },
    committedAt: {
      type: Date,
    },
    releasedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
    },
    releasedReason: {
      type: String,
      enum: ['order_cancelled', 'order_completed', 'expired', 'manual'],
    },
  },
  {
    timestamps: true,
  }
);

storeStockReservationSchema.plugin(toJSON);
storeStockReservationSchema.plugin(paginate);

storeStockReservationSchema.index({ order: 1, variant: 1 }, { unique: true });
storeStockReservationSchema.index({ outlet: 1, status: 1, expiresAt: 1 });
storeStockReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

storeStockReservationSchema.statics.findHeldByOrder = async function (orderId) {
  return this.find({ order: orderId, status: 'held' });
};

storeStockReservationSchema.statics.findExpired = async function () {
  return this.find({
    status: 'held',
    expiresAt: { $lte: new Date() },
  });
};

module.exports = mongoose.model('StoreStockReservation', storeStockReservationSchema);