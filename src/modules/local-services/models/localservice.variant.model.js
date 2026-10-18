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
const moneyField = require('../../../utils/money.field');

/**
 * LocalServiceVariant — package/duration/tier of a service.
 * Variant describes the offering; Resource is the actual inventory.
 */
const localServiceVariantSchema = mongoose.Schema(
  {
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: false, uppercase: true, trim: true },
    durationMinutes: { type: Number, required: false, default: 60, min: 0 },
    basePrice: moneyField(0),
    includedWork: { type: String, required: false, trim: true },
    status: { type: String, required: true, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceVariantSchema.plugin(toJSON);
localServiceVariantSchema.plugin(paginate);

localServiceVariantSchema.index({ service: 1, status: 1 });
localServiceVariantSchema.index({ sku: 1 }, { unique: true, sparse: true });

const LocalServiceVariant = mongoose.model('LocalServiceVariant', localServiceVariantSchema);

module.exports = LocalServiceVariant;
