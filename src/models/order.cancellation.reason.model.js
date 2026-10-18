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

const orderCancellationReasonSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    translations: {
      type: Array,
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
orderCancellationReasonSchema.plugin(toJSON);
orderCancellationReasonSchema.plugin(paginate);

orderCancellationReasonSchema.statics.isNameTaken = async function (name, excludeReasonId) {
  const reason = await this.findOne({ name, _id: { $ne: excludeReasonId } });
  return !!reason;
};

/**
 * @typedef OrderCancellationReason
 */
const OrderCancellationReason = mongoose.model(
  'OrderCancellationReason',
  orderCancellationReasonSchema
);

module.exports = OrderCancellationReason;

