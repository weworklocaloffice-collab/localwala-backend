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

/**
 * The drop-off address for one of THIS driver's deliveries.
 *
 * The delivery row carries no address - it references the order - and the order route is
 * `storeAuth`-scoped, which a driver token cannot pass. Without this read a rider knows an
 * order number and nothing about where it goes. Only the fields the handover needs are
 * returned, and the delivery is matched on `driver` here so another outlet's delivery id
 * is a 404 rather than an address leak.
 */
const getDeliveryOrder = async (req, res) => {
  const driver = await currentDriver(req);
  const StoreDelivery = mongoose.model('StoreDelivery');
  const StoreOrder = mongoose.model('StoreOrder');
  const delivery = await StoreDelivery.findOne({
    _id: req.params.delivery,
    driver: driver._id,
  })
    .select('order')
    .lean();
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  const order = await StoreOrder.findOne({ _id: delivery.order, outlet: driver.outlet })
    .select('orderNo paymentMode grandTotal codAmount addressSnapshot items customerNote createdAt')
    .lean();
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  res.status(httpStatus.OK).send({
    order: {
      _id: order._id,
      orderNo: order.orderNo,
      paymentMode: order.paymentMode,
      grandTotal: order.grandTotal,
      codAmount: order.codAmount,
      address: order.addressSnapshot,
      itemCount: Array.isArray(order.items) ? order.items.length : 0,
      customerNote: order.customerNote,
      createdAt: order.createdAt,
    },
  });
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

// GUARD WITH RIGHTS, NOT THE ROLE NAME. `appAuth(NAME)` checks that NAME against
// `roleRights.get(user.role)`, and the `storeDriver` role does not grant a right called
// `storeDriver` - so every route below 403'd for the exact rider it was written for.
// The driver's granted rights are the `stores_delivery_*` / `stores_order_read` /
// `stores_earnings_read` entries in config/roles.js; the per-outlet tenancy is enforced
// by `currentDriver()` inside each handler, not by the middleware.
router.get('/today', appAuth('stores_delivery_read'), getDriverDeliveries);
router.get('/deliveries', appAuth('stores_delivery_read'), getDriverDeliveries);
router.get('/deliveries/:delivery', appAuth('stores_delivery_read'), getDelivery);
// LITERALS BEFORE THE `:status` PARAM. `/deliveries/:delivery/deliver` and `/fail` are
// the OTP handover (BR-29) and the failure path; declared after
// `/deliveries/:delivery/:status` they were captured by it, so every completion call
// silently ran the generic transition instead. The OTP proof was never verified.
router.post('/deliveries/:delivery/deliver', appAuth('stores_delivery_otp'), validate(V.deliveryOtpValidation), deliverWithOtp);
router.post('/deliveries/:delivery/fail', appAuth('stores_delivery_update'), failDelivery);
router.get('/deliveries/:delivery/order', appAuth('stores_order_read'), getDeliveryOrder);
// `accepted` is the accept step (`stores_delivery_accept`); every later step is an
// update. appAuth takes them with OR semantics, matching the driver's grant set.
router.post('/deliveries/:delivery/:status', appAuth('stores_delivery_update', 'stores_delivery_accept'), validate(V.deliveryDriverTransitionValidation), transitionDelivery);
router.get('/earnings', appAuth('stores_earnings_read'), getDriverEarnings);

module.exports = router;