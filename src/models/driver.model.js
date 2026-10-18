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

const driverSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },
    locality: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
      required: false,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: false,
    },
    vehicle: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Vehicle',
      required: true,
    },
    location: {
      type: {
        type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point'], // 'location.type' must be 'Point'
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    type: {
      type: String,
      required: true,
      default: 'freelancer', // freelancer or salary
    },
    identity: {
      type: String, // passport, driving license // NID // Restaurant ID
      required: true,
    },
    identityNumber: {
      type: String,
      required: true,
    },
    identityProof: {
      type: String,
      required: true,
    },
    drivingLicense: {
      type: String,
      required: true,
    },
    age: {
      type: Number,
      required: true,
    },
    dob: {
      type: Date,
      required: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    offlineReason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DriverOfflineMessages',
      required: false,
    },
    activeStatus: {
      type: Boolean,
      default: true,
    },
    orderHandling: {
      type: Number,
      required: false,
      default: 0,
    },
    rating: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: Boolean,
      default: true,
    },
    // Current delivery zone of the rider's live pin (Batch A-4). Refreshed
    // best-effort on every heartbeat; null when unresolvable. Supply-side
    // signal for per-zone metrics — never an assignment constraint.
    zone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryZone',
      required: false,
      default: null,
    },
    zoneUpdatedAt: {
      type: Date,
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
driverSchema.plugin(toJSON);
driverSchema.plugin(paginate);
driverSchema.index({ location: '2dsphere' });

/**
 * @typedef Driver
 */
const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver;

