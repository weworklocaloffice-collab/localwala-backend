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
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const adminService = require('./reels.admin.service');
const lookupService = require('./reels.admin.lookup.service');
const mediaService = require('./reels.media.service');

const resolveAdminId = (req) => req.user._id || req.user.id;

// Target options behind the reel-form pickers: restaurants by city for the
// RESTAURANT target, foods by restaurant (or city as a fallback) for PRODUCT.
const lookup = catchAsync(async (req, res) => {
  const { targetType, cityId, restaurantId } = req.query;
  if (targetType === 'RESTAURANT') {
    res
      .status(httpStatus.OK)
      .send({ restaurants: await lookupService.restaurantsByCity(cityId) });
    return;
  }
  const foods = restaurantId
    ? await lookupService.foodsByRestaurant(restaurantId)
    : await lookupService.foodsByCity(cityId);
  res.status(httpStatus.OK).send({ foods });
});

const uploadUrl = catchAsync(async (req, res) => {
  const result = await mediaService.createUploadUrl(req.body);
  res.status(httpStatus.OK).send(result);
});

const uploadProxy = catchAsync(async (req, res) => {
  try {
    const parseField = (value, fallback) => {
      if (!value) return fallback;
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch (_err) {
        return fallback;
      }
    };
    const target = parseField(req.body.target, undefined);
    const hashtags = parseField(req.body.hashtags, []);
    const cta = parseField(req.body.cta, undefined);
    if (req.body.reelId && !/^[0-9a-f]{24}$/i.test(req.body.reelId)) {
      return res.status(httpStatus.BAD_REQUEST).send({
        success: false,
        code: httpStatus.BAD_REQUEST,
        message: '"reelId" must be a valid 24-character hex id',
        extra: null,
      });
    }
    const result = await mediaService.uploadProxy({
      file: req.file,
      reelId: req.body.reelId,
      vertical: req.body.vertical,
      target,
      caption: req.body.caption,
      hashtags,
      cta,
      cityId: req.body.cityId,
      localityId: req.body.localityId,
      thumbnailUrl: req.body.thumbnailUrl,
      adminId: resolveAdminId(req),
    });
    res.status(httpStatus.OK).send(result);
  } catch (err) {
    console.error('[reels] upload proxy controller error:', err);
    throw err;
  }
});

const finalize = catchAsync(async (req, res) => {
  const reel = await mediaService.finalizeUpload(req.body.reelId, req.body.key);
  res.status(httpStatus.OK).send(reel);
});

const create = catchAsync(async (req, res) => {
  const reel = await adminService.createReel(resolveAdminId(req), req.body);
  res.status(httpStatus.CREATED).send(reel);
});

const list = catchAsync(async (req, res) => {
  const result = await adminService.listReels(
    pick(req.query, ['status', 'vertical', 'page', 'limit'])
  );
  res.status(httpStatus.OK).send(result);
});

const detail = catchAsync(async (req, res) => {
  const reel = await adminService.getReel(req.params.id);
  res.status(httpStatus.OK).send(reel);
});

const update = catchAsync(async (req, res) => {
  const reel = await adminService.updateReel(req.params.id, req.body);
  res.status(httpStatus.OK).send(reel);
});

const preview = catchAsync(async (req, res) => {
  const result = await adminService.previewReel(req.params.id);
  res.status(httpStatus.OK).send(result);
});

const publish = catchAsync(async (req, res) => {
  const reel = await adminService.publishReel(req.params.id, req.body);
  res.status(httpStatus.OK).send(reel);
});

const pause = catchAsync(async (req, res) => {
  const reel = await adminService.pauseReel(req.params.id);
  res.status(httpStatus.OK).send(reel);
});

const remove = catchAsync(async (req, res) => {
  const result = await adminService.deleteReel(req.params.id);
  res.status(httpStatus.OK).send(result);
});

const duplicate = catchAsync(async (req, res) => {
  const reel = await adminService.duplicateReel(req.params.id, resolveAdminId(req));
  res.status(httpStatus.CREATED).send(reel);
});

const analytics = catchAsync(async (req, res) => {
  const result = await adminService.reelAnalytics(req.params.id);
  res.status(httpStatus.OK).send(result);
});

const listReports = catchAsync(async (req, res) => {
  const result = await adminService.listReports(pick(req.query, ['status', 'page', 'limit']));
  res.status(httpStatus.OK).send(result);
});

const reviewReport = catchAsync(async (req, res) => {
  const result = await adminService.reviewReport(req.params.reportId, req.body.decision);
  res.status(httpStatus.OK).send(result);
});

module.exports = {
  uploadUrl,
  uploadProxy,
  finalize,
  create,
  lookup,
  list,
  detail,
  update,
  preview,
  publish,
  pause,
  remove,
  duplicate,
  analytics,
  listReports,
  reviewReport,
};