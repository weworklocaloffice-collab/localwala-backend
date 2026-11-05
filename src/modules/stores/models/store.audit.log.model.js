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

/**
 * StoreAuditLog — the admin/partner mutation trail for the stores vertical (plan F24).
 *
 * A settlement marked settled and a brand certification approved are money and trust
 * actions: when a dispute arrives months later, "who changed what, when, and what did it
 * look like before" is not reconstructible from a boolean Status column alone. Rows are
 * append-only — there is no update path below by design; correcting an audit record would
 * make the trail worthless.
 */

const mongoose = require('mongoose');
const { toJSON } = require('../../../models/plugins');

const storeAuditLogSchema = mongoose.Schema(
  {
    actor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    actorRole: {
      type: String,
      enum: ['admin', 'owner', 'manager', 'order_manager', 'inventory_manager', 'dispatcher', 'regional_manager', 'staff'],
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    targetType: {
      type: String,
      required: true,
    },
    targetId: {
      type: mongoose.SchemaTypes.ObjectId,
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
    },
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

storeAuditLogSchema.plugin(toJSON);

storeAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
storeAuditLogSchema.index({ chain: 1, createdAt: -1 });
storeAuditLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model('StoreAuditLog', storeAuditLogSchema);
