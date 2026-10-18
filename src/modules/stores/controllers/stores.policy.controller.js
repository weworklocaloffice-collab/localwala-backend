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
const policyService = require('../services/stores.policy.service');

const createPolicy = catchAsync(async (req, res) => {
  const policy = await policyService.createPolicy({
    ...req.body,
    chain: req.chainId,
    outlet: req.outletId,
  });
  res.status(httpStatus.CREATED).send({ policy });
});

const getPolicy = catchAsync(async (req, res) => {
  const policy = await policyService.getPolicy(req.params.policy, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ policy });
});

const listPolicies = catchAsync(async (req, res) => {
  const filter = { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 };
  if (req.chainId) filter.chain = req.chainId;
  if (req.outletId) filter.outlet = req.outletId;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  const result = await policyService.listPolicies(filter);
  res.status(httpStatus.OK).send(result);
});

const updatePolicy = catchAsync(async (req, res) => {
  const policy = await policyService.updatePolicy(req.params.policy, req.body, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ policy });
});

const archivePolicy = catchAsync(async (req, res) => {
  const policy = await policyService.archivePolicy(req.params.policy, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ policy });
});

module.exports = {
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  archivePolicy,
};