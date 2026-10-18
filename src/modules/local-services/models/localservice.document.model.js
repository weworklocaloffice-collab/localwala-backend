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
 * LocalServiceDocument — provider verification documents.
 * Immutable once verified (re-upload creates a new row, like realestate docs).
 */
const localServiceDocumentSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    kind: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    rejectReason: { type: String, required: false, trim: true },
    verifiedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceDocumentSchema.plugin(toJSON);
localServiceDocumentSchema.plugin(paginate);
localServiceDocumentSchema.index({ provider: 1, status: 1 });

const LocalServiceDocument = mongoose.model('LocalServiceDocument', localServiceDocumentSchema);

module.exports = LocalServiceDocument;
