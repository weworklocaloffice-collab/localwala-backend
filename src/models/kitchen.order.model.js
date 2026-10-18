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

const kitchenOrderSchema = mongoose.Schema(
  {
    orderFrom: {
      type: String,
      required: true,
      default: 'regular_order', // regular_order, pos_order, table_order
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    regularOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: false,
    },
    posOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PosOrTableOrder',
      required: false,
    },
    tableId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantTable',
      required: false,
    },
    cartItemRaw: {
      type: String,
      required: true,
    },
    cookingInstruction: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      default: 'new', // new, preparing, completed,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
kitchenOrderSchema.plugin(toJSON);
kitchenOrderSchema.plugin(paginate);

/**
 * @typedef KitchenOrder
 */
const KitchenOrder = mongoose.model('KitchenOrder', kitchenOrderSchema);

module.exports = KitchenOrder;

