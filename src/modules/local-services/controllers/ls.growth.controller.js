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
const {
  LocalServiceSubscriptionPlan,
  LocalServiceSubscription,
  LocalServiceFeaturedPlacement,
} = require('../models/localservice.growth.model');
const growth = require('../services/localservice.growth.service');

const createPlan = catchAsync(async (req, res) => {
  const doc = await LocalServiceSubscriptionPlan.create(req.body);
  res.status(httpStatus.CREATED).send({ plan: doc });
});

const listPlans = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceSubscriptionPlan.paginate(filter, options));
});

const subscribe = catchAsync(async (req, res) => {
  const Provider = require('../models/localservice.provider.model');
  const provider = await Provider.findOne({ owner: req.user._id, status: 'ACTIVE' });
  if (!provider) {
    const e = new Error('Provider not active');
    e.statusCode = 403;
    throw e;
  }
  const plan = await LocalServiceSubscriptionPlan.findById(req.body.plan);
  if (!plan || plan.status !== 'active') {
    const e = new Error('Plan not active');
    e.statusCode = 400;
    throw e;
  }
  const doc = await LocalServiceSubscription.create({
    provider: provider._id,
    plan: plan._id,
    status: 'active',
    startedAt: new Date(),
    renewAt: growth.nextRenewAt(new Date(), plan.interval),
  });
  res.status(httpStatus.CREATED).send({ subscription: doc });
});

const createFeatured = catchAsync(async (req, res) => {
  const doc = await LocalServiceFeaturedPlacement.create({ ...req.body, status: 'scheduled' });
  res.status(httpStatus.CREATED).send({ featured: doc });
});

const listFeatured = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'placement']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceFeaturedPlacement.paginate(filter, options));
});

module.exports = { createPlan, listPlans, subscribe, createFeatured, listFeatured };
