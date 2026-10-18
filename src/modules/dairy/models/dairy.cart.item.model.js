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
 * DairyCartItem — one line in a customer's dairy cart.
 *
 * Separate from `CartItem` because the food cart is keyed on `food` (restaurant
 * scoped) while this is keyed on `sku`, and a dairy cart may span outlets only in
 * the sense that each line names its own `business`.
 *
 * Price is denormalised onto the line. A cart sits for minutes or days, and the
 * checkout total must reflect what the customer agreed to, not whatever the SKU
 * costs when they finally pay.
 */
const dairyCartItemSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    sku: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySku',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    /** Rupees, captured when the line is added. */
    price: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * Specific cans reserved for this line, when the SKU is supplied in reusable
     * containers. A one-time order may use LocalWala cans, but per the
     * specification it is NOT enrolled in two-bottle rotation — so this is a
     * one-off reservation, not a `DairyContainerAssignment`.
     */
    canCodes: {
      type: [String],
      default: [],
    },
    /**
     * Deposit added to the line when cans are attached. Held in the customer's
     * wallet on checkout and released when the cans come back.
     */
    depositAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyCartItemSchema.plugin(toJSON);
dairyCartItemSchema.plugin(paginate);
// One line per SKU per customer. Re-adding the same SKU updates quantity rather
// than creating a duplicate line.
dairyCartItemSchema.index({ user: 1, sku: 1 }, { unique: true });
dairyCartItemSchema.index({ user: 1, createdAt: -1 });

/**
 * @typedef DairyCartItem
 */
const DairyCartItem = mongoose.model('DairyCartItem', dairyCartItemSchema);

module.exports = DairyCartItem;