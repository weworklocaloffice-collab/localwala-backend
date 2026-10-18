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

// Append-friendly view log for analytics. Counters on Reel stay the read path;
// this collection is the audit trail (watchedMs/completed feed Phase-2 analytics).
const reelViewSchema = mongoose.Schema(
  {
    reelId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Reel',
      required: true,
    },
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      default: null,
    },
    watchedMs: {
      type: Number,
      default: 0,
    },
    completed: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

reelViewSchema.plugin(toJSON);
reelViewSchema.plugin(paginate);

reelViewSchema.index({ reelId: 1, createdAt: -1 });
reelViewSchema.index({ userId: 1, createdAt: -1 });

const ReelView = mongoose.model('ReelView', reelViewSchema);

module.exports = ReelView;
