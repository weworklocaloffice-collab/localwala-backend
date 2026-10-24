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
const ApiError = require('../../../utils/ApiError');
const {
  LocalServiceSubscriptionPlan,
  LocalServiceSubscription,
  LocalServiceFeaturedPlacement,
} = require('../models/localservice.growth.model');
const growth = require('../services/localservice.growth.service');
const { recordAudit } = require('../services/localservice.audit.service');

const PLAN_TRANSITIONS = {
  active: ['inactive'],
  inactive: ['active'],
};

const FEATURED_TRANSITIONS = {
  scheduled: ['active', 'cancelled'],
  active: ['expired', 'cancelled'],
  expired: ['cancelled'],
  cancelled: [],
};

const createPlan = catchAsync(async (req, res) => {
  const doc = await LocalServiceSubscriptionPlan.create(req.body);
  await recordAudit(req, {
    event: 'plan.created',
    targetType: 'plan',
    targetId: doc._id,
    details: `Created subscription plan ${doc.code}`,
    metadata: { code: doc.code, price: doc.price, interval: doc.interval },
  });
  res.status(httpStatus.CREATED).send({ plan: doc });
});

const listPlans = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await LocalServiceSubscriptionPlan.paginate(filter, options));
});

const updatePlanStatus = catchAsync(async (req, res) => {
  const plan = await LocalServiceSubscriptionPlan.findById(req.params.id);
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  const next = req.body.status;
  if (!(PLAN_TRANSITIONS[plan.status] || []).includes(next)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Illegal plan transition ${plan.status} -> ${next}`);
  }
  const from = plan.status;
  plan.status = next;
  await plan.save();
  await recordAudit(req, {
    event: `plan.${next}`,
    targetType: 'plan',
    targetId: plan._id,
    details: `Plan ${plan.code} moved ${from} -> ${next}`,
    metadata: { from, to: next },
  });
  res.status(httpStatus.OK).send({ plan });
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
  if (!req.body.provider && !req.body.service) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'provider or service is required');
  }
  if (new Date(req.body.to) <= new Date(req.body.from)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'to must be after from');
  }
  const doc = await LocalServiceFeaturedPlacement.create({ ...req.body, status: 'scheduled' });
  await recordAudit(req, {
    event: 'featured.created',
    targetType: 'featured',
    targetId: doc._id,
    details: `Created ${doc.placement} placement`,
    metadata: { provider: doc.provider, service: doc.service, from: doc.from, to: doc.to, price: doc.price },
  });
  res.status(httpStatus.CREATED).send({ featured: doc });
});

const listFeatured = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'placement']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await LocalServiceFeaturedPlacement.paginate(filter, {
    ...options,
    populate: [
      { path: 'provider', select: 'businessName providerType' },
      { path: 'service', select: 'name categoryKey' },
    ],
  });
  res.status(httpStatus.OK).send(result);
});

const updateFeaturedStatus = catchAsync(async (req, res) => {
  const doc = await LocalServiceFeaturedPlacement.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Featured placement not found');
  const next = req.body.status;
  if (!(FEATURED_TRANSITIONS[doc.status] || []).includes(next)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Illegal featured transition ${doc.status} -> ${next}`);
  }
  const from = doc.status;
  doc.status = next;
  await doc.save();
  await recordAudit(req, {
    event: `featured.${next}`,
    targetType: 'featured',
    targetId: doc._id,
    details: `Featured placement moved ${from} -> ${next}`,
    metadata: { from, to: next, placement: doc.placement },
  });
  res.status(httpStatus.OK).send({ featured: doc });
});

module.exports = {
  createPlan,
  listPlans,
  updatePlanStatus,
  subscribe,
  createFeatured,
  listFeatured,
  updateFeaturedStatus,
};
