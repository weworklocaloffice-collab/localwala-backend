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
 * LocalServiceStatusHistory — auditable transition per booking.
 * Every status change writes one row; financial transitions also pin the actor.
 */
const localServiceStatusHistorySchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: true },
    from: { type: String, required: false },
    to: { type: String, required: true },
    actorType: { type: String, required: false, enum: ['customer', 'provider', 'admin', 'system'] },
    actor: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    reason: { type: String, required: false, trim: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceStatusHistorySchema.plugin(toJSON);
localServiceStatusHistorySchema.plugin(paginate);

localServiceStatusHistorySchema.index({ booking: 1, createdAt: 1 });

const LocalServiceStatusHistory = mongoose.model('LocalServiceStatusHistory', localServiceStatusHistorySchema);

module.exports = LocalServiceStatusHistory;
