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

const ReelInteraction = require('../models/reel.interaction.model');
const ReelActivity = require('../../../models/reelActivity.model');

// Liker data is owned by reels, so it lives here — never inside social.
// Social-proof receives the resulting map as injected data (docs §2, §9), which
// keeps the dependency one-way and lets future consumers (food, property, …)
// supply their own liker sets from their own modules.
//
// New interactions table first; legacy reelactivities merged so old likes keep
// producing social proof during the migration window.
const likerIdsForReels = async (reelIds) => {
  const [fresh, legacy] = await Promise.all([
    ReelInteraction.find({ reelId: { $in: reelIds }, type: 'LIKE' })
      .select('reelId userId')
      .lean(),
    ReelActivity.find({ reel: { $in: reelIds }, type: 'like' })
      .select('reel user')
      .lean(),
  ]);
  const byReel = new Map(reelIds.map((id) => [String(id), new Set()]));
  for (const row of fresh) {
    if (byReel.has(String(row.reelId))) byReel.get(String(row.reelId)).add(String(row.userId));
  }
  for (const row of legacy) {
    if (byReel.has(String(row.reel))) byReel.get(String(row.reel)).add(String(row.user));
  }
  return byReel;
};

module.exports = {
  likerIdsForReels,
};
