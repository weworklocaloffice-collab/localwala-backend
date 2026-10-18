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

const express = require('express');
const validate = require('../../../middlewares/validate');
const { appAuth, storeAuth } = require('../middlewares/stores.tenant');
const V = require('../validations/stores.validation');
const subscriptionController = require('../controllers/stores.customer.subscription.controller');

const router = express.Router();

// Customer subscription routes (requires appAuth)
router.post(
  '/subscriptions',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionCreateValidation),
  subscriptionController.createSubscription
);

router.get(
  '/subscriptions',
  appAuth('stores_subscription_read'),
  subscriptionController.listCustomerSubscriptions
);

router.get(
  '/subscriptions/:subscription',
  appAuth('stores_subscription_read'),
  subscriptionController.getSubscription
);

router.patch(
  '/subscriptions/:subscription/:status',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionTransitionValidation),
  subscriptionController.transitionSubscription
);

router.post(
  '/subscriptions/:subscription/skip',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionSkipValidation),
  subscriptionController.skipNext
);

router.post(
  '/subscriptions/:subscription/pause',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionPauseValidation),
  subscriptionController.pauseSubscription
);

router.post(
  '/subscriptions/:subscription/resume',
  appAuth('stores_subscription_write'),
  subscriptionController.resumeSubscription
);

router.post(
  '/subscriptions/:subscription/cancel',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionCancelValidation),
  subscriptionController.cancelSubscription
);

router.get(
  '/subscriptions/upcoming',
  appAuth('stores_subscription_read'),
  subscriptionController.getUpcoming
);

module.exports = router;