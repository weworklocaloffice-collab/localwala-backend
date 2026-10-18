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
const { LocalServiceStaff, LocalServiceAvailabilityRule, LocalServiceCoverage } = require('../models/localservice.staff.model');
const Provider = require('../models/localservice.provider.model');

const ownProvider = async (userId) => {
  const provider = await Provider.findOne({ owner: userId, status: 'ACTIVE' });
  if (!provider) {
    const e = new Error('Provider not active');
    e.statusCode = 403;
    throw e;
  }
  return provider;
};

const createStaff = catchAsync(async (req, res) => {
  const provider = await ownProvider(req.user._id);
  const doc = await LocalServiceStaff.create({ provider: provider._id, ...req.body });
  res.status(httpStatus.CREATED).send({ staff: doc });
});

const listStaff = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) return res.status(httpStatus.OK).send({ results: [] });
  const docs = await LocalServiceStaff.find({ provider: provider._id });
  res.status(httpStatus.OK).send({ results: docs });
});

const upsertAvailability = catchAsync(async (req, res) => {
  const provider = await ownProvider(req.user._id);
  const doc = await LocalServiceAvailabilityRule.findOneAndUpdate(
    { provider: provider._id, service: req.body.service || null, day: req.body.day },
    { ...req.body, provider: provider._id },
    { upsert: true, new: true }
  );
  res.status(httpStatus.OK).send({ rule: doc });
});

const upsertCoverage = catchAsync(async (req, res) => {
  const provider = await ownProvider(req.user._id);
  const doc = await LocalServiceCoverage.findOneAndUpdate(
    { provider: provider._id },
    { ...req.body, provider: provider._id },
    { upsert: true, new: true }
  );
  res.status(httpStatus.OK).send({ coverage: doc });
});

module.exports = { createStaff, listStaff, upsertAvailability, upsertCoverage };
