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

const storeInventoryMovementSchema = mongoose.Schema(
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
    type: {
      type: String,
      required: true,
      enum: ['STOCK_ADDED', 'STOCK_REMOVED', 'ADJUSTMENT', 'RESERVED', 'RELEASED', 'SOLD', 'RETURNED', 'DAMAGED', 'EXPIRED'],
    },
    qtyDelta: {
      type: Number,
      default: 0,
    },
    reservedDelta: {
      type: Number,
      default: 0,
    },
    damagedDelta: {
      type: Number,
      default: 0,
    },
    onHandAfter: {
      type: Number,
      required: true,
    },
    reservedAfter: {
      type: Number,
      required: true,
    },
    damagedAfter: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
    },
    referenceType: {
      type: String,
      enum: ['order', 'return', 'adjustment', 'reservation', 'release', 'expiry', 'manual'],
    },
    referenceId: {
      type: mongoose.SchemaTypes.ObjectId,
    },
    movementSeq: {
      type: Number,
      required: true,
    },
    performedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    performedByName: {
      type: String,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

storeInventoryMovementSchema.plugin(toJSON);
storeInventoryMovementSchema.plugin(paginate);

storeInventoryMovementSchema.index({ outlet: 1, variant: 1, createdAt: -1 });
storeInventoryMovementSchema.index({ outlet: 1, type: 1, createdAt: -1 });
storeInventoryMovementSchema.index({ referenceType: 1, referenceId: 1 }, { sparse: true });

storeInventoryMovementSchema.statics.findByOutlet = async function (outletId, { limit = 50 } = {}) {
  return this.find({ outlet: outletId }).sort({ createdAt: -1 }).limit(limit);
};

storeInventoryMovementSchema.statics.findByVariant = async function (outletId, variantId) {
  return this.find({ outlet: outletId, variant: variantId }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('StoreInventoryMovement', storeInventoryMovementSchema);