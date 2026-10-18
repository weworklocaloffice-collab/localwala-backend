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
 * RealEstateReconciliation — one frozen money-match report.
 *
 * The nightly (and on-demand) three-way match between holds, ledger
 * rows and refunds. A report never changes after creation; the next
 * run is a new row, so finance sees the trend, not just the latest.
 * `healthy=false` pages finance via audit — it does NOT auto-freeze
 * new holds (availability must not hinge on a batch job; the admin
 * decides from this screen).
 */
const reconciliationCheckSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Paise integers — never floats, so the match is exact.
    expectedPaise: { type: Number, required: true },
    actualPaise: { type: Number, required: true },
    pass: { type: Boolean, required: true },
    detail: { type: String, required: false, trim: true },
  },
  { _id: false }
);

const realEstateReconciliationSchema = mongoose.Schema(
  {
    checkedAt: { type: Date, required: true, default: Date.now },
    healthy: { type: Boolean, required: true },
    mismatchCount: { type: Number, required: true, default: 0 },
    checks: { type: [reconciliationCheckSchema], default: [] },
    triggeredBy: { type: String, enum: ['cron', 'manual'], default: 'cron' },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateReconciliationSchema.plugin(toJSON);
realEstateReconciliationSchema.plugin(paginate);

realEstateReconciliationSchema.index({ checkedAt: -1 });

/**
 * @typedef RealEstateReconciliation
 */
const RealEstateReconciliation = mongoose.model(
  'RealEstateReconciliation',
  realEstateReconciliationSchema
);

module.exports = RealEstateReconciliation;
