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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstateVendorDocument — KYC / agency papers for one vendor.
 *
 * Same visibility classes as property documents (BR-18), filtered by
 * the same `realestate.document.access.js` middleware. Vendor PAN /
 * incorporation papers are ADMIN_ONLY by default and never leave the
 * admin surface.
 */
const realEstateVendorDocumentSchema = mongoose.Schema(
  {
    vendor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVendor',
      required: true,
    },

    category: {
      type: String,
      required: true,
      enum: ['KYC', 'AGENCY_LICENSE', 'TAX', 'BANK_STATEMENT', 'OTHER'],
    },

    visibility: {
      type: String,
      required: true,
      default: 'ADMIN_ONLY',
      enum: ['INTERNAL', 'CUSTOMER_VISIBLE', 'BANK_VISIBLE', 'ADMIN_ONLY'],
    },

    fileUrl: { type: String, required: true, trim: true },
    fileName: { type: String, required: false, trim: true },
    mimeType: { type: String, required: false, trim: true },
    sizeBytes: { type: Number, required: false },
    checksum: { type: String, required: false, trim: true },

    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'REPLACED'],
    },

    uploadedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    verifiedAt: { type: Date, required: false },
    verifiedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    supersededBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'RealEstateVendorDocument', required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateVendorDocumentSchema.plugin(toJSON);
realEstateVendorDocumentSchema.plugin(paginate);

realEstateVendorDocumentSchema.index({ vendor: 1, category: 1, status: 1 });
realEstateVendorDocumentSchema.index(
  { vendor: 1, category: 1 },
  { unique: true, partialFilterExpression: { status: 'ACCEPTED' }, name: 'one_accepted_doc_per_category' }
);

/**
 * @typedef RealEstateVendorDocument
 */
const RealEstateVendorDocument = mongoose.model('RealEstateVendorDocument', realEstateVendorDocumentSchema);

module.exports = RealEstateVendorDocument;
