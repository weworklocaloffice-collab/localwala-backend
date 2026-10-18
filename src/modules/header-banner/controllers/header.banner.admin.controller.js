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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const headerBannerService = require('../services/header.banner.service');
const uploadService = require('../services/header.banner.upload.service');
const lookupService = require('../services/header.banner.lookup.service');

/**
 * Resolves the acting admin id.
 *
 * `webAuth` populates the decoded token onto the request; a missing id is not
 * fatal because every history write tolerates a null actor.
 */
const actorId = (req) => (req.auth && req.auth.id ? req.auth.id : req.user && req.user._id ? req.user._id : null);

const list = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search', 'status', 'city']);
  const result = await headerBannerService.listHeaderBanners(options);
  res.send(result);
});

const detail = catchAsync(async (req, res) => {
  const { headerBannerId } = req.params;
  const result = await headerBannerService.getHeaderBannerById(headerBannerId);
  res.send(result);
});

const create = catchAsync(async (req, res) => {
  const result = await headerBannerService.createHeaderBanner(req.body, actorId(req));
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const { headerBannerId } = req.params;
  const result = await headerBannerService.updateHeaderBanner(headerBannerId, req.body, actorId(req));
  res.send(result);
});

const updateStatus = catchAsync(async (req, res) => {
  const { headerBannerId } = req.params;
  const result = await headerBannerService.toggleHeaderBannerStatus(headerBannerId, req.body.status, actorId(req));
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  const { headerBannerId } = req.params;
  const result = await headerBannerService.deleteHeaderBanner(headerBannerId, actorId(req));
  res.send(result);
});

const saveDraft = catchAsync(async (req, res) => {
  const result = await headerBannerService.saveDraft(req.body, actorId(req));
  res.send(result);
});

const getDraft = catchAsync(async (req, res) => {
  const { draftId } = req.params;
  const result = await headerBannerService.getDraft(draftId);
  res.send(result);
});

const discardDraft = catchAsync(async (req, res) => {
  const { draftId } = req.params;
  const result = await headerBannerService.discardDraft(draftId);
  res.send(result);
});

const publishDraft = catchAsync(async (req, res) => {
  const { draftId } = req.params;
  const result = await headerBannerService.publishDraft(draftId, req.body, actorId(req));
  res.send(result);
});

const history = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'headerBanner']);
  const result = await headerBannerService.listPublishHistory(options);
  res.send(result);
});

const upload = catchAsync(async (req, res) => {
  const result = await uploadService.uploadAsset(req);
  res.send(result);
});

const asset = catchAsync(async (req, res) => {
  const animation = await uploadService.getPreviewAnimation(req.query.path);
  res.send({ animation });
});

/**
 * Autocomplete options for the CTA target pickers.
 *
 * Each kind answers under its own response key rather than a flat `results` array so the
 * panel can tell a restaurant option from a food option without inspecting the shape.
 * The scope arguments are validated for presence in the service, not here, so a missing
 * city comes back as the same "required to list" error the panel already renders.
 */
const lookups = catchAsync(async (req, res) => {
  const { kind, city, restaurant } = req.query;

  if (kind === 'restaurant') {
    res.send({ restaurants: await lookupService.restaurantsByCity(city) });
    return;
  }

  if (kind === 'food') {
    const foods = restaurant
      ? await lookupService.foodsByRestaurant(restaurant)
      : await lookupService.foodsByCity(city);
    res.send({ foods });
    return;
  }

  res.send({ categories: await lookupService.categories() });
});

module.exports = {
  list,
  detail,
  create,
  update,
  updateStatus,
  drop,
  saveDraft,
  getDraft,
  discardDraft,
  publishDraft,
  history,
  upload,
  asset,
  lookups,
};