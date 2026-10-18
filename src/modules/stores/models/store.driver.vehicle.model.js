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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const storeDriverVehicleSchema = mongoose.Schema(
  {
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreDriver',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    vehicleType: {
      type: String,
      required: true,
      enum: ['bike', 'scooter', 'car', 'van', 'bicycle', 'foot'],
    },
    registrationNumber: {
      type: String,
      required: true,
      trim: true,
    },
    make: {
      type: String,
      trim: true,
    },
    model: {
      type: String,
      trim: true,
    },
    year: {
      type: Number,
    },
    color: {
      type: String,
    },
    fuelType: {
      type: String,
      enum: ['petrol', 'diesel', 'cng', 'electric', 'hybrid'],
    },
    insuranceNumber: {
      type: String,
    },
    insuranceExpiry: {
      type: Date,
    },
    pollutionCertificateNumber: {
      type: String,
    },
    pollutionExpiry: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      default: 'active',
      enum: ['active', 'inactive', 'suspended'],
    },
  },
  {
    timestamps: true,
  }
);

storeDriverVehicleSchema.plugin(toJSON);
storeDriverVehicleSchema.plugin(paginate);

storeDriverVehicleSchema.index({ driver: 1, isActive: 1 });
storeDriverVehicleSchema.index({ registrationNumber: 1 }, { unique: true });
storeDriverVehicleSchema.index({ outlet: 1, status: 1 });

storeDriverVehicleSchema.statics.findByDriver = async function (driverId) {
  return this.find({ driver: driverId }).sort({ isActive: -1, createdAt: -1 });
};

storeDriverVehicleSchema.statics.findActive = async function (driverId) {
  return this.findOne({ driver: driverId, isActive: true, status: 'active' });
};

module.exports = mongoose.model('StoreDriverVehicle', storeDriverVehicleSchema);