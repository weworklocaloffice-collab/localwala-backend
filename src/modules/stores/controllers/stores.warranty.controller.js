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
const warrantyService = require('../services/stores.warranty.service');

const createWarrantyRequest = catchAsync(async (req, res) => {
  const request = await warrantyService.createWarrantyRequest({
    ...req.body,
    customer: req.user._id,
    outlet: req.outletId,
    chain: req.chainId,
  });
  res.status(httpStatus.CREATED).send({ request });
});

const getWarrantyRequest = catchAsync(async (req, res) => {
  const request = await warrantyService.getWarrantyRequest(req.params.warranty, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ request });
});

const listWarrantyRequests = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'page', 'limit']);
  if (req.outletId) filter.outlet = req.outletId;
  const result = await warrantyService.listWarrantyRequests(filter);
  res.status(httpStatus.OK).send(result);
});

const transitionWarranty = catchAsync(async (req, res) => {
  const request = await warrantyService.transitionWarranty(req.params.warranty, req.params.status, {
    outlet: req.outletId,
    actor: req.user._id,
    ...req.body,
  });
  res.status(httpStatus.OK).send({ request });
});

const getExpiring = catchAsync(async (req, res) => {
  const expiring = await warrantyService.getExpiringWarranties({ outlet: req.outletId, days: parseInt(req.query.days) || 30 });
  res.status(httpStatus.OK).send({ expiring });
});

module.exports = {
  createWarrantyRequest,
  getWarrantyRequest,
  listWarrantyRequests,
  transitionWarranty,
  getExpiring,
};