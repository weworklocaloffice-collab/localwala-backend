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
 * DairySku — a product at a specific pack size. The inventory-bearing entity.
 *
 * The catalog is four levels per the dairy specification:
 *
 *   Category → SubCategory → Product → Pack Size
 *
 * `DairySku` is the fourth level, so "LocalWala Cow Milk" (the Product) has one
 * SKU per pack size — 500 ml, 1 Litre — each with its own price, tax, stock and
 * shelf life. Category/SubCategory/Product/Brand links are added in the catalog
 * slice; the fields that rotation depends on live here from day one.
 *
 * The `reusableContainer` flag is the **scope gate for rotation**. Two-bottle
 * rotation applies only where this is true:
 *
 *   true   → Milk. Customer holds a dedicated can, next delivery collects it
 *            and hands over the sibling. See `DairyContainerAssignment`.
 *   false  → Curd, ghee, butter, paneer, cheese, cream, dairy drinks. Normal
 *            packaged goods: one-time orders need no container, and a
 *            subscription needs no rotation.
 */
const dairySkuSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /** Assigned when the catalog slice links the SKU into the category tree. */
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyCategory',
      required: false,
    },
    subCategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySubCategory',
      required: false,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyProduct',
      required: false,
    },
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
    /**
     * The fourth catalog level. "1 Litre", "500 g", "200 g" and so on.
     */
    packSize: {
      value: {
        type: String,
        required: false,
        trim: true,
      },
      unit: {
        type: String,
        required: false,
        default: 'litre', // litre, ml, g, kg, ml, piece
      },
      quantity: {
        type: Number,
        required: false,
        default: 0,
      },
    },
    /**
     * THE ROTATION SCOPE GATE. See the file header.
     */
    reusableContainer: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * Cans a customer needs for this SKU. 2 for the standard two-bottle milk
     * rotation. Ignored when `reusableContainer` is false.
     */
    rotationSize: {
      type: Number,
      required: false,
      default: 2,
      min: 2,
    },
    /**
     * Draws stock from `DairyMilkBatch` by FEFO rather than from `availableQty`.
     *
     * Set only where an outlet sells its own collected raw milk. Most outlets buy
     * finished product from a supplier and leave this false, which is why it is a
     * per-outlet flag rather than something derived from the category.
     */
    batchTracked: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * Litres of raw milk one unit of this pack size represents. Used to convert
     * a basket quantity into the litres FEFO must allocate. Only meaningful when
     * `batchTracked` is true. A 500 ml pack is 0.5; a 1 litre pack is 1.
     */
    litresPerUnit: {
      type: Number,
      required: false,
      default: 1,
    },
    price: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    mrp: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    taxPercentage: {
      type: Number,
      required: false,
      default: 0,
    },
    availableQty: {
      type: Number,
      required: false,
      default: 0,
    },
    inStock: {
      type: Boolean,
      required: false,
      default: true,
    },
    /**
     * Perishable goods. Raw-milk batch tracking (fat / SNF / FEFO) lives on
     * `DairyMilkBatch` in the procurement slice, not here.
     */
    shelfLifeHours: {
      type: Number,
      required: false,
    },
    /** Veg/non-veg. Dairy is always veg, but the flag keeps reports uniform. */
    isVeg: {
      type: Boolean,
      required: false,
      default: true,
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
dairySkuSchema.plugin(toJSON);
dairySkuSchema.plugin(paginate);
dairySkuSchema.plugin(slugGenerator);
dairySkuSchema.index({ business: 1, status: 1, inStock: 1 });
dairySkuSchema.index({ reusableContainer: 1 });
dairySkuSchema.index({ category: 1, subCategory: 1 });

/**
 * @typedef DairySku
 */
const DairySku = mongoose.model('DairySku', dairySkuSchema);

module.exports = DairySku;