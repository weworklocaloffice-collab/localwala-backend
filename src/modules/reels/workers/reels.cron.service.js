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

const Reel = require('../../../models/reel.model');
const ReelInteraction = require('../models/reel.interaction.model');
const mediaService = require('../admin/reels.media.service');
const logger = require('../../../config/logger');

// Flip due SCHEDULED reels to PUBLISHED. Idempotent (status-keyed): a retry
// after a partial failure flips each reel once, and the feed's due-SCHEDULED
// clause covers any lag between due time and this sweep (docs §15).
const publishDueReels = async () => {
  const now = new Date();
  const result = await Reel.updateMany(
    { status: 'SCHEDULED', publishAt: { $lte: now } },
    { $set: { status: 'PUBLISHED', publishedAt: now, isLocked: false }, $unset: { publishAt: 1 } }
  );
  if (result.modifiedCount) logger.info(`reels.cron: published ${result.modifiedCount} due reels`);
  return { published: result.modifiedCount || 0 };
};

// Drive the transcode queue: oldest PROCESSING reels first.
const sweepProcessing = async ({ limit = 5 } = {}) => mediaService.pollProcessing({ limit });

// Safety net over the inline $inc counters: rebuild likes/saves/shares from
// the interaction log. VIEWs are analytics, not counters.
const reconcileCounters = async () => {
  const rows = await ReelInteraction.aggregate([
    { $match: { type: { $in: ['LIKE', 'SAVE', 'SHARE'] } } },
    { $group: { _id: { reelId: '$reelId', type: '$type' }, count: { $sum: 1 } } },
  ]);
  const byReel = new Map();
  for (const row of rows) {
    const id = String(row._id.reelId);
    if (!byReel.has(id)) byReel.set(id, { likes: 0, saves: 0, shares: 0 });
    const counters = byReel.get(id);
    if (row._id.type === 'LIKE') counters.likes = row.count;
    if (row._id.type === 'SAVE') counters.saves = row.count;
    if (row._id.type === 'SHARE') counters.shares = row.count;
  }
  if (!byReel.size) return { reconciled: 0 };
  const ops = [...byReel.entries()].map(([reelId, counters]) => ({
    updateOne: { filter: { _id: reelId }, update: { $set: counters } },
  }));
  const result = await Reel.bulkWrite(ops, { ordered: false });
  logger.info(`reels.cron: reconciled counters on ${result.modifiedCount} reels`);
  return { reconciled: result.modifiedCount || 0 };
};

module.exports = {
  publishDueReels,
  sweepProcessing,
  reconcileCounters,
};
