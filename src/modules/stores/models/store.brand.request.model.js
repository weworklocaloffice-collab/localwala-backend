/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential. Unauthorized copying, redistribution, resale,
 * publication, modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');

/**
 * A chain's request for a brand that does not exist yet.
 *
 * A request is deliberately NOT a `StoreBrand` row with `status: 'pending'`.
 * §5.7.7 is explicit: an unknown brand name in a product import creates a pending
 * brand request and "never a brand". Keeping the request in its own collection
 * means an unapproved name cannot leak into the brand picker, the brand export,
 * or any query that treats `StoreBrand` as the canonical brand list.
 */
const storeBrandRequestSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
    },
    requestedByChain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreCategory',
    },
    subcategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreSubcategory',
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    status: {
      type: String,
      required: true,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected'],
      index: true,
    },
    decision: {
      by: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
      },
      at: {
        type: Date,
      },
      note: {
        type: String,
        trim: true,
      },
    },
    brand: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreBrand',
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

storeBrandRequestSchema.index({ slug: 1 }, { unique: true });
storeBrandRequestSchema.index({ status: 1, createdAt: -1 });
storeBrandRequestSchema.index({ requestedByChain: 1, status: 1 });

const StoreBrandRequest = mongoose.model('StoreBrandRequest', storeBrandRequestSchema);

module.exports = StoreBrandRequest;
