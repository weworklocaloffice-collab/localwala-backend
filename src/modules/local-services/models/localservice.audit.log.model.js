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
 * LocalServiceAuditLog – append-only operator audit trail.
 * Booking and revenue-rule transitions keep their dedicated history models;
 * this table records cross-cutting admin actions (moderation, refunds,
 * plans, featured placements, settlements).
 */
const localServiceAuditLogSchema = mongoose.Schema(
  {
    event: { type: String, required: true, trim: true },
    targetType: { type: String, required: true, trim: true },
    targetId: { type: String, required: false, trim: true },
    actor: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    actorRole: { type: String, required: false, trim: true },
    details: { type: String, required: false, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, required: false },
    ip: { type: String, required: false, trim: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceAuditLogSchema.plugin(toJSON);
localServiceAuditLogSchema.plugin(paginate);

localServiceAuditLogSchema.index({ createdAt: -1 });
localServiceAuditLogSchema.index({ event: 1, createdAt: -1 });
localServiceAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

const LocalServiceAuditLog = mongoose.model('LocalServiceAuditLog', localServiceAuditLogSchema);

module.exports = LocalServiceAuditLog;
