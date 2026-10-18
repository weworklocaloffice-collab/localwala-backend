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
const { toJSON } = require('../../../models/plugins');

/**
 * DispatchAttempt — one rung of the escalation ladder for one order.
 *
 * Written before the offers go out, not after, so that a crash mid-broadcast
 * still leaves the record of what was attempted. Without it, "why did this order
 * take 40 seconds to assign" has no answer and the time-to-assign metric cannot
 * be computed.
 *
 * Append-only. Nothing here is ever updated; the outcome is recorded on the row
 * that already exists.
 */
const dispatchAttemptSchema = mongoose.Schema(
  {
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: true,
      index: true,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    round: {
      type: Number,
      required: true,
      default: 0,
    },
    radiusMeters: {
      type: Number,
      required: true,
      default: 0,
    },
    batchSize: {
      type: Number,
      required: true,
      default: 1,
    },
    pool: {
      type: String,
      required: false,
      default: null, // own_fleet | platform
    },
    candidateCount: {
      type: Number,
      required: false,
      default: 0,
    },
    offeredTo: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'User' }],
      default: [],
    },
    outcome: {
      type: String,
      required: false,
      default: 'broadcast', // broadcast | no_candidates | exhausted | accepted | failed
    },
    acceptedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: false,
      default: null,
    },
    resolvedAt: {
      type: Date,
      required: false,
      default: null,
    },
    trigger: {
      type: String,
      required: false,
      default: 'auto', // auto | reject | expiry | admin
    },
    // Customer-side delivery zone (Batch A-4). Best-effort tag for per-zone
    // ops metrics; null when unresolvable. Versioned with the zone so
    // dashboards stay comparable across republishes.
    zone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryZone',
      required: false,
      default: null,
    },
    zoneVersion: {
      type: Number,
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

dispatchAttemptSchema.plugin(toJSON);
dispatchAttemptSchema.index({ order: 1, round: 1 });

/**
 * @typedef DispatchAttempt
 */
const DispatchAttempt = mongoose.model('DispatchAttempt', dispatchAttemptSchema);

module.exports = DispatchAttempt;
