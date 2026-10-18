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
  const order = await orderService.getOrder(req.params.order);
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
  });
  res.status(httpStatus.OK).send({ order });
});

const cancelOrder = catchAsync(async (req, res) => {
  const order = await orderService.cancelOrder(req.params.order, {
    reason: req.body.reason,
    cancelledBy: req.body.cancelledBy || 'customer',
    cancelledByUserId: req.user._id,
  });
  res.status(httpStatus.OK).send({ order });
});

module.exports = {
  createOrder,
  getOrder,
  listOrders,
  transitionOrder,
  cancelOrder,
};