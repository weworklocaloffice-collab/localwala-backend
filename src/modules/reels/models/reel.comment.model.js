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

const reelCommentSchema = mongoose.Schema(
  {
    reelId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Reel',
      required: true,
    },
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['VISIBLE', 'HIDDEN', 'REMOVED'],
      default: 'VISIBLE',
    },
  },
  { timestamps: true }
);

reelCommentSchema.plugin(toJSON);
reelCommentSchema.plugin(paginate);

reelCommentSchema.index({ reelId: 1, status: 1, createdAt: -1 });
reelCommentSchema.index({ userId: 1, createdAt: -1 });

const ReelComment = mongoose.model('ReelComment', reelCommentSchema);

module.exports = ReelComment;
