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
const Restaurant = require('../../../models/restaurant.model');
const Food = require('../../../models/food.model');
const ReelView = require('../models/reel.view.model');
const ReelReport = require('../models/reel.report.model');
const ApiError = require('../../../utils/ApiError');

// Vertical → allowed target types (docs §16). Enforced server-side so the
// admin panel and any future client cannot smuggle an invalid pairing.
const TARGETS_BY_VERTICAL = {
  FOOD: ['RESTAURANT', 'PRODUCT'],
  DAIRY: ['PRODUCT'],
  SERVICES: ['SERVICE', 'VENDOR'],
  REAL_ESTATE: ['PROPERTY'],
};

// (vertical, target) → suggested CTA label (docs §16). Pure function, unit
// covered by scripts/verify.reels.admin.js.
const suggestCta = (vertical, targetType) => {
  const key = `${vertical}+${targetType}`;
  const matrix = {
    'FOOD+PRODUCT': 'ORDER NOW',
    'FOOD+RESTAURANT': 'ORDER NOW',
    'DAIRY+PRODUCT': 'SUBSCRIBE',
    'SERVICES+SERVICE': 'BOOK NOW',
    'SERVICES+VENDOR': 'BOOK NOW',
    'REAL_ESTATE+PROPERTY': 'VIEW PROPERTY',
  };
  return matrix[key] || 'VIEW MORE';
};

const assertTargetAllowed = (vertical, targetType) => {
  const allowed = TARGETS_BY_VERTICAL[vertical];
  if (!allowed) throw new ApiError(httpStatus.BAD_REQUEST, `Unknown vertical ${vertical}`);
  if (!allowed.includes(targetType)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `${targetType} is not a valid target for ${vertical}`
    );
  }
};

// The admin panel urlencodes empty selects, so '' (and the literal string
// 'undefined' produced by serializing a missing value) can arrive here. Drop
// them instead of handing Mongoose a value it cannot cast to ObjectId.
const cleanObjectId = (value) => {
  if (value === undefined || value === null) return undefined;
  const cleaned = String(value).trim();
  if (!cleaned || cleaned === 'undefined' || cleaned === 'null') return undefined;
  return cleaned;
};

// A promotion pointing at a deleted/hidden item is a silent dead link, so the
// reference is verified up front (docs §16 implies a real business target).
const assertTargetExists = async (target) => {
  if (!target?.refId) return;
  const refId = String(target.refId).trim();
  if (!/^[0-9a-f]{24}$/i.test(refId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'target.refId must be a valid ObjectId');
  }
  if (target.type === 'RESTAURANT') {
    const exists = await Restaurant.exists({ _id: refId, status: true });
    if (!exists) throw new ApiError(httpStatus.BAD_REQUEST, 'target restaurant no longer exists');
  } else if (target.type === 'PRODUCT') {
    const exists = await Food.exists({ _id: refId, status: 'live' });
    if (!exists) throw new ApiError(httpStatus.BAD_REQUEST, 'target food is no longer available');
  }
};

const withCta = (vertical, target, cta) => {
  if (!target) return undefined;
  assertTargetAllowed(vertical, target.type);
  if (cta && cta.label) return { label: cta.label, overridden: true };
  return { label: suggestCta(vertical, target.type), overridden: false };
};

const createReel = async (adminId, data) => {
  await assertTargetExists(data.target);
  const reel = await Reel.create({
    user: adminId,
    videoUrl: data.videoUrl || 'pending://upload',
    description: data.caption,
    hashtags: data.hashtags || [],
    vertical: data.vertical,
    target: data.target
      ? { type: data.target.type, refId: cleanObjectId(data.target.refId) }
      : undefined,
    cta: withCta(data.vertical, data.target, data.cta),
    cityId: cleanObjectId(data.cityId),
    localityId: cleanObjectId(data.localityId),
    status: 'DRAFT',
  });
  return reel;
};

const listReels = async ({ status, vertical, page = 1, limit = 20 } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (vertical) filter.vertical = vertical;
  return Reel.paginate(filter, {
    page: Number(page) || 1,
    limit: Math.min(Number(limit) || 20, 100),
    sortBy: 'createdAt:desc',
  });
};

const getReel = async (reelId) => {
  const reel = await Reel.findById(reelId);
  if (!reel) throw new ApiError(httpStatus.NOT_FOUND, 'Reel not found');
  return reel;
};

// Details remain editable until the reel goes public; after that it must be
// paused first so customers never see a half-edited reel.
const updateReel = async (reelId, patch) => {
  const reel = await getReel(reelId);
  if (['PUBLISHED', 'EXPIRED'].includes(reel.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Pause the reel before editing a ${reel.status} reel`
    );
  }
  const vertical = patch.vertical || reel.vertical;
  const target =
    patch.target !== undefined ? patch.target : reel.target?.toObject?.() || reel.target;
  if (patch.vertical || patch.target !== undefined) {
    if (!vertical || !target)
      throw new ApiError(httpStatus.BAD_REQUEST, 'vertical and target go together');
    await assertTargetExists({ type: target.type, refId: target.refId });
    reel.vertical = vertical;
    reel.target = { type: target.type, refId: cleanObjectId(target.refId) };
    reel.cta = withCta(vertical, reel.target, patch.cta !== undefined ? patch.cta : null);
  } else if (patch.cta !== undefined) {
    reel.cta = patch.cta?.label ? { label: patch.cta.label, overridden: true } : reel.cta;
  }
  if (patch.caption !== undefined) reel.description = patch.caption;
  if (patch.hashtags !== undefined) reel.hashtags = patch.hashtags;
  if (patch.cityId !== undefined) reel.cityId = cleanObjectId(patch.cityId);
  if (patch.localityId !== undefined) reel.localityId = cleanObjectId(patch.localityId);
  if (patch.thumbnailUrl !== undefined) {
    reel.thumbnail = patch.thumbnailUrl;
    reel.media = reel.media || {};
    reel.media.thumbnailUrl = patch.thumbnailUrl;
    reel.media.thumbnailSource = 'CUSTOM';
  }
  await reel.save();
  return reel;
};

// Admin preview: processed rendition URLs. Signed-URL preview is a Phase-2
// hardening once the CDN moves behind access control.
const previewReel = async (reelId) => {
  const reel = await getReel(reelId);
  if (!['READY', 'SCHEDULED', 'PUBLISHED', 'PAUSED'].includes(reel.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Reel is ${reel.status} — preview needs processed media`
    );
  }
  const rendition = reel.media?.renditions?.[0]?.url;
  return {
    reelId: String(reel._id),
    status: reel.status,
    videoUrl: rendition || reel.videoUrl,
    thumbnailUrl: reel.media?.thumbnailUrl || reel.thumbnail,
  };
};

