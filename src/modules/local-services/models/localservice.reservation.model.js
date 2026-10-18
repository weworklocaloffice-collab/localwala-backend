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
 * LocalServiceReservation — short-lived capacity hold before payment.
 * Overlap guard: partial unique on {resource, status:'held'} is enforced in
 * service via atomic insert + interval check (realestate hold BR-12 pattern).
 * Expired holds are released by cron; never block a slot forever.
 */
const localServiceReservationSchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: true },
    resource: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceResource', required: false },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: false },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ['held', 'confirmed', 'released', 'expired'], default: 'held' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceReservationSchema.plugin(toJSON);
localServiceReservationSchema.plugin(paginate);

localServiceReservationSchema.index({ booking: 1 });
localServiceReservationSchema.index({ resource: 1, startAt: 1, endAt: 1 });
localServiceReservationSchema.index({ status: 1, expiresAt: 1 });

const LocalServiceReservation = mongoose.model('LocalServiceReservation', localServiceReservationSchema);

module.exports = LocalServiceReservation;
