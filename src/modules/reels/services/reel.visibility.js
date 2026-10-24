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

/**
 * Who is allowed to see a reel, in one place.
 *
 * The feed filter and the interaction guard were separate copies of this rule, which is
 * exactly how they drifted: the feed hid PAUSED reels, while `toggleLike` and friends
 * only checked that the reel existed. Liking, saving, commenting on, sharing and viewing
 * a paused or rejected reel therefore all succeeded, and the counters and the view log
 * kept accruing for content no customer could reach.
 *
 * Kept in its own file with no imports so both callers can use it without pulling in the
 * feed's social-proof dependency chain.
 *
 * - PUBLISHED: live.
 * - SCHEDULED + publishAt <= now: the scheduler has not caught up yet, so a due reel is
 *   still visible rather than briefly vanishing from the feed.
 * - No `status` at all: documents that predate the field, kept visible during migration.
 * - isLocked is the moderation latch. `pauseReel` sets it, so PAUSED and a hidden reel
 *   both fall out here.
 */
const visibilityFilter = (now = new Date()) => ({
  isLocked: { $ne: true },
  $or: [
    { status: 'PUBLISHED' },
    { status: 'SCHEDULED', publishAt: { $lte: now } },
    { status: { $exists: false } },
  ],
});

/**
 * Whether a document satisfies {@link visibilityFilter}.
 *
 * Used where the reel has already been loaded and re-querying just to decide whether the
 * caller is allowed to interact with it would be wasteful.
 */
const isVisible = (reel) => {
  if (!reel) return false;
  if (reel.isLocked === true) return false;
  if (reel.status === undefined || reel.status === null) return true; // legacy doc
  if (reel.status === 'PUBLISHED') return true;
  if (reel.status === 'SCHEDULED') {
    const due = reel.publishAt ? new Date(reel.publishAt).getTime() : Number.NaN;
    return !Number.isNaN(due) && due <= Date.now();
  }
  return false;
};

module.exports = {
  visibilityFilter,
  isVisible,
};
