/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential. Unauthorized copying, redistribution, resale,
 * publication, modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const brandRequestService = require('../services/stores.brand.request.service');

const createRequest = catchAsync(async (req, res) => {
  const { request, created } = await brandRequestService.requestBrand({
    chain: req.chainId,
    by: req.user._id,
    ...req.body,
  });
  res.status(created ? httpStatus.CREATED : httpStatus.OK).send({ request, created });
});

const listRequests = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'page', 'limit']);
  const result = await brandRequestService.listOwnRequests({ ...filter, chain: req.chainId });
  res.status(httpStatus.OK).send(result);
});

const adminListRequests = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'search', 'page', 'limit']);
  const result = await brandRequestService.listRequests(filter);
  res.status(httpStatus.OK).send(result);
});

const reviewRequest = catchAsync(async (req, res) => {
  const request = await brandRequestService.reviewRequest({
    requestId: req.params.request,
    status: req.body.status,
    note: req.body.note,
    by: req.user._id,
  });
  res.status(httpStatus.OK).send({ request });
});

module.exports = {
  createRequest,
  listRequests,
  adminListRequests,
  reviewRequest,
};
