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
 * DairyProduct — level 3 of the catalogue: "LocalWala Toned Cow Milk".
 *
 * **ASSUMPTION: Product is per-outlet.** It carries `business`, so each outlet
 * curates its own product list and its own `DairySku` rows with its own price and
 * stock. The taxonomy above it (`DairyCategory` → `DairySubCategory`) is
 * platform-wide and shared.
 *
 * If this turns out to be wrong — platform-wide products with per-outlet
 * *listings* — the change is to drop `business` and introduce a `DairyListing`
 * join holding price/stock. `DairySku` already points at the product, so only the
 * owner of price and stock moves.
 */
const dairyProductSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyCategory',
      required: true,
    },
    subCategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySubCategory',
      required: false,
    },
    /**
     * Lateral filter dimension, NOT a level in the hierarchy. A product has one
     * brand; the catalogue is filtered by brand across any subtree.
     */
    brand: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyBrand',
      required: false,
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
    shortDescription: {
      type: String,
      required: false,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    images: {
      type: Array,
      default: [],
    },
    /**
     * The specification lists `Full Cream` / `Toned` / `Double Toned` and
     * `Cow Milk` / `Buffalo Milk` / `A2 Milk` as flat siblings under Milk, but
     * they are really two independent dimensions. A purchasable item combines
     * them ("Toned Cow Milk"), so they are captured as attributes here rather
     * than forcing a nested taxonomy.
     */
    attributes: {
      fatLevel: {
        type: String,
        required: false,
        trim: true,
        // full_cream, toned, double_toned, skimmed
      },
      milkType: {
        type: String,
        required: false,
        trim: true,
        // cow, buffalo, a2, mixed
      },
      /** e.g. greek, flavoured, probiotic, fresh, hanging_curd */
      variant: {
        type: String,
        required: false,
        trim: true,
      },
    },
    /** Dairy is always veg, but the flag keeps catalogue filters uniform. */
    isVeg: {
      type: Boolean,
      required: false,
      default: true,
    },
    /** Denormalised so a category listing does not need a second lookup. */
    subCategoryName: {
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
dairyProductSchema.plugin(toJSON);
dairyProductSchema.plugin(paginate);
dairyProductSchema.plugin(slugGenerator);
dairyProductSchema.index({ business: 1, category: 1, subCategory: 1, status: 1 });
dairyProductSchema.index({ brand: 1, status: 1 });
// Faceted search by the two independent dimensions.
dairyProductSchema.index({ 'attributes.fatLevel': 1, 'attributes.milkType': 1 });
dairyProductSchema.index({ name: 'text', shortDescription: 'text', description: 'text' });

/**
 * @typedef DairyProduct
 */
const DairyProduct = mongoose.model('DairyProduct', dairyProductSchema);

module.exports = DairyProduct;