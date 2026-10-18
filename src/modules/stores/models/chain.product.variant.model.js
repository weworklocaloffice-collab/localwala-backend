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

const chainProductVariantSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
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
    /**
     * Denormalised, indexable form of `attributes`: ["size:M", "color:Black"].
     *
     * `stores.catalog.service.js` generateVariants WRITES this field and looks existing
     * variants up BY it (`{ facetKeys: { $all: [...] } }`) to stay idempotent, and the
     * `{ product, facetKeys }` index below is built on it. The field was missing from the
     * schema, so Mongoose dropped it on every write: the lookup matched nothing, and
     * re-running generation always tried to create duplicates.
     */
    facetKeys: {
      type: [String],
      default: [],
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
    /**
     * Same string lifecycle as its parent `ChainProduct`, for the same reason: a variant
     * can be `inactive` (still sellable once re-enabled) or `archived` (gone from the
     * catalogue, but still referenced by historical order lines). A boolean would make
     * those two indistinguishable.
     */
    status: {
      type: String,
      required: true,
      default: 'active',
      enum: ['active', 'inactive', 'archived'],
    },

    archivedAt: { type: Date },
    archivedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    archivedReason: { type: String },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json and supports pagination
chainProductVariantSchema.plugin(toJSON);
chainProductVariantSchema.plugin(paginate);

chainProductVariantSchema.index({ chain: 1, sku: 1 }, { unique: true });
chainProductVariantSchema.index({ product: 1, facetKeys: 1 });

chainProductVariantSchema.statics.findByProduct = async function (productId) {
  return this.find({ product: productId, status: 'active' }).sort({ name: 1 });
};

module.exports = mongoose.model('ChainProductVariant', chainProductVariantSchema);