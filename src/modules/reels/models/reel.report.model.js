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

const reelReportSchema = mongoose.Schema(
  {
    reelId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Reel',
      required: true,
    },
    reporterId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      enum: ['SPAM', 'INAPPROPRIATE', 'MISLEADING', 'COPYRIGHT', 'OTHER'],
      required: true,
    },
    details: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'],
      default: 'OPEN',
    },
  },
  { timestamps: true }
);

reelReportSchema.plugin(toJSON);
reelReportSchema.plugin(paginate);

reelReportSchema.index({ reelId: 1, status: 1 });
reelReportSchema.index({ reporterId: 1, createdAt: -1 });

// One report per reporter per reel, enforced by the database rather than by a
// findOne-then-create in the controller. The route was previously unthrottled and
// un-deduplicated, so the same submission could be inserted any number of times and the
// moderation queue filled with copies of a single complaint. A duplicate now surfaces
// as a 11000 and is answered as "already reported" - see reel.controller.js.
reelReportSchema.index({ reelId: 1, reporterId: 1 }, { unique: true });

const ReelReport = mongoose.model('ReelReport', reelReportSchema);

module.exports = ReelReport;
