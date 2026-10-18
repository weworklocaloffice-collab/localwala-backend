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

// Per-user social privacy + contact-sync bookkeeping. One row per user.
// findFriendsEnabled OFF  -> user is invisible to contact matching (both directions).
// showActivityToContacts OFF -> user's likes never appear as someone else's social proof.
const socialPrivacySchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    findFriendsEnabled: {
      type: Boolean,
      default: true,
    },
    showActivityToContacts: {
      type: Boolean,
      default: true,
    },
    lastSyncAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

socialPrivacySchema.plugin(toJSON);

socialPrivacySchema.index({ userId: 1 }, { unique: true });

const SocialPrivacy = mongoose.model('SocialPrivacy', socialPrivacySchema);

module.exports = SocialPrivacy;
