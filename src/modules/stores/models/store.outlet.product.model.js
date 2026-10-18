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

const storeOutletProductSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    /**
     * The VARIANT, not the product.
     *
     * §4.3b: `StoreOutletProduct` is the `(variant × outlet)` join — one row per variant
     * per outlet, holding the price override and the enabled flag. The variant is what
     * carries a price, so keying the join on the product would collapse every size and
     * colour of one product into a single row and make per-variant pricing impossible.
     *
     * The ref is `ChainProductVariant` because BR-36 puts the catalogue at chain level:
     * the variant belongs to the chain's product, not to the outlet.
     */
    productVariant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
      required: true,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
      required: true,
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
    /**
     * Outlet-level GST override (OD-03).
     *
     * When set, this TaxConfiguration row wins over the product's HSN lookup
     * for sales at this outlet — the mechanism for an outlet in a special
     * zone or with its own ruling. Null (the norm) means "resolve from the
     * product's HSN like everyone else".
     */
    taxConfigOverride: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'TaxConfiguration',
      required: false,
    },
    sku: {
      type: String,
      trim: true,
    },
    barcode: {
      type: String,
      trim: true,
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
    reorderPoint: {
      type: Number,
      min: 0,
    },
    reservedQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    restockable: {
      type: Boolean,
      default: true,
    },
    status: {
      // String lifecycle, per §4.3b. A boolean cannot express `archived`, and this row is
      // the chain↔outlet join that historical orders resolve through — archiving it must
      // not erase the fact that the outlet once sold the variant.
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

// add plugin that converts mongoose to json and supports pagination
storeOutletProductSchema.plugin(toJSON);
storeOutletProductSchema.plugin(paginate);

storeOutletProductSchema.index({ outlet: 1, productVariant: 1 }, { unique: true });

storeOutletProductSchema.statics.findByOutlet = async function (outletId) {
  return this.find({ outlet: outletId, status: true })
    .populate('productVariant')
    .populate('product')
    .sort({ name: 1 });
};

module.exports = mongoose.model('StoreOutletProduct', storeOutletProductSchema);