const publishReel = async (reelId, { publishAt } = {}) => {
  const reel = await getReel(reelId);
  if (!['READY', 'SCHEDULED', 'PAUSED'].includes(reel.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only READY, SCHEDULED or PAUSED reels can be published (now ${reel.status})`
    );
  }
  if (!reel.media?.renditions?.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Processed media is required before publishing');
  }
  if (publishAt) {
    const at = new Date(publishAt);
    if (Number.isNaN(at.getTime()) || at <= new Date()) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'publishAt must be a future date');
    }
    reel.status = 'SCHEDULED';
    reel.publishAt = at;
    reel.isLocked = true;
  } else {
    reel.status = 'PUBLISHED';
    reel.publishAt = undefined;
    reel.publishedAt = new Date();
    reel.isLocked = false;
  }
  await reel.save();
  return reel;
};

const pauseReel = async (reelId) => {
  const reel = await getReel(reelId);
  if (reel.status !== 'PUBLISHED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only PUBLISHED reels can be paused (now ${reel.status})`
    );
  }
  reel.status = 'PAUSED';
  reel.isLocked = true;
  await reel.save();
  return reel;
};

// Hard delete is for never-public reels only; public ones must be paused
// first so the removal is deliberate and the media lifecycle stays explicit.
const deleteReel = async (reelId) => {
  const reel = await getReel(reelId);
  if (!['DRAFT', 'READY', 'REJECTED'].includes(reel.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Pause a ${reel.status} reel before deleting it`);
  }
  await reel.deleteOne();
  return { deleted: true, reelId: String(reel._id) };
};

const duplicateReel = async (reelId, adminId) => {
  const source = await getReel(reelId);
  const copy = await Reel.create({
    user: adminId,
    videoUrl: source.videoUrl,
    thumbnail: source.thumbnail,
    description: source.description,
    hashtags: source.hashtags || [],
    vertical: source.vertical,
    target: source.target,
    cta: source.cta,
    cityId: source.cityId,
    localityId: source.localityId,
    media: source.media,
    status: 'DRAFT',
  });
  return copy;
};

const reelAnalytics = async (reelId) => {
  const reel = await getReel(reelId);
  const [views, completed] = await Promise.all([
    ReelView.countDocuments({ reelId: reel._id }),
    ReelView.countDocuments({ reelId: reel._id, completed: true }),
  ]);
  return {
    reelId: String(reel._id),
    status: reel.status,
    views,
    completed,
    completionRate: views ? Math.round((completed / views) * 1000) / 10 : 0,
    likes: reel.likes || 0,
    saves: reel.saves || 0,
    shares: reel.shares || 0,
    comments: reel.comments || 0,
  };
};

const listReports = async ({ status, page = 1, limit = 20 } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  return ReelReport.paginate(filter, {
    page: Number(page) || 1,
    limit: Math.min(Number(limit) || 20, 100),
    sortBy: 'createdAt:desc',
    populate: 'reelId,reporterId',
  });
};

// Moderation verdicts. HIDE keeps the reel recoverable (PAUSED + isLocked);
// REMOVE is terminal for the listing (REJECTED + isLocked) with hard delete
// left to DELETE /:id as a deliberate second step. DISMISS clears no-violation
// reports; REVIEWING claims a report without a verdict yet.
const reviewReport = async (reportId, decision) => {
  const report = await ReelReport.findById(reportId);
  if (!report) throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');
  if (!['OPEN', 'REVIEWING'].includes(report.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Report is already ${report.status}`);
  }
  if (decision === 'REVIEWING') {
    report.status = 'REVIEWING';
    await report.save();
    return report;
  }
  if (decision === 'DISMISS') {
    report.status = 'DISMISSED';
    await report.save();
    return report;
  }
  const reel = await Reel.findById(report.reelId);
  if (!reel) throw new ApiError(httpStatus.NOT_FOUND, 'Reported reel no longer exists');
  if (decision === 'HIDE_REEL') {
    reel.status = 'PAUSED';
    reel.isLocked = true;
    await reel.save();
  } else if (decision === 'REMOVE_REEL') {
    reel.status = 'REJECTED';
    reel.isLocked = true;
    await reel.save();
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unknown decision ${decision}`);
  }
  report.status = 'RESOLVED';
  await report.save();
  return report;
};

module.exports = {
  TARGETS_BY_VERTICAL,
  suggestCta,
  createReel,
  listReels,
  getReel,
  updateReel,
  previewReel,
  publishReel,
  pauseReel,
  deleteReel,
  duplicateReel,
  reelAnalytics,
  listReports,
  reviewReport,
};
