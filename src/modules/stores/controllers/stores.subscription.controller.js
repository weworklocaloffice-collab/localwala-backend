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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const subscriptionService = require('../services/stores.subscription.service');
const paymentService = require('../services/stores.payment.service');

const getSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.getSubscription(req.chainId);
  res.status(httpStatus.OK).send({ subscription });
});

const createSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.createSubscription({
    ...req.body,
    chain: req.chainId,
  });
  res.status(httpStatus.CREATED).send({ subscription });
});

const transitionSubscription = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.transitionSubscription(req.params.subscription, req.params.status, {
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ subscription });
});

// Gateway payment for the chain's subscription (BR-16). Same contract as the
// customer order endpoint: creates (or reuses) the PaymentInitiation the
// shared gateway checkout charges against, amount from the payment row.
const paySubscription = catchAsync(async (req, res) => {
  const initiation = await paymentService.initiateStoreSubscriptionPayment({
    subscriptionId: req.body.subscription,
    chainId: req.chainId,
    payerId: req.user._id,
    paymentConfigId: req.body.payment,
    paymentMethod: req.body.paymentMethod,
    paymentRef: req.body.paymentRef,
  });
  res.status(httpStatus.CREATED).send({ initiation });
});

const processBillingSweep = catchAsync(async (req, res) => {
  const results = await subscriptionService.processBillingSweep();
  res.status(httpStatus.OK).send(results);
});

const processGracePeriodExpiry = catchAsync(async (req, res) => {
  const results = await subscriptionService.processGracePeriodExpiry();
  res.status(httpStatus.OK).send(results);
});

const processSuspendedExpiry = catchAsync(async (req, res) => {
  const results = await subscriptionService.processSuspendedExpiry();
  res.status(httpStatus.OK).send(results);
});

const processTrialExpiry = catchAsync(async (req, res) => {
  const results = await subscriptionService.processTrialExpiry();
  res.status(httpStatus.OK).send(results);
});

module.exports = {
  getSubscription,
  createSubscription,
  transitionSubscription,
  paySubscription,
  processBillingSweep,
  processGracePeriodExpiry,
  processSuspendedExpiry,
  processTrialExpiry,
};