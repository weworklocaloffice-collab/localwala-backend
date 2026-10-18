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
 * LocalServiceOffering — provider x service price/policy (stores OutletProduct pattern).
 * Price lives here (partner-set within admin limits); behaviour lives on Service.
 * Publishing requires active service + active provider; price >= 0 enforced in service.
 */
const localServiceOfferingSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: true },
    variant: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceVariant', required: false },
    price: moneyField(0),
    durationMinutes: { type: Number, required: false, default: 60, min: 0 },
    configVersion: { type: Number, required: false, default: 1 },
    status: { type: String, required: true, enum: ['draft', 'pending', 'active', 'inactive'], default: 'draft' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceOfferingSchema.plugin(toJSON);
localServiceOfferingSchema.plugin(paginate);

localServiceOfferingSchema.index({ provider: 1, service: 1, variant: 1 }, { unique: true });
localServiceOfferingSchema.index({ service: 1, status: 1 });
localServiceOfferingSchema.index({ provider: 1, status: 1 });

const LocalServiceOffering = mongoose.model('LocalServiceOffering', localServiceOfferingSchema);

module.exports = LocalServiceOffering;
