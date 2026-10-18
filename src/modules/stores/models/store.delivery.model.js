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

const storeDeliverySchema = mongoose.Schema(
  {
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
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
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreDriver',
      required: true,
    },
    status: {
      type: String,
      default: 'assigned',
      enum: ['assigned', 'accepted', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'cancelled'],
    },
    codCollected: {
      type: Number,
      default: 0,
    },
    codStatus: {
      type: String,
      default: 'pending',
      enum: ['pending', 'collected', 'reconciled'],
    },
    otpHash: {
      type: String,
    },
    otpExpiresAt: {
      type: Date,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    maxOtpAttempts: {
      type: Number,
      default: 3,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: {
      type: Date,
    },
    pickedUpAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    failedAt: {
      type: Date,
    },
    failureReason: {
      type: String,
    },
    deliveryNotes: {
      type: String,
    },
    proofImage: {
      type: String,
    },
    signatureImage: {
      type: String,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    tipAmount: {
      type: Number,
      default: 0,
    },
    distanceKm: {
      type: Number,
    },
    estimatedMinutes: {
      type: Number,
    },
    actualMinutes: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

storeDeliverySchema.plugin(toJSON);
storeDeliverySchema.plugin(paginate);

storeDeliverySchema.index({ order: 1 }, { unique: true });
storeDeliverySchema.index({ driver: 1, status: 1 });
storeDeliverySchema.index({ outlet: 1, status: 1, assignedAt: -1 });
storeDeliverySchema.index({ codStatus: 1, outlet: 1 });

storeDeliverySchema.statics.findByOrder = async function (orderId) {
  return this.findOne({ order: orderId });
};

storeDeliverySchema.statics.findActiveByDriver = async function (driverId) {
  return this.find({
    driver: driverId,
    status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
  });
};

storeDeliverySchema.statics.findPendingCod = async function (outletId) {
  return this.find({
    outlet: outletId,
    codStatus: { $in: ['pending', 'collected'] },
  });
};

module.exports = mongoose.model('StoreDelivery', storeDeliverySchema);