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
 * LocalServiceLead — qualified-lead pipeline (photography/events/professionals).
 * A qualified lead earns a fixed lead fee (revenueModel LEAD_FEE rule, fee field
 * carries the lead price). Duplicates by (customer+service+day) rejected via
 * application check; invalid leads credit via reversal entry.
 */
const localServiceLeadSchema = mongoose.Schema(
  {
    leadCode: { type: String, required: true, uppercase: true, trim: true },
    customer: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: false },
    categoryKey: { type: String, required: false, lowercase: true, trim: true },
    serviceKey: { type: String, required: false, lowercase: true, trim: true },
    description: { type: String, required: false, trim: true },
    status: {
      type: String,
      required: true,
      enum: ['NEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'INVALID', 'COMPLETED'],
      default: 'NEW',
    },
    qualified: { type: Boolean, required: false, default: false },
    leadFee: moneyField(0),
    revenueEntry: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceRevenueEntry', required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceLeadSchema.plugin(toJSON);
localServiceLeadSchema.plugin(paginate);

localServiceLeadSchema.index({ leadCode: 1 }, { unique: true });
localServiceLeadSchema.index({ customer: 1, createdAt: -1 });
localServiceLeadSchema.index({ provider: 1, status: 1 });

const LocalServiceLead = mongoose.model('LocalServiceLead', localServiceLeadSchema);

module.exports = LocalServiceLead;
