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
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const Reel = require('../models/reel.model');
const ReelActivity = require('../models/reelActivity.model');
const ReelReport = require('../modules/reels/models/reel.report.model');
const feedService = require('../modules/reels/services/reel.feed.service');
const interactionService = require('../modules/reels/services/reel.interaction.service');
const commentService = require('../modules/reels/services/reel.comment.service');
const ApiError = require('../utils/ApiError');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// passport's jwtVerify resolves req.user to the full Mongoose User document,
// so the id lives at _id/id — never at uid (legacy Firebase shape).
const resolveUserId = (req) => req.user._id || req.user.id || req.user.uid;

const uploadReel = catchAsync(async (req, res) => {
  const { description, hashtags, musicTitle } = req.body;
  const uid = resolveUserId(req);
  const videoFile = req.file;
  const thumbnailFile = req.files?.thumbnail?.[0];

  if (!videoFile) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Video file is required');
  }

  const videoUrl = `/uploads/reels/${uuidv4()}${path.extname(videoFile.originalname)}`;
  let thumbnailUrl = '';

  if (thumbnailFile) {
    thumbnailUrl = `/uploads/reels/thumbnails/${uuidv4()}${path.extname(thumbnailFile.originalname)}`;
  }

  const reel = await Reel.create({
    user: uid,
    videoUrl,
    description,
    hashtags: hashtags ? JSON.parse(hashtags) : [],
    musicTitle,
    thumbnail: thumbnailUrl,
  });

  res.status(httpStatus.CREATED).send(reel);
});

// Feed delegates to the reels module so socialProof is attached in bulk
// (two queries for N reels, never N+1) — docs §9.
const fetchReels = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const viewerId = resolveUserId(req);
  // Viewer location powers the reel card's distance badge. The user schema
  // DEFAULTS `location.coordinates` to [0, 0] (Null Island), which is truthy —
  // so the sentinel must be rejected explicitly or every user who never set a
  // location gets a distance in the tens of thousands of km.
  let viewerLocation = null;
  const coords = req.user?.location?.coordinates;
  if (Array.isArray(coords) && coords.length === 2 && coords.every((n) => typeof n === 'number')) {
    const [lng, lat] = coords;
    if (lat !== 0 || lng !== 0) {
      viewerLocation = { lat, lng };
    }
  }
  const result = await feedService.getFeed(options, viewerId, viewerLocation);
  res.send(result);
});

const toggleLike = catchAsync(async (req, res) => {
  const { reelId } = req.params;
  const uid = resolveUserId(req);

  const { active, count } = await interactionService.toggleLike(reelId, uid);
  // Backward compat: legacy readers still consult reelactivities, so mirror
  // the new state there. Social proof reads both tables.
  if (active) {
    await ReelActivity.updateOne(
      { user: uid, reel: reelId, type: 'like' },
      { $setOnInsert: { user: uid, reel: reelId, type: 'like' } },
      { upsert: true }
    );
  } else {
    await ReelActivity.deleteOne({ user: uid, reel: reelId, type: 'like' });
  }

  res.send({ reelId, likeCount: count, liked: active });
});

const toggleSave = catchAsync(async (req, res) => {
  const { reelId } = req.params;
  const uid = resolveUserId(req);

  const { active, count } = await interactionService.toggleSave(reelId, uid);
  if (active) {
    await ReelActivity.updateOne(
      { user: uid, reel: reelId, type: 'save' },
      { $setOnInsert: { user: uid, reel: reelId, type: 'save' } },
      { upsert: true }
    );
  } else {
    await ReelActivity.deleteOne({ user: uid, reel: reelId, type: 'save' });
  }

  res.send({ reelId, saveCount: count, saved: active });
});

const recordShare = catchAsync(async (req, res) => {
  const { reelId } = req.params;
  const { shares } = await interactionService.recordShare(reelId, resolveUserId(req));
  res.send({ reelId, shares });
});

const recordView = catchAsync(async (req, res) => {
  const { reelId } = req.params;
  const { watchedMs = 0, completed = false } = req.body;
  await interactionService.recordView(reelId, resolveUserId(req), { watchedMs, completed });
  res.send({ reelId, recorded: true });
});

const addComment = catchAsync(async (req, res) => {
  const { reelId } = req.params;
  const { content } = req.body;

  if (!content || content.trim() === '') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Comment content is required');
  }

  const reel = await Reel.findById(reelId);
  if (!reel) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Reel not found');
  }

  const comment = await commentService.addComment(reelId, resolveUserId(req), content);
  res.status(httpStatus.CREATED).send(comment);
});

const getComments = catchAsync(async (req, res) => {
  const { reelId } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await commentService.listComments(reelId, options);
  res.send(result);
});

const reportReel = catchAsync(async (req, res) => {
  const { reelId } = req.params;
  const { reason, details } = req.body;

  const reel = await Reel.findById(reelId);
  if (!reel) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Reel not found');
  }

  const report = await ReelReport.create({
    reelId,
    reporterId: resolveUserId(req),
    reason,
    details,
  });
  res.status(httpStatus.CREATED).send(report);
});

module.exports = {
  uploadReel,
  fetchReels,
  toggleLike,
  toggleSave,
  recordShare,
  recordView,
  addComment,
  getComments,
  reportReel,
};
