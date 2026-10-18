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

const tableOrderCartItemSchema = mongoose.Schema(
  {
    tableId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantTable',
      required: true,
    },
    tableNumber: {
      type: Number,
      required: true,
      default: 0,
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
    waiter: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    quantity: {
      type: Number,
      default: 0,
    },
    variations: {
      type: Array,
      default: [],
    },
    instruction: {
      type: String,
      required: false,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
tableOrderCartItemSchema.plugin(toJSON);

/**
 * @typedef TableOrderCartItem
 */
const TableOrderCartItem = mongoose.model('TableOrderCartItem', tableOrderCartItemSchema);

module.exports = TableOrderCartItem;

