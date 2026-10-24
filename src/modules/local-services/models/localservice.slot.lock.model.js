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

const slotLockSchema = mongoose.Schema(
  {
    key: { type: String, required: true },
    owner: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

slotLockSchema.index({ key: 1 }, { unique: true });
slotLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const LocalServiceSlotLock = mongoose.model('LocalServiceSlotLock', slotLockSchema);

module.exports = LocalServiceSlotLock;
