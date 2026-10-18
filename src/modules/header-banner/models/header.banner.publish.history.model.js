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

/**
 * Audit trail for every publish, unpublish and delete of a header banner.
 *
 * Written on the same transaction boundary as the mutation it records, so a
 * publish that rolls back never leaves an orphan history row.
 */
const headerBannerPublishHistorySchema = mongoose.Schema(
  {
    headerBanner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'HeaderBanner',
      required: false,
    },
    campaignName: {
      type: String,
      required: false,
      trim: true,
    },
    // create | update | publish | unpublish | delete
    action: {
      type: String,
      required: true,
      enum: ['create', 'update', 'publish', 'unpublish', 'delete'],
    },
    // Full snapshot of the banner at the moment of the action. Stored as Mixed
    // so a schema change never silently truncates history.
    snapshot: {
      type: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    note: {
      type: String,
      required: false,
      trim: true,
    },
    publishedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

headerBannerPublishHistorySchema.index({ headerBanner: 1, publishedAt: -1 });

/**
 * @typedef HeaderBannerPublishHistory
 */
const HeaderBannerPublishHistory =
  mongoose.models.HeaderBannerPublishHistory || mongoose.model('HeaderBannerPublishHistory', headerBannerPublishHistorySchema);

module.exports = HeaderBannerPublishHistory;