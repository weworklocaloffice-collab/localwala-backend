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
 * One row per (agreement + date). E11000 = already generated (idempotency).
 */
const localServiceRecurringOccurrenceSchema = mongoose.Schema(
  {
    agreement: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceRecurringAgreement', required: true },
    occurrenceDate: { type: Date, required: true },
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: false },
    status: { type: String, required: true, enum: ['scheduled', 'generated', 'skipped', 'cancelled'], default: 'scheduled' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceRecurringOccurrenceSchema.plugin(toJSON);
localServiceRecurringOccurrenceSchema.plugin(paginate);

localServiceRecurringOccurrenceSchema.index({ agreement: 1, occurrenceDate: 1 }, { unique: true });
localServiceRecurringOccurrenceSchema.index({ status: 1, occurrenceDate: 1 });

const LocalServiceRecurringOccurrence = mongoose.model(
  'LocalServiceRecurringOccurrence',
  localServiceRecurringOccurrenceSchema
);

module.exports = LocalServiceRecurringOccurrence;
