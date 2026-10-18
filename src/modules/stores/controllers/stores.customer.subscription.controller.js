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
const subscriptionService = require('../services/stores.customer.subscription.service');

const createSubscription = catchAsync(async (req, res) => {
  // `outlet` comes from the BODY, not the session — see the note on the controller. The
  // session fallback is kept only for a partner-scoped caller, which is the one context
  // where `req.outletId` is actually populated.
  const subscription = await subscriptionService.createCustomerSubscription({
    ...req.body,
    customer: req.user._id,
    outlet: req.body.outlet || req.outletId,
    chain: req.body.chain || req.chainId,
  });
  res.status(httpStatus.CREATED).send({ subscription });
});

/**
 * TENANT SCOPING.
 *
 * Every handler below that touches ONE subscription by id passes `customer:
 * req.user._id`. That is the whole authorisation boundary on these routes, because they are
 * guarded by `appAuth` — a CUSTOMER token, which carries no `req.outletId`. Before this,
 * the only scope offered was `outlet`, which was therefore always undefined, and so:
 *
 *   GET    /subscriptions/:id                 -> any customer's subscription, readable
 *   PATCH  /subscriptions/:id/:status         -> any customer's subscription, mutable
 *   POST   /subscriptions/:id/{skip,pause,resume,cancel} -> same
 *
 * Any authenticated customer could cancel another person's recurring deliveries by id.
 * The service now narrows by `customer` as well as `outlet`; a row that is not the
 * caller's returns 404, which also avoids confirming that the id exists at all.
 *
 * `getUpcoming` and `listCustomerSubscriptions` were already scoped correctly and are
 * left as they are.
 */
const getSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.getCustomerSubscription(req.params.subscription, {
    customer: req.user._id,
  });
  res.status(httpStatus.OK).send({ subscription });
});

const listSubscriptions = catchAsync(async (req, res) => {
  const filter = { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 };
  if (req.outletId) filter.outlet = req.outletId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.customer) filter.customer = req.query.customer;
  const result = await subscriptionService.listCustomerSubscriptions(filter);
  res.status(httpStatus.OK).send(result);
});

const listCustomerSubscriptions = catchAsync(async (req, res) => {
  const filter = { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 };
  const result = await subscriptionService.listCustomerSubscriptionsForCustomer(req.user._id, filter);
  res.status(httpStatus.OK).send(result);
});

const transitionSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.transitionSubscription(req.params.subscription, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
    customer: req.user._id,
  });
  res.status(httpStatus.OK).send({ subscription });
});

const skipNext = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.skipNextOccurrence(req.params.subscription, {
    customer: req.user._id,
    actor: req.user._id,
    reason: req.body.reason,
  });
  res.status(httpStatus.OK).send({ subscription });
});

const pauseSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.pauseSubscription(req.params.subscription, {
    customer: req.user._id,
    actor: req.user._id,
    reason: req.body.reason,
  });
  res.status(httpStatus.OK).send({ subscription });
});

const resumeSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.resumeSubscription(req.params.subscription, {
    customer: req.user._id,
    actor: req.user._id,
  });
  res.status(httpStatus.OK).send({ subscription });
});

const cancelSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.cancelSubscription(req.params.subscription, {
    customer: req.user._id,
    actor: req.user._id,
    reason: req.body.reason,
  });
  res.status(httpStatus.OK).send({ subscription });
});

const getUpcoming = catchAsync(async (req, res) => {
  const upcoming = await subscriptionService.getUpcomingOccurrences({
    outlet: req.outletId,
    customer: req.user._id,
    days: parseInt(req.query.days) || 30,
  });
  res.status(httpStatus.OK).send({ upcoming });
});

module.exports = {
  createSubscription,
  getSubscription,
  listSubscriptions,
  listCustomerSubscriptions,
  transitionSubscription,
  skipNext,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  getUpcoming,
};