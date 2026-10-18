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
 * LocalServiceRecurringAgreement — repeat bookings (tutoring/maintenance).
 * Future occurrences are NOT guaranteed: each due date generates one
 * Occurrence row (unique) which then becomes a Booking. Pause/skip/cancel
 * never deletes history.
 */
const localServiceRecurringAgreementSchema = mongoose.Schema(
  {
    customer: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: false },
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: true },
    cadence: {
      type: String,
      required: true,
      enum: ['daily', 'alternate_days', 'weekly', 'biweekly', 'monthly'],
      default: 'weekly',
    },
    intervalCount: { type: Number, required: false, default: 1, min: 1 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: false },
    nextOccurrenceDate: { type: Date, required: true },
    labourAmount: moneyField(0),
    partsAmount: moneyField(0),
    status: { type: String, required: true, enum: ['active', 'paused', 'cancelled', 'completed'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceRecurringAgreementSchema.plugin(toJSON);
localServiceRecurringAgreementSchema.plugin(paginate);

localServiceRecurringAgreementSchema.index({ customer: 1, status: 1 });
localServiceRecurringAgreementSchema.index({ status: 1, nextOccurrenceDate: 1 });

const LocalServiceRecurringAgreement = mongoose.model(
  'LocalServiceRecurringAgreement',
  localServiceRecurringAgreementSchema
);

module.exports = LocalServiceRecurringAgreement;
