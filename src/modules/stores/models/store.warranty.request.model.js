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

const storeWarrantyRequestSchema = mongoose.Schema(
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
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
      required: true,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
      required: true,
    },
    productName: {
      type: String,
      required: true,
    },
    sku: {
      type: String,
    },
    warrantyType: {
      type: String,
      required: true,
      enum: ['manufacturer', 'store', 'manufacturer_service_centre'],
    },
    warrantyMonths: {
      type: Number,
      required: true,
    },
    purchaseDate: {
      type: Date,
      required: true,
    },
    warrantyExpiryDate: {
      type: Date,
      required: true,
    },
    issueDescription: {
      type: String,
      required: true,
    },
    issueCategory: {
      type: String,
      enum: ['manufacturing_defect', 'parts_failure', 'electrical_issue', 'physical_damage', 'other'],
    },
    status: {
      type: String,
      default: 'requested',
      enum: ['requested', 'approved', 'rejected', 'in_repair', 'resolved', 'closed', 'cancelled'],
    },
    resolution: {
      type: String,
      enum: ['repaired', 'replaced', 'refunded', 'rejected', 'pending'],
    },
    resolutionNotes: {
      type: String,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    serviceCentreName: {
      type: String,
    },
    serviceCentreAddress: {
      type: String,
    },
    serviceCentreContact: {
      type: String,
    },
    repairCost: {
      type: Number,
      default: 0,
    },
    costBearer: {
      type: String,
      enum: ['manufacturer', 'store', 'customer', 'shared'],
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    approvedAt: {
      type: Date,
    },
    approvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    images: {
      type: [String],
      default: [],
    },
    documents: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

storeWarrantyRequestSchema.plugin(toJSON);
storeWarrantyRequestSchema.plugin(paginate);

storeWarrantyRequestSchema.index({ order: 1, product: 1 });
storeWarrantyRequestSchema.index({ outlet: 1, status: 1, createdAt: -1 });
storeWarrantyRequestSchema.index({ customer: 1, createdAt: -1 });
storeWarrantyRequestSchema.index({ warrantyExpiryDate: 1 });

storeWarrantyRequestSchema.statics.findByOrder = async function (orderId) {
  return this.find({ order: orderId }).sort({ createdAt: -1 });
};

storeWarrantyRequestSchema.statics.findPending = async function (outletId) {
  return this.find({ outlet: outletId, status: { $in: ['requested', 'approved', 'in_repair'] } });
};

storeWarrantyRequestSchema.statics.findExpiringSoon = async function (days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  return this.find({
    warrantyExpiryDate: { $lte: cutoff, $gte: new Date() },
    status: { $in: ['approved', 'in_repair'] },
  });
};

module.exports = mongoose.model('StoreWarrantyRequest', storeWarrantyRequestSchema);