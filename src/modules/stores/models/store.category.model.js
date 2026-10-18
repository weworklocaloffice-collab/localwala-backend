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
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * StoreCategory — Admin-managed, platform-wide. BR-10, BR-26.
 *
 * This is where "20 retail categories, one engine" actually lives. There is no
 * `electronics` module and no `grocery` module: the difference between them is a row
 * in this collection plus the attribute templates its subcategories declare.
 *
 * `key` is stable and is what seeds and imports reference, so it is READ-ONLY on edit
 * and unique. `name` is what a human sees and may be translated.
 *
 * @typedef StoreCategory
 */
const storeCategorySchema = mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9_]+$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    icon: {
      type: String,
      required: false,
    },
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },
    // Optional third level, for a dense taxonomy. null means a flat two-level tree.
    parent: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreCategory',
      required: false,
    },
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

storeCategorySchema.plugin(toJSON);
storeCategorySchema.plugin(paginate);

storeCategorySchema.index({ key: 1 }, { unique: true });
storeCategorySchema.index({ status: 1, sortOrder: 1 });
storeCategorySchema.index({ parent: 1 });

storeCategorySchema.statics.isKeyTaken = async function isKeyTaken(key, excludeId) {
  const found = await this.findOne({ key, _id: { $ne: excludeId } });
  return !!found;
};

const StoreCategory = mongoose.model('StoreCategory', storeCategorySchema);

module.exports = StoreCategory;