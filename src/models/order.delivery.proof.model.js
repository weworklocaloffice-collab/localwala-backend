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

const orderDeliveryProofSchema = mongoose.Schema(
  {
    orderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: true,
    },
    pickup: {
      type: String,
      default: 'none',
      required: false,
    },
    dropup: {
      type: String,
      default: 'none',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
orderDeliveryProofSchema.plugin(toJSON);

/**
 * @typedef OrderDeliveryProof
 */
const OrderDeliveryProof = mongoose.model('OrderDeliveryProof', orderDeliveryProofSchema);

module.exports = OrderDeliveryProof;

