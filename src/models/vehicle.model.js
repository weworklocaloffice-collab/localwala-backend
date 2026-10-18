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

const vehicleSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    extraCharge: {
      type: Number,
      required: true,
    },
    minimumCoverage: {
      type: Number,
      required: true,
    },
    maximumCoverage: {
      type: Number,
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
vehicleSchema.plugin(toJSON);
vehicleSchema.plugin(paginate);

vehicleSchema.statics.isNameTaken = async function (name, excludeVehicleId) {
  const vehicle = await this.findOne({ name, _id: { $ne: excludeVehicleId } });
  return !!vehicle;
};

/**
 * @typedef Vehicle
 */
const Vehicle = mongoose.model('Vehicle', vehicleSchema);

module.exports = Vehicle;

