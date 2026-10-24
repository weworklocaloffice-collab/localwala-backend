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

// Canonical interaction store going forward (LIKE/SAVE/SHARE/VIEW).
// Legacy reelactivities (like/save) is still read for social proof during the
// migration window — see social-proof.repository.js.
const reelInteractionSchema = mongoose.Schema(
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
    type: {
      type: String,
      enum: ['LIKE', 'SAVE', 'SHARE', 'VIEW'],
      required: true,
    },
  },
  { timestamps: true }
);

reelInteractionSchema.plugin(toJSON);
reelInteractionSchema.plugin(paginate);

reelInteractionSchema.index({ reelId: 1, userId: 1, type: 1 }, { unique: true });
reelInteractionSchema.index({ reelId: 1, type: 1 });

// The nightly reconciliation job groups every interaction by `{ reelId, type }` after
// matching on `type` alone (workers/reels.cron.service.js). Neither index above can
// serve a `type`-only predicate - both lead on `reelId` - so the job was doing a full
// collection scan of the largest reels table once a day. Leading on `type` also puts
// the grouping key in index order.
reelInteractionSchema.index({ type: 1, reelId: 1 });

const ReelInteraction = mongoose.model('ReelInteraction', reelInteractionSchema);

module.exports = ReelInteraction;
