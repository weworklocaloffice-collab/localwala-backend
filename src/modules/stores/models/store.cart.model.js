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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * Line items, EMBEDDED in the cart rather than in their own collection.
 *
 * ## Why there is no `cart` back-reference on an item
 *
 * An earlier version declared `cart: { type: ObjectId, ref: 'StoreCart', required: true }`
 * on the item schema. That is impossible to satisfy: the items are pushed onto the cart
 * document, and at push time the cart's `_id` does not exist yet on the first insert. Every
 * `addToCart` therefore failed with `StoreCart validation failed: items.0.cart: Path
 * 'cart' is required` — the cart could never hold a single line.
 *
 * Embedding makes the reference implicit and always correct: the item is INSIDE the cart,
 * so it cannot be attached to the wrong one or be orphaned from it. This is the same choice
 * `StoreOrder.items[]` makes, for the same reason.
 *
 * ## The outlet is repeated per line on purpose
 *
 * BR-13 says one outlet per cart, so `cart.outlet` already fixes it. Repeating it on the
 * item is what makes the BR-13 guard possible without a second query, and it means a
 * future "mixed cart" mode has somewhere to record the per-line outlet rather than
 * inventing one later.
 */
const storeCartItemSchema = mongoose.Schema(
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
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
      required: true,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
      required: true,
    },
    name: { type: String, required: true },
    variantName: { type: String },
    image: { type: String },
    sku: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    attributes: [{
      _id: false,
      key: String,
      label: String,
      value: mongoose.SchemaTypes.Mixed,
    }],
    isOrganic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const storeCartSchema = mongoose.Schema(
  {
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
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
    items: [storeCartItemSchema],
    itemCount: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

storeCartSchema.plugin(toJSON);
storeCartSchema.plugin(paginate);

storeCartSchema.index({ customer: 1, outlet: 1 }, { unique: true });
storeCartSchema.index({ customer: 1 });

storeCartSchema.statics.findByCustomer = async function (customerId) {
  return this.findOne({ customer: customerId }).populate('items.product', 'name slug images').populate('items.variant', 'name sku');
};

storeCartSchema.statics.findByOutlet = async function (customerId, outletId) {
  return this.findOne({ customer: customerId, outlet: outletId });
};

module.exports = mongoose.model('StoreCart', storeCartSchema);