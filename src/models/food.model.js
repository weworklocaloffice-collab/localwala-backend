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
const { toJSON, paginate } = require('./plugins');

const foodSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    shortDescription: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    ownCategory: {
      type: Boolean,
      default: false,
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Category',
      required: false,
    },
    subCategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SubCategory',
      required: false,
    },
    customCategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'VendorCategory',
      required: false,
    },
    customSubCategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'VendorSubCategory',
      required: false,
    },
    foodType: {
      type: String,
      default: 'none', // none // veg // nonveg // vegans
      required: false,
    },
    addons: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Addons',
        required: false,
      },
    ],
    startTime: {
      type: String,
      required: false,
    },
    endTime: {
      type: String,
      required: false,
    },
    price: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    discountType: {
      type: String,
      default: '%', // per = % // $ = amount
    },
    discount: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    purchaseLimit: {
      type: Number,
      default: -1, // -1 means unlimited
    },
    variations: {
      type: Array,
      default: [],
    },
    tags: {
      type: Array,
      default: [],
    },
    translations: {
      type: Array,
      default: [],
    },
    recommended: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
    },
    inStock: {
      type: Boolean,
      default: true,
    },
    stockType: {
      type: String,
      default: 'unlimited', // unlimited, limited, daily
    },
    stockNumber: {
      type: Number,
      default: -1,
    },
    taxationEnable: {
      type: Boolean,
      default: false,
    },
    foodTax: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'FoodTaxation',
        required: false,
      },
    ],
    orderSoldCount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    totalSoldAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    discountAmountGiven: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    status: {
      type: String,
      default: 'hold', // hold,live,photoreject,qualityreject,sizereject,reject,hide
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
foodSchema.plugin(toJSON);
foodSchema.plugin(paginate);

/**
 * @typedef Food
 */
const Food = mongoose.model('Food', foodSchema);

module.exports = Food;

