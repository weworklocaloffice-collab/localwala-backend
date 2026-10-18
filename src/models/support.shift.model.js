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
const { toJSON, paginate } = require('./plugins');

/**
 * A recurring shift for one agent.
 *
 * Availability used to be a self-declared toggle, which means nobody could
 * answer "is Pavani working right now?" without asking her. A shift answers it
 * from data: the coverage sweep marks off-shift agents offline automatically,
 * so the roster reflects planned staffing instead of optimism.
 *
 * `days` uses the same shape as queue working hours:
 * `{ mon: [[540, 1080]], ... }` in minutes from midnight, local to `timezone`.
 */
const supportShiftSchema = mongoose.Schema(
  {
    agentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: false,
      trim: true,
      default: 'Shift',
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    days: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Optional bounded validity, so a rotation can be published ahead of time
    // without needing a scheduler to activate it later.
    effectiveFrom: { type: Date, required: false },
    effectiveTo: { type: Date, required: false },
    // While false the agent is never auto-offlined. Kept separate from
    // `isActive` so "deleted" and "paused" stay distinguishable.
    autoOffline: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

supportShiftSchema.plugin(toJSON);
supportShiftSchema.plugin(paginate);
// One shift row per agent. The sweep reads every active shift each tick, so this
// index is what keeps that read cheap.
supportShiftSchema.index({ agentId: 1 }, { unique: true });
supportShiftSchema.index({ isActive: 1 });

/**
 * @typedef SupportShift
 */
const SupportShift = mongoose.model('SupportShift', supportShiftSchema);

module.exports = SupportShift;