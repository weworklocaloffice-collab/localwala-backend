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
const notifyService = require('./stores.notify.service');
const orderService = require('./stores.order.service');
const socketEmitter = require('../../../utils/socket.emitter');

const DELIVERY_ORDER_STATUS = {
  picked_up: 'picked_up',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
};

const deliveryFilter = (id, { outlet, driver } = {}) => {
  const filter = { _id: id };
  if (outlet) filter.outlet = outlet;
  if (driver) filter.driver = driver;
  return filter;
};

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

/**
 * Responses built from a StoreDelivery row must never carry `otpHash`.
 *
 * The hash is the SHA-256 of a six-digit code: brute-forcing a leaked hash costs
 * a million tries offline. The partner and driver clients need `otpVerified`,
 * `otpExpiresAt` and the attempt counters — never the digest itself.
 */
const sanitizeDelivery = (delivery) => {
  if (!delivery) return delivery;
  const plain = typeof delivery.toObject === 'function' ? delivery.toObject() : delivery;
  if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
    delete plain.otpHash;
  }
  return plain;
};

/**
 * Mint a fresh handover code. Resets both the clock and the attempt counter, because
 * a new code means a new chance to type it correctly.
 */
const issueDeliveryOtp = async (delivery) => {
  const otp = generateOtp();
  delivery.otpHash = hashOtp(otp);
  delivery.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  delivery.otpAttempts = 0;
  await delivery.save();
  return otp;
};

/**
 * Push the handover code to the CUSTOMER. Fire-and-forget by contract: a push failure
 * must never fail the transition that minted the code.
 */
const pushDeliveryOtp = async (delivery, otp) => {
  try {
    const StoreOrder = mongoose.model('StoreOrder');
    const order = await StoreOrder.findById(delivery.order).select('orderNo customer').lean();
    if (!order) return;
    await notifyService.notifyOrderLifecycle(order, 'delivery_otp', { otp });
  } catch {
    // The code stays valid; the partner can resend from the app.
  }
};

const resendDeliveryOtp = async (orderId, { outlet, actor } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const filter = { order: orderId };
  if (outlet) filter.outlet = outlet;

  const delivery = await StoreDelivery.findOne(filter);
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found for this order');
  if (delivery.otpVerified) {
    throw new ApiError(httpStatus.CONFLICT, 'The handover code was already verified for this delivery');
  }
  if (delivery.status === 'delivered' || delivery.status === 'cancelled') {
    throw new ApiError(httpStatus.CONFLICT, 'This delivery no longer needs a code');
  }

  const otp = await issueDeliveryOtp(delivery);
  const { sent } = await pushDeliveryOtp(delivery, otp);
  return { delivery: sanitizeDelivery(delivery), notified: Boolean(sent) };
};

