/**
 * LocalWala �?" Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
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
const ApiError = require('../../../utils/ApiError');
const { PaymentInitiation, PaymentConfig } = require('../../../models');
const paymentInitiationService = require('../../../services/payment.initiation.service');
const RealEstateListingOrder = require('../models/realestate.listing.order.model');

const SERVICE_UNAVAILABLE = (httpStatus && httpStatus.SERVICE_UNAVAILABLE) || 503;

async function initiateOrderPayment({ orderId, vendorId, userId, paymentConfigId = null }) {
  const order = await RealEstateListingOrder.findById(orderId);
  if (!order || String(order.vendor) !== String(vendorId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }
  if (order.status === 'PAID') {
    throw new ApiError(httpStatus.CONFLICT, 'Order is already paid');
  }
  if (order.status !== 'PENDING_PAYMENT') {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `Order is ${order.status} and cannot be paid.`
    );
  }

  const existing = await PaymentInitiation.findOne({
    listingOrder: order._id,
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (existing) {
    if (String(order.paymentInitiation || '') !== String(existing._id)) {
      order.paymentInitiation = existing._id;
      await order.save();
    }
    return { order, initiation: existing };
  }

  let paymentConfig;
  if (paymentConfigId) {
    paymentConfig = await PaymentConfig.findById(paymentConfigId);
    if (!paymentConfig) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Payment method not found');
    }
  } else {
    paymentConfig =
      (await PaymentConfig.findOne({ isDefault: true, status: true, paymentWay: 'online' })) ||
      (await PaymentConfig.findOne({ status: true, paymentWay: 'online' }));
    if (!paymentConfig) {
      throw new ApiError(SERVICE_UNAVAILABLE, 'Online payments are not available right now');
    }
  }

  const amount = Number(order.amount);
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Order amount must be positive to pay.');
  }

  const initiation = await paymentInitiationService.initiatePayment({
    user: String(userId),
    payment: String(paymentConfig._id),
    listingOrder: String(order._id),
    amount,
    from: 'listing_package',
    ref: `listing package ${order.orderCode}`,
  });

  order.paymentInitiation = initiation._id;
  await order.save();

  return { order, initiation };
}

module.exports = {
  initiateOrderPayment,
};
