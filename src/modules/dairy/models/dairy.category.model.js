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
 * DairyCategory — level 1 of the catalogue.
 *
 * The ten top-level dairy categories are fixed by the specification:
 * Milk, Curd & Yogurt, Buttermilk & Lassi, Ghee, Butter, Paneer & Fresh Dairy,
 * Cheese, Cream, Dairy Drinks, Traditional Dairy.
 *
 * Taxonomies are seeded by an operator later; this slice only provides the
 * schema and the CRUD surface.
 */
const dairyCategorySchema = mongoose.Schema(
  {
    /** Stable machine key. Never shown to customers. */
    key: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      // milk, curd_yogurt, buttermilk_lassi, ghee, butter,
      // paneer_fresh_dairy, cheese, cream, dairy_drinks, traditional_dairy
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
    icon: {
      type: String,
      required: false,
    },
    /**
     * Curated for the customer home screen.
     */
    featured: {
      type: Boolean,
      required: false,
      default: false,
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
dairyCategorySchema.plugin(toJSON);
dairyCategorySchema.plugin(paginate);
dairyCategorySchema.plugin(slugGenerator);
// `unique: true` is declared on the field above; repeating it here makes Mongoose
// warn about a duplicate index on every boot.
dairyCategorySchema.index({ status: 1, sortOrder: 1 });

/**
 * @typedef DairyCategory
 */
const DairyCategory = mongoose.model('DairyCategory', dairyCategorySchema);

module.exports = DairyCategory;