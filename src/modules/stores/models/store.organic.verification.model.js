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

const storeOrganicVerificationSchema = mongoose.Schema(
  {
    subjectType: {
      type: String,
      required: true,
      enum: ['store', 'product'],
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
    },
    certificateType: {
      type: String,
      required: true,
      enum: ['npop', 'ncof', 'organic_india', 'usda', 'eu_leaf', 'other'],
    },
    certificateNumber: {
      type: String,
      required: true,
    },
    issuingAuthority: {
      type: String,
      required: true,
    },
    document: {
      type: String,
      required: true,
    },
    issueDate: {
      type: Date,
      required: true,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected', 'expired'],
    },
    verifiedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    verifiedAt: {
      type: Date,
    },
    note: {
      type: String,
    },
    scope: {
      crop: String,
      landArea: Number,
      products: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'ChainProduct' }],
    },
  },
  { timestamps: true }
);

storeOrganicVerificationSchema.plugin(toJSON);
storeOrganicVerificationSchema.plugin(paginate);

storeOrganicVerificationSchema.index({ subjectType: 1, outlet: 1, status: 1 });
storeOrganicVerificationSchema.index({ subjectType: 1, product: 1, status: 1 });
storeOrganicVerificationSchema.index({ expiryDate: 1 });

storeOrganicVerificationSchema.statics.findValidForOutlet = async function (outletId) {
  return this.find({
    subjectType: 'store',
    outlet: outletId,
    status: 'approved',
    expiryDate: { $gt: new Date() },
  });
};

storeOrganicVerificationSchema.statics.findValidForProduct = async function (productId) {
  return this.find({
    subjectType: 'product',
    product: productId,
    status: 'approved',
    expiryDate: { $gt: new Date() },
  });
};

storeOrganicVerificationSchema.statics.findExpiringSoon = async function (days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  return this.find({
    status: 'approved',
    expiryDate: { $lte: cutoff, $gte: new Date() },
  });
};

module.exports = mongoose.model('StoreOrganicVerification', storeOrganicVerificationSchema);