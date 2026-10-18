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
const { toJSON, slugGenerator, paginate } = require('./plugins');

const subCategorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Category',
      required: true,
    },
    slug: {
      type: String,
      source: 'name',
      unique: true,
    },
    translations: {
      type: Array,
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
subCategorySchema.plugin(toJSON);
subCategorySchema.plugin(slugGenerator);
subCategorySchema.plugin(paginate);

subCategorySchema.statics.isNameTaken = async function (name, excludeSubCategoryId) {
  const subCategory = await this.findOne({ name, _id: { $ne: excludeSubCategoryId } });
  return !!subCategory;
};

/**
 * @typedef SubCategory
 */
const SubCategory = mongoose.model('SubCategory', subCategorySchema);

module.exports = SubCategory;