const assignDriver = async ({
  order,
  outlet,
  chain,
  driver,
  deliveryFee = 0,
  estimatedMinutes = 30,
  actor,
}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const StoreOrder = mongoose.model('StoreOrder');
  const StoreDriver = mongoose.model('StoreDriver');

  const orderDoc = await StoreOrder.findOne({ _id: order, outlet });
  if (!orderDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (orderDoc.lifecycle !== 'ready') {
    throw new ApiError(httpStatus.CONFLICT, `ORDER_NOT_READY: lifecycle is ${orderDoc.lifecycle}`);
  }

  const driverDoc = await StoreDriver.findOne({
    _id: driver,
    outlet,
    chain,
    status: { $in: ['active', 'reactivated'] },
  });
  if (!driverDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found at this outlet');

  const existing = await StoreDelivery.findOne({ order });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'Delivery already assigned for this order');

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const delivery = await StoreDelivery.create({
    order,
    outlet,
    chain,
    driver,
    status: 'assigned',
    otpHash: hashOtp(otp),
    otpExpiresAt,
    deliveryFee,
    estimatedMinutes,
    codAmount: orderDoc.paymentMode === 'cod' ? orderDoc.grandTotal : 0,
  });

  try {
    await orderService.transitionOrder(order, 'driver_assigned', { actor, outlet });
  } catch (error) {
    await StoreDelivery.deleteOne({ _id: delivery._id });
    throw error;
  }

  socketEmitter.emitToRoom(`store-order:${String(order).toLowerCase()}`, 'deliveryStatus', {
    orderId: String(order),
    deliveryId: String(delivery._id),
    from: null,
    deliveryStatus: delivery.status,
    at: new Date().toISOString(),
  });

  await notifyDelivery(delivery, 'driver_assigned');
  return delivery;
};

const notifyDelivery = async (delivery, event, context = {}) => {
  try {
    const StoreOrder = mongoose.model('StoreOrder');
    const StoreDriver = mongoose.model('StoreDriver');
    const order = await StoreOrder.findById(delivery.order).lean();
    if (!order) return;
    const driver = await StoreDriver.findById(delivery.driver).populate('user', 'name').lean();
    await notifyService.notifyOrderLifecycle(order, event, {
      ...context,
      driverName: driver?.user?.name || driver?.driverCode,
    });
  } catch {
    // A notification failure must not roll back an assignment that already happened.
  }
};

const syncOrderLifecycle = async (delivery, to, { actor } = {}) => {
  const target = DELIVERY_ORDER_STATUS[to];
  if (!target) return;

  const StoreOrder = mongoose.model('StoreOrder');
  const order = await StoreOrder.findById(delivery.order).select('lifecycle').lean();
  if (!order) return;

  if (order.lifecycle !== target) {
    await orderService.transitionOrder(order._id, target, { actor, outlet: delivery.outlet });
  }

  if (target === 'delivered') {
    const delivered = await StoreOrder.findById(order._id).select('lifecycle').lean();
    if (delivered?.lifecycle === 'delivered') {
      await orderService.transitionOrder(order._id, 'completed', { actor, outlet: delivery.outlet });
    }
  }
};

const syncCodOrder = async (delivery, paymentStatus) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const update = { paymentStatus };
  if (paymentStatus === 'collected') {
    update.paidAmount = delivery.codCollected;
    update.paidAt = delivery.codCollectedAt;
  }
  const order = await StoreOrder.findOneAndUpdate(
    { _id: delivery.order, outlet: delivery.outlet, paymentMode: 'cod' },
    { $set: update },
    { new: true }
  );
  if (!order) return;

  socketEmitter.emitToRoom(`store-order:${String(order._id).toLowerCase()}`, 'orderStatus', {
    orderId: String(order._id),
    orderNo: order.orderNo,
    lifecycle: order.lifecycle,
    paymentStatus: order.paymentStatus,
    at: new Date().toISOString(),
  });
};

const transitionDelivery = async (deliveryId, to, { actor, notes, outlet, driver } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findOne(deliveryFilter(deliveryId, { outlet, driver }));
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');

  assertTransition(delivery.status, to);

  const from = delivery.status;
  delivery.status = to;
  const now = new Date();

  if (to === 'accepted') delivery.acceptedAt = now;
  if (to === 'picked_up') delivery.pickedUpAt = now;
  if (to === 'delivered') delivery.deliveredAt = now;
  if (to === 'failed') { delivery.failedAt = now; delivery.failureReason = notes; }

  // The assignment-time code is stale by the time the van leaves: its 10-minute TTL
  // started at assignment, and `verifyDeliveryOtp` hard-rejects expired codes, so the
  // handover would be permanently stuck. Minting a fresh code at out_for_delivery —
  // the only status where verify is allowed — keeps every code within its TTL and
  // delivers it exactly when the customer needs it.
  let issuedOtp;
  if (to === 'out_for_delivery' && !delivery.otpVerified) {
    issuedOtp = await issueDeliveryOtp(delivery);
  }

  await delivery.save();
  await syncOrderLifecycle(delivery, to, { actor });

  socketEmitter.emitToRoom(`store-order:${String(delivery.order).toLowerCase()}`, 'deliveryStatus', {
    orderId: String(delivery.order),
    deliveryId: String(delivery._id),
    from,
    deliveryStatus: to,
    at: now.toISOString(),
  });

  const events = {
    accepted: 'driver_on_the_way',
    out_for_delivery: 'out_for_delivery',
    delivered: 'order_delivered',
    failed: 'delivery_failed',
    cancelled: 'delivery_failed',
  };
  const event = events[to];
  if (event) {
    await notifyDelivery(delivery, event, {
      reason: notes || (to === 'cancelled' ? 'Delivery was cancelled.' : ''),
    });
  }
  if (issuedOtp) await pushDeliveryOtp(delivery, issuedOtp);

  return delivery;
};

