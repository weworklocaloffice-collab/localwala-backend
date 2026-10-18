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

// Stores the useful relationship only: USER_A's address book contains the
// phone number belonging to USER_B. No raw contacts, no phone numbers —
// matching happens on SHA-256 hashes, then only (userId, matchedUserId) is kept.
const userContactMatchSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    matchedUserId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    source: {
      type: String,
      enum: ['PHONE_CONTACT'],
      default: 'PHONE_CONTACT',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'REVOKED'],
      default: 'ACTIVE',
    },
  },
  { timestamps: true }
);

userContactMatchSchema.plugin(toJSON);
userContactMatchSchema.plugin(paginate);

userContactMatchSchema.index({ userId: 1, matchedUserId: 1 }, { unique: true });
userContactMatchSchema.index({ userId: 1, status: 1 });
userContactMatchSchema.index({ matchedUserId: 1, status: 1 });

const UserContactMatch = mongoose.model('UserContactMatch', userContactMatchSchema);

module.exports = UserContactMatch;
