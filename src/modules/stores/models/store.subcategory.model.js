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
 * StoreSubcategory — the level that actually configures a product (spec §4.1).
 *
 * A subcategory is where the interesting per-category settings live, because that is
 * the granularity that differs in practice. `categoryDefaults` is the whole reason
 * twenty categories need no code:
 *
 *   Clothing   -> exchangeable: true,  brandRequired: true
 *   Grocery    -> exchangeable: false, brandRequired: false, expiryTracked: true
 *   Electronics-> warrantyRequired: true, serialRequired: true
 *   Pharmacy   -> prescriptionRequired: true
 *
 * A subcategory can override any of it, and a product can override the subcategory.
 * Resolution order at runtime is product, then subcategory, then category, then chain,
 * then platform.
 *
 * @typedef StoreSubcategory
 */
const storeSubcategorySchema = mongoose.Schema(
  {
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreCategory',
      required: true,
    },
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
    slug: {
      type: 'String',
      source: 'name',
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

    // Which attribute templates the product form is generated from
    attributeTemplates: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreAttributeTemplate',
        required: false,
      },
    ],

    /**
     * The per-category configuration that replaces twenty backend modules.
     * Every field is optional: absent means "inherit from the category, then the chain,
     * then the platform default".
     */
    categoryDefaults: {
      // does this category sell brands, and must one be chosen?
      brandRequired: {
        type: Boolean,
        required: false,
      },
      // is a variant generated, or does a product have exactly one SKU?
      hasVariants: {
        type: Boolean,
        required: false,
      },
      // policy defaults, which StorePolicy may still tighten
      returnWindowDays: {
        type: Number,
        required: false,
        min: 0,
        max: 365,
      },
      exchangeable: {
        type: Boolean,
        required: false,
      },
      warrantyRequired: {
        type: Boolean,
        required: false,
      },
      // does a product in this category need an HSN code?
      // `stores.catalog.service.js` getProductForm already reads
      // `categoryDefaults.hsnRequired`; without this field Mongoose dropped it on write
      // and every product form reported `hsnRequired: false`, so HSN was never enforced.
      hsnRequired: {
        type: Boolean,
        required: false,
      },
      // inventory behaviour
      expiryTracked: {
        type: Boolean,
        required: false,
      },
      shelfLifeDays: {
        type: Number,
        required: false,
        min: 0,
      },
      batchTracked: {
        type: Boolean,
        required: false,
      },
      serialRequired: {
        type: Boolean,
        required: false,
      },
      // category-specific gates
      prescriptionRequired: {
        type: Boolean,
        required: false,
      },
      vehicleFitmentRequired: {
        type: Boolean,
        required: false,
      },
      // merchandising
      organicEligible: {
        type: Boolean,
        required: false,
      },
      gstDefaultRate: {
        type: Number,
        required: false,
        min: 0,
        max: 100,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

storeSubcategorySchema.plugin(toJSON);
storeSubcategorySchema.plugin(paginate);
storeSubcategorySchema.plugin(slugGenerator);

storeSubcategorySchema.index({ key: 1 }, { unique: true });
storeSubcategorySchema.index({ category: 1, status: 1, sortOrder: 1 });

const StoreSubcategory = mongoose.model('StoreSubcategory', storeSubcategorySchema);

module.exports = StoreSubcategory;