const verifyDeliveryOtp = async (deliveryId, otp, { actor, outlet, driver } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findOne(deliveryFilter(deliveryId, { outlet, driver }));
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  if (delivery.status !== 'out_for_delivery') throw new ApiError(httpStatus.CONFLICT, 'Delivery is not out for delivery');
  if (new Date() > delivery.otpExpiresAt) throw new ApiError(httpStatus.CONFLICT, 'OTP has expired');
  if (delivery.otpAttempts >= delivery.maxOtpAttempts) throw new ApiError(httpStatus.CONFLICT, 'Maximum OTP attempts exceeded');

  delivery.otpAttempts += 1;

  if (delivery.otpHash !== hashOtp(otp)) {
    await delivery.save();
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid OTP');
  }

  delivery.otpVerified = true;
  delivery.otpVerifiedAt = new Date();
  await delivery.save();

  // Return the TRANSITIONED document. Returning `delivery` here hands the caller the
  // pre-transition snapshot: the row reads `delivered` but the response says
  // `out_for_delivery`, so the driver app never sees the handover complete.
  return transitionDelivery(deliveryId, 'delivered', { actor, outlet, driver });
};

const collectCod = async (deliveryId, amount, { outlet } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findOne(deliveryFilter(deliveryId, { outlet }));
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  if (delivery.status !== 'delivered') throw new ApiError(httpStatus.CONFLICT, 'Delivery not completed');
  if (delivery.codStatus !== 'pending') throw new ApiError(httpStatus.CONFLICT, 'COD already collected');
  if (!(Number(amount) > 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'COD amount must be positive');
  if (!(Number(delivery.codAmount) > 0)) throw new ApiError(httpStatus.CONFLICT, 'Delivery is not a COD delivery');
  if (Number(amount) > Number(delivery.codAmount)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'COD_COLLECTION_EXCEEDS_DUE: amount is above the order COD due');
  }

  delivery.codCollected = amount;
  delivery.codStatus = 'collected';
  delivery.codCollectedAt = new Date();
  await delivery.save();

  await syncCodOrder(delivery, 'collected');
  return delivery;
};

const reconcileCod = async (deliveryId, { outlet } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findOne(deliveryFilter(deliveryId, { outlet }));
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  if (delivery.codStatus !== 'collected') throw new ApiError(httpStatus.CONFLICT, 'COD not collected');

  delivery.codStatus = 'reconciled';
  await delivery.save();

  await syncCodOrder(delivery, 'reconciled');
  return delivery;
};

const getDeliveryByOrder = async (orderId, { outlet } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const filter = { order: orderId };
  if (outlet) filter.outlet = outlet;
  const delivery = await StoreDelivery.findOne(filter)
    .populate('driver', 'driverCode user')
    .lean();
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  return delivery;
};

const getDeliveryById = async (deliveryId, { outlet, driver } = {}) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const delivery = await StoreDelivery.findOne(deliveryFilter(deliveryId, { outlet, driver }))
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
  resendDeliveryOtp,
  getDeliveryByOrder,
  getDeliveryById,
  listDeliveries,
  getAvailableDrivers,
  assertTransition,
  sanitizeDelivery,
  DELIVERY_TRANSITIONS,
  generateOtp,
  hashOtp,
};