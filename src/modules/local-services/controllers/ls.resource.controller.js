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
const Resource = require('../models/localservice.resource.model');
const Provider = require('../models/localservice.provider.model');

const ownProvider = async (userId) => {
  const provider = await Provider.findOne({ owner: userId }).sort({ createdAt: -1 });
  if (!provider) {
    const e = new Error('No provider profile');
    e.statusCode = 404;
    throw e;
  }
  return provider;
};

const duplicateCode = (error) => {
  if (error && error.code === 11000) {
    const e = new Error('Resource code already exists');
    e.statusCode = 409;
    return e;
  }
  return error;
};

const createResource = catchAsync(async (req, res) => {
  const provider = await ownProvider(req.user._id);
  try {
    const doc = await Resource.create({ ...req.body, provider: provider._id });
    res.status(httpStatus.CREATED).send({ resource: doc });
  } catch (e) {
    throw duplicateCode(e);
  }
});

const listResources = catchAsync(async (req, res) => {
  const provider = await ownProvider(req.user._id);
  const filter = { provider: provider._id };
  if (req.query.status) filter.status = req.query.status;
  const docs = await Resource.find(filter).sort({ name: 1 });
  res.status(httpStatus.OK).send({ results: docs });
});

const updateResource = catchAsync(async (req, res) => {
  const provider = await ownProvider(req.user._id);
  try {
    const doc = await Resource.findOneAndUpdate(
      { _id: req.params.id, provider: provider._id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!doc) {
      const e = new Error('Resource not found');
      e.statusCode = 404;
      throw e;
    }
    res.status(httpStatus.OK).send({ resource: doc });
  } catch (e) {
    throw duplicateCode(e);
  }
});

const adminListResources = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.kind) filter.kind = req.query.kind;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await Resource.paginate(filter, options);
  res.status(httpStatus.OK).send(result);
});

module.exports = { createResource, listResources, updateResource, adminListResources };
