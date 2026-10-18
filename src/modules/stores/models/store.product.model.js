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

const storeProductSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      source: 'name',
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreCategory',
      required: true,
    },
    subcategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreSubcategory',
    },
    brand: {
      type: String,
      trim: true,
    },
    defaultGstRate: {
      type: Number,
      min: 0,
      max: 28,
      default: 18,
    },
    attributes: {
      type: Map,
      of: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    variantsEnabled: {
      type: Boolean,
      default: false,
    },
    status: {
      // String lifecycle, per §4.4. Not a boolean: `archived` must be distinguishable
      // from `inactive`, because order lines reference this document forever (BR-25).
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

// add plugins that converts mongoose to json, convert to unique slug and pagination
storeProductSchema.plugin(toJSON);
storeProductSchema.plugin(slugGenerator);
storeProductSchema.plugin(paginate);

storeProductSchema.statics.findByCategory = async function (categoryId) {
  return this.find({ category: categoryId, status: true }).sort({ name: 1 });
};

module.exports = mongoose.model('StoreProduct', storeProductSchema);