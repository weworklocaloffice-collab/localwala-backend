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

const storeDriverSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    driverCode: {
      type: String,
      required: true,
      trim: true,
    },
    vehicle: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreDriverVehicle',
    },
    licenseNumber: {
      type: String,
      required: true,
      trim: true,
    },
    licenseExpiry: {
      type: Date,
      required: true,
    },
    aadhaarLast4: {
      type: String,
    },
    panNumber: {
      type: String,
    },
    bankDetails: {
      accountName: String,
      accountNumber: String,
      ifsc: String,
      bankName: String,
    },
    payoutMode: {
      type: String,
      default: 'business_pays',
      enum: ['business_pays', 'driver_pays'],
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
    },
    totalDeliveries: {
      type: Number,
      default: 0,
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    isAvailable: {
      type: Boolean,
      default: false,
    },
    lastActiveAt: {
      type: Date,
    },
    status: {
      type: String,
      default: 'active',
      enum: ['active', 'inactive', 'suspended', 'reactivated'],
    },
    suspensionReason: {
      type: String,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    deactivatedAt: {
      type: Date,
    },
    deactivatedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    deactivationReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

storeDriverSchema.plugin(toJSON);
storeDriverSchema.plugin(paginate);

storeDriverSchema.index({ user: 1, outlet: 1 }, { unique: true });
storeDriverSchema.index({ outlet: 1, status: 1 });
storeDriverSchema.index({ chain: 1, status: 1 });
storeDriverSchema.index({ driverCode: 1 }, { unique: true });

storeDriverSchema.statics.findByOutlet = async function (outletId) {
  return this.find({ outlet: outletId }).sort({ status: 1, rating: -1 });
};

storeDriverSchema.statics.findAvailable = async function (outletId) {
  // `reactivated` counts as available: nothing ever moves a driver from `reactivated`
  // back to `active`, so excluding it stranded every reactivated driver permanently —
  // available in name, invisible to dispatch. Matches the outlet lifecycle, which treats
  // the two as equivalent for operational purposes.
  return this.find({ outlet: outletId, status: { $in: ['active', 'reactivated'] }, isAvailable: true });
};

storeDriverSchema.statics.findByUser = async function (userId) {
  return this.findOne({ user: userId });
};

module.exports = mongoose.model('StoreDriver', storeDriverSchema);