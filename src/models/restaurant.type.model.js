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
const { toJSON, slugGenerator, paginate } = require('./plugins');

const restaurantTypeSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
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
restaurantTypeSchema.plugin(toJSON);
restaurantTypeSchema.plugin(slugGenerator);
restaurantTypeSchema.plugin(paginate);

restaurantTypeSchema.statics.isNameTaken = async function (name, excludeRestaurantTypeId) {
  const restaurantType = await this.findOne({ name, _id: { $ne: excludeRestaurantTypeId } });
  return !!restaurantType;
};

/**
 * @typedef RestaurantType
 */
const RestaurantType = mongoose.model('RestaurantType', restaurantTypeSchema);

module.exports = RestaurantType;

