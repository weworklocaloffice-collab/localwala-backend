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

const slaPolicySchema = mongoose.Schema(
  {
    supportType: {
      type: String,
      required: true,
      default: 'orders',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      required: true,
      default: 'medium',
    },
    firstResponseSec: {
      type: Number,
      required: true,
      default: 60,
    },
    resolutionSec: {
      type: Number,
      required: true,
      default: 3600,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // --- Escalation ladder -------------------------------------------------
    // What happens when this policy's deadline passes. Previously a breach only
    // raised the priority label; nobody was ever told, so "urgent" was a number
    // on a dashboard with no human behind it.
    //   off      - record the breach only (legacy behaviour)
    //   notify   - ping supervisors; the agent keeps the ticket
    //   reassign - move the ticket to an on-call supervisor
    escalationMode: {
      type: String,
      enum: ['off', 'notify', 'reassign'],
      default: 'off',
    },
    // Grace beyond the deadline before escalating, in seconds. An immediate
    // escalation on a 30s first-reply target is noise, not a safety net.
    escalateAfterSec: {
      type: Number,
      default: 600,
    },
    // Named escalation targets. Empty means "every available supervisor".
    escalateTo: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

slaPolicySchema.plugin(toJSON);
slaPolicySchema.plugin(paginate);
slaPolicySchema.index({ supportType: 1, priority: 1 }, { unique: true });

/**
 * @typedef SlaPolicy
 */
const SlaPolicy = mongoose.model('SlaPolicy', slaPolicySchema);

module.exports = SlaPolicy;
