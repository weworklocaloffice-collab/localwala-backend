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
 * LocalServiceResource — bookable capacity unit (room, vehicle, equipment).
 * A reservation must prevent overlapping bookings on the same resource.
 */
const localServiceResourceSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    kind: { type: String, required: true, enum: ['room', 'vehicle', 'equipment', 'staff_slot', 'other'], default: 'other' },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: false, uppercase: true, trim: true },
    capacity: { type: Number, required: false, default: 1, min: 1 },
    turnaroundMinutes: { type: Number, required: false, default: 0, min: 0 },
    status: { type: String, required: true, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceResourceSchema.plugin(toJSON);
localServiceResourceSchema.plugin(paginate);

localServiceResourceSchema.index({ provider: 1, status: 1 });
localServiceResourceSchema.index({ code: 1 }, { unique: true, sparse: true });

const LocalServiceResource = mongoose.model('LocalServiceResource', localServiceResourceSchema);

module.exports = LocalServiceResource;
