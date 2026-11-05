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

const mongoose = require('mongoose');
const {
  DairyOrder,
  DairyDriver,
  DeliveryRun,
  DeliveryStop,
} = require('../../../models');
const dairyOrderService = require('./dairy.order.service');

/**
 * Read-only operations monitoring for the admin console.
 *
 * The admin previously had governance only (approve outlets, settle money,
 * flip the vertical switch) and no way to *watch* the vertical work: live
 * orders, delivery runs, the rider fleet. Everything here is a read with
 * populated context — no mutation belongs in this file.
 */

const ORDER_STATUSES = ['pending_payments', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'];
const RUN_STATUSES = ['planned', 'dispatched', 'in_progress', 'completed', 'cancelled'];

const paginate = (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  return { limit, page, skip: (page - 1) * limit };
};

const dateRange = (options, field) => {
  if (!options.from && !options.to) return undefined;
  const range = {};
  if (options.from) range.$gte = new Date(options.from);
  if (options.to) range.$lte = new Date(options.to);
  return { [field]: range };
};

/** Every dairy order in the platform, with status counts for the header chips. */
const listOrders = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = {};
  if (options.status) query.status = options.status;
  if (options.business) query.business = new mongoose.Types.ObjectId(options.business);
  const createdAt = dateRange(options, 'createdAt');
  if (createdAt) Object.assign(query, createdAt);
  if (options.search) {
    query.orderNo = { $regex: options.search, $options: 'i' };
  }

  const [orders, totalResults, statusCounts] = await Promise.all([
    DairyOrder.find(query)
      .populate('business', 'name businessModel verified')
      .populate('user', 'firstName lastName mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyOrder.countDocuments(query),
    DairyOrder.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    orders,
    totalResults,
    page,
    limit,
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.count])),
  };
};

/** One order in full, plus its append-only status history. */
const getOrderDetail = async (orderId) => {
  // No user/outlet scoping: an admin may read any order, which is the point
  // of an operator console. The customer and partner read paths scope harder.
  const order = await dairyOrderService.getOrder(orderId);
  const history = await dairyOrderService.listHistory(orderId, { limit: 50 });
  return { order, history };
};

/** Delivery runs across all outlets — the morning's work at a glance. */
const listRuns = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = {};
  if (options.status) query.status = options.status;
  if (options.business) query.business = new mongoose.Types.ObjectId(options.business);
  const serviceDate = dateRange(options, 'serviceDate');
  if (serviceDate) Object.assign(query, serviceDate);

  const [runs, totalResults] = await Promise.all([
    DeliveryRun.find(query)
      .populate('business', 'name businessModel')
      .populate({ path: 'agent', select: 'user', populate: { path: 'user', select: 'firstName lastName mobile' } })
      .sort({ serviceDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DeliveryRun.countDocuments(query),
  ]);

  return { runs, totalResults, page, limit };
};

/** One run and its ordered stops — who got what, when, and for how much. */
const getRunDetail = async (runId) => {
  const run = await DeliveryRun.findById(runId)
    .populate('business', 'name businessModel')
    .populate({ path: 'agent', select: 'user', populate: { path: 'user', select: 'firstName lastName mobile' } });

  if (!run) {
    const ApiError = require('../../../utils/ApiError');
    throw new ApiError(404, 'Run not found');
  }

  const stops = await DeliveryStop.find({ run: run._id })
    .populate('customer', 'firstName lastName mobile')
    .populate('order', 'orderNo status grandTotal')
    .sort({ sequence: 1 });

  return { run, stops };
};

/** The rider fleet: every dairy rider, their outlet and standing. */
const listDrivers = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = {};
  if (options.business) query.business = new mongoose.Types.ObjectId(options.business);
  if (options.blocked !== undefined && options.blocked !== '') {
    query.isBlocked = options.blocked === true || options.blocked === 'true';
  }

  const [drivers, totalResults] = await Promise.all([
    DairyDriver.find(query)
      .populate('user', 'firstName lastName mobile')
      .populate('business', 'name businessModel')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyDriver.countDocuments(query),
  ]);

  return { drivers, totalResults, page, limit };
};

module.exports = {
  ORDER_STATUSES,
  RUN_STATUSES,
  listOrders,
  getOrderDetail,
  listRuns,
  getRunDetail,
  listDrivers,
};
