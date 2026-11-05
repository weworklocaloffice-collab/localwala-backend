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
const orderService = require('../services/stores.order.service');

const createOrder = catchAsync(async (req, res) => {
  const order = await orderService.createOrder({
    ...req.body,
    customer: req.user._id,
    outlet: req.outletId,
    chain: req.chainId,
  });
  res.status(httpStatus.CREATED).send({ order });
});

const getOrder = catchAsync(async (req, res) => {
  const order = await orderService.getOrder(req.params.order, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ order });
});

const listOrders = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['lifecycle', 'page', 'limit']);
  const result = await orderService.listOrders({ ...filter, outlet: req.outletId });
  res.status(httpStatus.OK).send(result);
});

const transitionOrder = catchAsync(async (req, res) => {
  const order = await orderService.transitionOrder(req.params.order, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
    outlet: req.outletId,
  });
  res.status(httpStatus.OK).send({ order });
});

const cancelOrder = catchAsync(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.order, {
    reason: req.body.reason,
    cancelledBy: 'store',
    cancelledByUserId: req.user._id,
    outlet: req.outletId,
  });
  res.status(httpStatus.OK).send({ order });
});

const rejectOrder = catchAsync(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.order, {
    reason: req.body.reason,
    cancelledBy: 'store',
    cancelledByUserId: req.user._id,
    outlet: req.outletId,
    target: 'rejected',
  });
  res.status(httpStatus.OK).send({ order });
});

const editOrder = catchAsync(async (req, res) => {
  const order = await orderService.editOrder(req.params.order, {
    items: req.body.items,
    outlet: req.outletId,
    customer: req.user._id,
  });
  res.status(httpStatus.OK).send({ order });
});

const listCustomers = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const result = await orderService.listCustomers({ outlet: req.outletId, page, limit });
  res.status(httpStatus.OK).send(result);
});

module.exports = {
  createOrder,
  editOrder,
  getOrder,
  listOrders,
  listCustomers,
  transitionOrder,
  cancelOrder,
  rejectOrder,
};