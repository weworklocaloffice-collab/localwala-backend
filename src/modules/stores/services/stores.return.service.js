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
const inventoryService = require('./stores.inventory.service');

const RETURN_TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['picked_up', 'rejected', 'cancelled'],
  picked_up: ['received', 'cancelled'],
  received: ['refunded', 'cancelled'],
  refunded: [],
  rejected: [],
  cancelled: [],
};

const EXCHANGE_TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['picked_up', 'rejected', 'cancelled'],
  picked_up: ['received', 'cancelled'],
  received: ['exchanged', 'cancelled'],
  exchanged: [],
  rejected: [],
  cancelled: [],
};

const assertTransition = (from, to, type = 'return') => {
  const table = type === 'return' ? RETURN_TRANSITIONS : EXCHANGE_TRANSITIONS;
  const allowed = table[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_${type.toUpperCase()}_MOVE: ${from} -> ${to} is not allowed`);
  }
};

const createReturnRequest = async ({ order, outlet, chain, customer, items, reason, reasonCategory, images, notes }) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const totalRefundAmount = items.reduce((sum, item) => sum + item.refundAmount, 0);

  return StoreReturnRequest.create({
    order,
    outlet,
    chain,
    customer,
    items,
    reason,
    reasonCategory,
    totalRefundAmount,
    refundMethod: 'original_payment',
    images,
    notes,
    status: 'requested',
  });
};

const transitionReturn = async (returnId, to, { actor, notes } = {}) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const req = await StoreReturnRequest.findById(returnId);
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Return request not found');

  assertTransition(req.status, to, 'return');

  req.status = to;
  const now = new Date();

  if (to === 'approved') { req.approvedAt = now; req.approvedBy = actor; }
  if (to === 'picked_up') req.pickedUpAt = now;
  if (to === 'received') req.receivedAt = now;
  if (to === 'refunded') req.refundedAt = now;
  if (to === 'rejected') { req.rejectedAt = now; req.rejectionReason = notes; }

  await req.save();
  return req;
};

const createExchangeRequest = async ({ order, outlet, chain, customer, items, reason, reasonCategory, images, notes }) => {
  const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
  const totalPriceDifference = items.reduce((sum, item) => sum + item.priceDifference, 0);
  const paymentRequired = totalPriceDifference > 0;

  return StoreExchangeRequest.create({
    order,
    outlet,
    chain,
    customer,
    items,
    reason,
    reasonCategory,
    totalPriceDifference,
    paymentRequired,
    paymentAmount: paymentRequired ? totalPriceDifference : 0,
    paymentStatus: paymentRequired ? 'pending' : 'not_required',
    images,
    notes,
    status: 'requested',
  });
};

const transitionExchange = async (exchangeId, to, { actor, notes } = {}) => {
  const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
  const req = await StoreExchangeRequest.findById(exchangeId);
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Exchange request not found');

  assertTransition(req.status, to, 'exchange');

  req.status = to;
  const now = new Date();

  if (to === 'approved') { req.approvedAt = now; req.approvedBy = actor; }
  if (to === 'picked_up') req.pickedUpAt = now;
  if (to === 'received') req.receivedAt = now;
  if (to === 'exchanged') req.exchangedAt = now;
  if (to === 'rejected') { req.rejectedAt = now; req.rejectionReason = notes; }

  await req.save();
  return req;
};

const processReturnRefund = async (returnId, { refundReference }) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const req = await StoreReturnRequest.findById(returnId);
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Return request not found');
  if (req.status !== 'received') throw new ApiError(httpStatus.CONFLICT, 'Return must be received before refund');

  for (const item of req.items) {
    await inventoryService.adjustStock({
      outlet: req.outlet,
      chain: req.chain,
      variant: item.variant,
      product: item.product,
      type: 'RETURNED',
      quantity: item.quantity,
      reason: 'Customer return',
      referenceType: 'return',
      referenceId: req._id,
    });
  }

  req.status = 'refunded';
  req.refundedAt = new Date();
  req.refundReference = refundReference;
  await req.save();
  return req;
};

const getReturnRequest = async (returnId) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const req = await StoreReturnRequest.findById(returnId)
    .populate('customer', 'name mobile email')
    .populate('order', 'orderNo grandTotal')
    .lean();
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Return request not found');
  return req;
};

const listReturns = async ({ outlet, customer, status, page = 1, limit = 20 }) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreReturnRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreReturnRequest.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

module.exports = {
  createReturnRequest,
  transitionReturn,
  createExchangeRequest,
  transitionExchange,
  processReturnRefund,
  getReturnRequest,
  listReturns,
  assertTransition,
  RETURN_TRANSITIONS,
  EXCHANGE_TRANSITIONS,
};