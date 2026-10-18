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
const { toJSON } = require('./plugins');

const cartItemSchema = mongoose.Schema(
  {
    trackingId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Visitor',
      required: true,
    },
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    uuid: {
      type: String,
      required: true,
    },
    addons: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Addons',
        required: false,
      },
    ],
    food: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Food',
      required: true,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    quantity: {
      type: Number,
      default: 0,
    },
    restaurantCampaign: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantCampaign',
      required: false,
    },
    foodCampaign: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FoodCampaign',
      required: false,
    },
    cookingInstruction: {
      type: String,
      required: false,
    },
    variations: {
      type: Array,
      default: [],
    },
    itemTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    grandTotal: {
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

// add plugin that converts mongoose to json
cartItemSchema.plugin(toJSON);

/**
 * @typedef CartItem
 */
const CartItem = mongoose.model('CartItem', cartItemSchema);

module.exports = CartItem;

