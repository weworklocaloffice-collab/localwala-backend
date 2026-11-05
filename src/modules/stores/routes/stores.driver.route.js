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

const express = require('express');
const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const appAuth = require('../../../middlewares/appAuth');
const validate = require('../../../middlewares/validate');
const deliveryService = require('../services/stores.delivery.service');
const V = require('../validations/stores.validation');

const router = express.Router();

const currentDriver = async (req) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const driver = await StoreDriver.findOne({
    user: req.user._id,
    status: { $in: ['active', 'reactivated'] },
  }).select('_id outlet chain');
  if (!driver) throw new ApiError(httpStatus.FORBIDDEN, 'No store driver profile is linked to this account');
  return driver;
};

const getDriverDeliveries = async (req, res) => {
  const driver = await currentDriver(req);
  const StoreDelivery = mongoose.model('StoreDelivery');
  const deliveries = await StoreDelivery.find({ driver: driver._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.status(httpStatus.OK).send({ deliveries: deliveries.map(deliveryService.sanitizeDelivery) });
};

const getDelivery = async (req, res) => {
  const driver = await currentDriver(req);
  const delivery = await deliveryService.getDeliveryById(req.params.delivery, {
    driver: driver._id,
  });
  res.status(httpStatus.OK).send({ delivery: deliveryService.sanitizeDelivery(delivery) });
};

const transitionDelivery = async (req, res) => {
  const driver = await currentDriver(req);
  const delivery = await deliveryService.transitionDelivery(req.params.delivery, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
    driver: driver._id,
  });
  res.status(httpStatus.OK).send({ delivery: deliveryService.sanitizeDelivery(delivery) });
};

const deliverWithOtp = async (req, res) => {
  const driver = await currentDriver(req);
  const delivery = await deliveryService.verifyDeliveryOtp(req.params.delivery, req.body.otp, {
    actor: req.user._id,
    driver: driver._id,
  });
  res.status(httpStatus.OK).send({ delivery: deliveryService.sanitizeDelivery(delivery) });
};

const failDelivery = async (req, res) => {
  const driver = await currentDriver(req);
  const delivery = await deliveryService.transitionDelivery(req.params.delivery, 'failed', {
    actor: req.user._id,
    notes: req.body.reason,
    driver: driver._id,
  });
  res.status(httpStatus.OK).send({ delivery: deliveryService.sanitizeDelivery(delivery) });
};

const getDriverEarnings = async (req, res) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const StoreDriver = mongoose.model('StoreDriver');

  const driver = await StoreDriver.findOne({ user: req.user._id });
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');

  const earnings = await StoreDelivery.aggregate([
    { $match: { driver: driver._id, status: 'delivered' } },
    { $group: {
      _id: null,
      totalDeliveries: { $sum: 1 },
      totalEarnings: { $sum: '$deliveryFee' },
      totalTips: { $sum: '$tipAmount' },
    } },
  ]);

  res.status(httpStatus.OK).send({
    driver: { driverCode: driver.driverCode, rating: driver.rating },
    earnings: earnings[0] || { totalDeliveries: 0, totalEarnings: 0, totalTips: 0 },
  });
};

router.get('/today', appAuth('storeDriver'), getDriverDeliveries);
router.get('/deliveries', appAuth('storeDriver'), getDriverDeliveries);
router.get('/deliveries/:delivery', appAuth('storeDriver'), getDelivery);
// LITERALS BEFORE THE `:status` PARAM. `/deliveries/:delivery/deliver` and `/fail` are
// the OTP handover (BR-29) and the failure path; declared after
// `/deliveries/:delivery/:status` they were captured by it, so every completion call
// silently ran the generic transition instead. The OTP proof was never verified.
router.post('/deliveries/:delivery/deliver', appAuth('storeDriver'), validate(V.deliveryOtpValidation), deliverWithOtp);
router.post('/deliveries/:delivery/fail', appAuth('storeDriver'), failDelivery);
router.post('/deliveries/:delivery/:status', appAuth('storeDriver'), validate(V.deliveryDriverTransitionValidation), transitionDelivery);
router.get('/earnings', appAuth('storeDriver'), getDriverEarnings);

module.exports = router;