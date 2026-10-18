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
const { toJSON, paginate, slugGenerator } = require('../../../models/plugins');

/**
 * DairySubCategory — level 2 of the catalogue.
 *
 * Modelled flat per the specification, which lists variants such as
 * "Full Cream", "Toned", "Double Toned", "Cow Milk", "Buffalo Milk" and "A2 Milk"
 * as siblings under Milk.
 *
 * Note on a real modelling wrinkle: those are two independent dimensions —
 * fat level (full cream / toned / double toned) and milk type (cow / buffalo /
 * A2). A purchasable item like "Toned Cow Milk" combines both. This schema keeps
 * them flat as specified; `DairyProduct` names carry the combination
 * ("LocalWala Toned Cow Milk"). If the catalogue later needs faceted filtering
 * across both dimensions, these become two attribute sets on `DairyProduct`
 * rather than nested sub-categories.
 */
const dairySubCategorySchema = mongoose.Schema(
  {
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyCategory',
      required: true,
    },
    key: {
      type: String,
      required: false,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    image: {
      type: String,
      required: false,
    },
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
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

// add plugin that converts mongoose to json & convert to unique slug
dairySubCategorySchema.plugin(toJSON);
dairySubCategorySchema.plugin(paginate);
dairySubCategorySchema.plugin(slugGenerator);
dairySubCategorySchema.index({ category: 1, status: 1, sortOrder: 1 });

/**
 * @typedef DairySubCategory
 */
const DairySubCategory = mongoose.model('DairySubCategory', dairySubCategorySchema);

module.exports = DairySubCategory;