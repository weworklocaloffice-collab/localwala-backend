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
const featuredService = require('../services/stores.featured.service');

const createFeatured = catchAsync(async (req, res) => {
  const placement = await featuredService.createFeaturedPlacement({
    ...req.body,
    outlet: req.outletId,
    chain: req.chainId,
  });
  res.status(httpStatus.CREATED).send({ placement });
});

const getFeatured = catchAsync(async (req, res) => {
  const placement = await featuredService.getFeaturedPlacement(req.params.placement, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ placement });
});

const listFeatured = catchAsync(async (req, res) => {
  const filter = { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 };
  if (req.outletId) filter.outlet = req.outletId;
  if (req.chainId) filter.chain = req.chainId;
  if (req.query.subjectType) filter.subjectType = req.query.subjectType;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.slot) filter.slot = req.query.slot;
  const result = await featuredService.listFeaturedPlacements(filter);
  res.status(httpStatus.OK).send(result);
});

const updateFeatured = catchAsync(async (req, res) => {
  const placement = await featuredService.updateFeaturedPlacement(req.params.placement, req.body, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ placement });
});

const approveFeatured = catchAsync(async (req, res) => {
  const placement = await featuredService.approveFeaturedPlacement(req.params.placement, {
    outlet: req.outletId,
    actor: req.user._id,
  });
  res.status(httpStatus.OK).send({ placement });
});

const rejectFeatured = catchAsync(async (req, res) => {
  const placement = await featuredService.rejectFeaturedPlacement(req.params.placement, {
    outlet: req.outletId,
    actor: req.user._id,
    reason: req.body.reason,
  });
  res.status(httpStatus.OK).send({ placement });
});

const getLive = catchAsync(async (req, res) => {
  const live = await featuredService.getLivePlacements(req.outletId);
  res.status(httpStatus.OK).send({ live });
});

const getPending = catchAsync(async (req, res) => {
  const pending = await featuredService.getPendingApprovals();
  res.status(httpStatus.OK).send({ pending });
});

module.exports = {
  createFeatured,
  getFeatured,
  listFeatured,
  updateFeatured,
  approveFeatured,
  rejectFeatured,
  getLive,
  getPending,
};