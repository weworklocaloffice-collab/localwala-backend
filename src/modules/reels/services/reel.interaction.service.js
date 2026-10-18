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

const { status: httpStatus } = require('http-status');
const Reel = require('../../../models/reel.model');
const ReelInteraction = require('../models/reel.interaction.model');
const ReelView = require('../models/reel.view.model');
const ApiError = require('../../../utils/ApiError');

const ensureReel = async (reelId) => {
  const reel = await Reel.findById(reelId);
  if (!reel) throw new ApiError(httpStatus.NOT_FOUND, 'Reel not found');
  return reel;
};

// Idempotent toggle backed by the unique (reelId, userId, type) key.
// Counters use $inc so concurrent toggles do not clobber each other.
const toggle = async (reelId, userId, type, counter) => {
  await ensureReel(reelId);
  const existing = await ReelInteraction.findOne({ reelId, userId, type });
  if (existing) {
    await ReelInteraction.deleteOne({ _id: existing._id });
    await Reel.updateOne({ _id: reelId }, { $inc: { [counter]: -1 } });
    const reel = await Reel.findById(reelId).select(counter).lean();
    return { active: false, count: Math.max(0, (reel && reel[counter]) || 0) };
  }
  try {
    await ReelInteraction.create({ reelId, userId, type });
  } catch (err) {
    if (err.code !== 11000) throw err; // lost a race — treat as active below
  }
  await Reel.updateOne({ _id: reelId }, { $inc: { [counter]: 1 } });
  const reel = await Reel.findById(reelId).select(counter).lean();
  return { active: true, count: (reel && reel[counter]) || 0 };
};

const toggleLike = (reelId, userId) => toggle(reelId, userId, 'LIKE', 'likes');
const toggleSave = (reelId, userId) => toggle(reelId, userId, 'SAVE', 'saves');

const recordShare = async (reelId, userId) => {
  await ensureReel(reelId);
  try {
    await ReelInteraction.create({ reelId, userId, type: 'SHARE' });
    await Reel.updateOne({ _id: reelId }, { $inc: { shares: 1 } });
  } catch (err) {
    if (err.code !== 11000) throw err; // already counted — still a share intent
  }
  const reel = await Reel.findById(reelId).select('shares').lean();
  return { shares: (reel && reel.shares) || 0 };
};

const recordView = async (reelId, userId, { watchedMs = 0, completed = false } = {}) => {
  await ensureReel(reelId);
  await ReelView.create({ reelId, userId: userId || null, watchedMs, completed });
  if (userId) {
    try {
      await ReelInteraction.create({ reelId, userId, type: 'VIEW' });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return { recorded: true };
};

module.exports = {
  toggleLike,
  toggleSave,
  recordShare,
  recordView,
};
