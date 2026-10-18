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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const crypto = require('crypto');

const DELIVERY_TRANSITIONS = {
  assigned: ['accepted', 'cancelled'],
  accepted: ['picked_up', 'cancelled'],
  picked_up: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'failed'],
  delivered: [],
  failed: ['assigned'],
  cancelled: [],
};

const assertTransition = (from, to) => {
  const allowed = DELIVERY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_DELIVERY_MOVE: ${from} -> ${to} is not allowed`);
  }
};

const generateOtp = () => String(crypto.randomInt(100000, 999999));

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const assignDriver = async ({ order, outlet, chain, driver, deliveryFee = 0, estimatedMinutes = 30 }) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const existing = await StoreDelivery.findOne({ order });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'Delivery already assigned for this order');

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  return StoreDelivery.create({
    order,
    outlet,
    chain,
    driver,
    status: 'assigned',
    otpHash: hashOtp(otp),
    otpExpiresAt,
    deliveryFee,
    estimatedMinutes,
    codAmount: 0,
  });
};

const transitionDelivery = async (deliveryId, to, { actor, notes } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findById(deliveryId);
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');

  assertTransition(delivery.status, to);

  delivery.status = to;
  const now = new Date();

  if (to === 'accepted') delivery.acceptedAt = now;
  if (to === 'picked_up') delivery.pickedUpAt = now;
  if (to === 'delivered') delivery.deliveredAt = now;
  if (to === 'failed') { delivery.failedAt = now; delivery.failureReason = notes; }

  await delivery.save();
  return delivery;
};

const verifyDeliveryOtp = async (deliveryId, otp) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findById(deliveryId);
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  if (delivery.status !== 'out_for_delivery') throw new ApiError(httpStatus.CONFLICT, 'Delivery is not out for delivery');
  if (new Date() > delivery.otpExpiresAt) throw new ApiError(httpStatus.CONFLICT, 'OTP has expired');
  if (delivery.otpAttempts >= delivery.maxOtpAttempts) throw new ApiError(httpStatus.CONFLICT, 'Maximum OTP attempts exceeded');

  delivery.otpAttempts += 1;

  if (delivery.otpHash !== hashOtp(otp)) {
    await delivery.save();
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid OTP');
  }

  // Return the TRANSITIONED document. Returning `delivery` here hands the caller the
  // pre-transition snapshot: the row reads `delivered` but the response says
  // `out_for_delivery`, so the driver app never sees the handover complete.
  return transitionDelivery(deliveryId, 'delivered');
};

const collectCod = async (deliveryId, amount) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findById(deliveryId);
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  if (delivery.status !== 'delivered') throw new ApiError(httpStatus.CONFLICT, 'Delivery not completed');

  delivery.codCollected = amount;
  delivery.codStatus = 'collected';
  await delivery.save();
  return delivery;
};

const reconcileCod = async (deliveryId) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findById(deliveryId);
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  if (delivery.codStatus !== 'collected') throw new ApiError(httpStatus.CONFLICT, 'COD not collected');

  delivery.codStatus = 'reconciled';
  await delivery.save();
  return delivery;
};

const getDelivery = async (orderId) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findOne({ order: orderId })
    .populate('driver', 'driverCode user')
    .lean();
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  return delivery;
};

const listDeliveries = async ({ outlet, driver, status, page = 1, limit = 20 }) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (driver) filter.driver = driver;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreDelivery.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreDelivery.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getAvailableDrivers = async (outletId) => {
  const StoreDriver = mongoose.model('StoreDriver');
  return StoreDriver.findAvailable(outletId);
};

module.exports = {
  assignDriver,
  transitionDelivery,
  verifyDeliveryOtp,
  collectCod,
  reconcileCod,
  getDelivery,
  listDeliveries,
  getAvailableDrivers,
  assertTransition,
  DELIVERY_TRANSITIONS,
  generateOtp,
  hashOtp,
};