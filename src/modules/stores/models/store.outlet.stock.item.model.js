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

const storeOutletStockItemSchema = mongoose.Schema(
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
    outletProduct: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutletProduct',
    },
    onHand: {
      type: Number,
      default: 0,
      min: 0,
    },
    reserved: {
      type: Number,
      default: 0,
      min: 0,
    },
    damaged: {
      type: Number,
      default: 0,
      min: 0,
    },
    incoming: {
      type: Number,
      default: 0,
      min: 0,
    },
    availableQty: {
      type: Number,
      default: 0,
    },
    reorderLevel: {
      type: Number,
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      default: 0,
    },
    allowNegativeStock: {
      type: Boolean,
      default: false,
    },
    shelfLocation: {
      type: String,
    },
    expiryTracked: {
      type: Boolean,
      default: false,
    },
    expiryDate: {
      type: Date,
    },
    batchNo: {
      type: String,
    },
    lastCountedAt: {
      type: Date,
    },
    movementSeq: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

storeOutletStockItemSchema.plugin(toJSON);
storeOutletStockItemSchema.plugin(paginate);

storeOutletStockItemSchema.index({ outlet: 1, variant: 1 }, { unique: true });
storeOutletStockItemSchema.index({ outlet: 1, availableQty: 1 });
storeOutletStockItemSchema.index({ outlet: 1, product: 1 });
storeOutletStockItemSchema.index({ outlet: 1, expiryDate: 1 }, { sparse: true });

storeOutletStockItemSchema.statics.findByOutlet = async function (outletId) {
  return this.find({ outlet: outletId }).sort({ product: 1, variant: 1 });
};

storeOutletStockItemSchema.statics.findLowStock = async function (outletId) {
  return this.find({
    outlet: outletId,
    $expr: { $lte: ['$availableQty', '$lowStockThreshold'] },
  });
};

module.exports = mongoose.model('StoreOutletStockItem', storeOutletStockItemSchema);