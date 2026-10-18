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

const restaurantFoodLicenseSchema = mongoose.Schema(
  {
    image: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    website: {
      type: String,
      required: true,
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
restaurantFoodLicenseSchema.plugin(toJSON);
restaurantFoodLicenseSchema.plugin(paginate);

restaurantFoodLicenseSchema.statics.isNameTaken = async function (
  name,
  excludeRestaurantFoodLicenseId
) {
  const license = await this.findOne({ name, _id: { $ne: excludeRestaurantFoodLicenseId } });
  return !!license;
};

/**
 * @typedef RestaurantFoodLicense
 */
const RestaurantFoodLicense = mongoose.model('RestaurantFoodLicense', restaurantFoodLicenseSchema);

module.exports = RestaurantFoodLicense;

