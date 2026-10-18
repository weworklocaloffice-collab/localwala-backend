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

const restaurantFacilitySchema = mongoose.Schema(
  {
    name: {
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
restaurantFacilitySchema.plugin(toJSON);
restaurantFacilitySchema.plugin(paginate);

restaurantFacilitySchema.statics.isNameTaken = async function (name, excludeFacilityId) {
  const facility = await this.findOne({ name, _id: { $ne: excludeFacilityId } });
  return !!facility;
};

/**
 * @typedef RestaurantFacility
 */
const RestaurantFacility = mongoose.model('RestaurantFacility', restaurantFacilitySchema);

module.exports = RestaurantFacility;

