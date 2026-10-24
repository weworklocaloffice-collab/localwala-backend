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

const ownProviderProfile = async (userId) => {
  const provider = await Provider.findOne({ owner: userId }).sort({ createdAt: -1 });
  if (!provider) {
    const e = new Error('No provider profile');
    e.statusCode = 404;
    throw e;
  }
  return provider;
};

// Admin oversight: list all availability rules across providers.
const adminListAvailabilityRules = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.service) filter.service = req.query.service;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.day !== undefined && req.query.day !== '') filter.day = Number(req.query.day);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceAvailabilityRule.paginate(filter, options));
});

const createStaff = catchAsync(async (req, res) => {
  const provider = await ownProvider(req.user._id);
  const doc = await LocalServiceStaff.create({ ...req.body, provider: provider._id });
  res.status(httpStatus.CREATED).send({ staff: doc });
});

const listStaff = catchAsync(async (req, res) => {
  const provider = await Provider.findOne({ owner: req.user._id });
  if (!provider) return res.status(httpStatus.OK).send({ results: [] });
  const docs = await LocalServiceStaff.find({ provider: provider._id });
  res.status(httpStatus.OK).send({ results: docs });
});

const updateStaff = catchAsync(async (req, res) => {
  const provider = await ownProviderProfile(req.user._id);
  const doc = await LocalServiceStaff.findOneAndUpdate(
    { _id: req.params.id, provider: provider._id },
    { $set: req.body },
    { new: true, runValidators: true }
  );
  if (!doc) {
    const e = new Error('Staff not found');
    e.statusCode = 404;
    throw e;
  }
  res.status(httpStatus.OK).send({ staff: doc });
});

const upsertAvailability = catchAsync(async (req, res) => {
  const provider = await ownProviderProfile(req.user._id);
  const doc = await LocalServiceAvailabilityRule.findOneAndUpdate(
    { provider: provider._id, service: req.body.service || null, day: req.body.day },
    { ...req.body, provider: provider._id },
    { upsert: true, new: true }
  );
  res.status(httpStatus.OK).send({ rule: doc });
});

const upsertCoverage = catchAsync(async (req, res) => {
  const provider = await ownProviderProfile(req.user._id);
  const doc = await LocalServiceCoverage.findOneAndUpdate(
    { provider: provider._id },
    { ...req.body, provider: provider._id },
    { upsert: true, new: true }
  );
  res.status(httpStatus.OK).send({ coverage: doc });
});

const getCoverage = catchAsync(async (req, res) => {
  const provider = await ownProviderProfile(req.user._id);
  const doc = await LocalServiceCoverage.findOne({ provider: provider._id });
  res.status(httpStatus.OK).send({ coverage: doc });
});

module.exports = { createStaff, listStaff, updateStaff, upsertAvailability, upsertCoverage, getCoverage, adminListAvailabilityRules };
