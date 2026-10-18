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

const shiftSchema = new mongoose.Schema(
  {
    _id: false,
    day: { type: Number, required: true, min: 0, max: 6 },
    start: { type: String, required: true, trim: true },
    end: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const leaveSchema = new mongoose.Schema(
  {
    _id: false,
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    reason: { type: String, required: false, trim: true },
  },
  { _id: false }
);

/**
 * LocalServiceStaff — skills + shifts + leave per provider.
 * A service is offerable only when required qualified staff is available,
 * unless explicitly configured without a staff requirement.
 */
const localServiceStaffSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    name: { type: String, required: true, trim: true },
    skills: { type: [String], required: false, default: [] },
    services: { type: [mongoose.SchemaTypes.ObjectId], ref: 'LocalServiceService', required: false, default: [] },
    shifts: { type: [shiftSchema], required: false, default: [] },
    leave: { type: [leaveSchema], required: false, default: [] },
    status: { type: String, required: true, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceStaffSchema.plugin(toJSON);
localServiceStaffSchema.plugin(paginate);
localServiceStaffSchema.index({ provider: 1, status: 1 });

const LocalServiceStaff = mongoose.model('LocalServiceStaff', localServiceStaffSchema);

/**
 * LocalServiceAvailabilityRule — weekly working hours per provider/service.
 * Exceptions (holidays/closures) ride the staff leave + rule status.
 */
const availabilityRuleSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: false },
    day: { type: Number, required: true, min: 0, max: 6 },
    open: { type: String, required: true, trim: true },
    close: { type: String, required: true, trim: true },
    slotMinutes: { type: Number, required: false, default: 60, min: 5 },
    bufferMinutes: { type: Number, required: false, default: 0, min: 0 },
    capacity: { type: Number, required: false, default: 1, min: 1 },
    status: { type: String, required: true, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);
availabilityRuleSchema.plugin(toJSON);
availabilityRuleSchema.plugin(paginate);
availabilityRuleSchema.index({ provider: 1, day: 1, status: 1 });
const LocalServiceAvailabilityRule = mongoose.model('LocalServiceAvailabilityRule', availabilityRuleSchema);

/**
 * LocalServiceCoverage — service areas per provider (localities + radius).
 * Search eligibility = customer address vs this coverage (not just zone).
 */
const coverageSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true, unique: true },
    localities: { type: [String], required: false, default: [] },
    pincodes: { type: [String], required: false, default: [] },
    city: { type: String, required: false, trim: true },
    radiusKm: { type: Number, required: false, default: 10, min: 0 },
  },
  { timestamps: true, toJSON: { getters: true } }
);
coverageSchema.plugin(toJSON);
coverageSchema.plugin(paginate);
const LocalServiceCoverage = mongoose.model('LocalServiceCoverage', coverageSchema);

module.exports = { LocalServiceStaff, LocalServiceAvailabilityRule, LocalServiceCoverage };
