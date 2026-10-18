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
const { toJSON, paginate, slugGenerator } = require('../../../models/plugins');

const storeProductVariantSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreProduct',
      required: true,
    },
    sku: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    priceInPaise: {
      type: Number,
      required: true,
    },
    compareAtPrice: {
      type: Number,
      min: 0,
    },
    compareAtPriceInPaise: {
      type: Number,
    },
    costPrice: {
      type: Number,
      min: 0,
    },
    costPriceInPaise: {
      type: Number,
    },
    barcode: {
      type: String,
      trim: true,
    },
    weight: {
      type: Number,
      min: 0,
    },
    weightUnit: {
      type: String,
      enum: ['g', 'kg', 'piece', 'lb', 'oz'],
      default: 'piece',
    },
    attributes: {
      type: Map,
      of: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    stockKept: {
      type: Boolean,
      default: true,
    },
    trackInventory: {
      type: Boolean,
      default: true,
    },
    inventoryQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      min: 0,
      default: 5,
    },
    status: {
      // String lifecycle, per §4.4, matching its parent. See store.product.model.js.
      type: String,
      required: true,
      default: 'active',
      enum: ['active', 'inactive', 'archived'],
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json and supports pagination
storeProductVariantSchema.plugin(toJSON);
storeProductVariantSchema.plugin(paginate);

storeProductVariantSchema.statics.findByProduct = async function (productId) {
  return this.find({ product: productId, status: true }).sort({ name: 1 });
};

module.exports = mongoose.model('StoreProductVariant', storeProductVariantSchema);