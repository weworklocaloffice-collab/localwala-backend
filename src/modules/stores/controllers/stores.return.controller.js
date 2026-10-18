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
const returnService = require('../services/stores.return.service');

const createReturnRequest = catchAsync(async (req, res) => {
  const request = await returnService.createReturnRequest({
    ...req.body,
    outlet: req.outletId,
    chain: req.chainId,
    customer: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ request });
});

const transitionReturn = catchAsync(async (req, res) => {
  const request = await returnService.transitionReturn(req.params.return, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ request });
});

const processReturnRefund = catchAsync(async (req, res) => {
  const request = await returnService.processReturnRefund(req.params.return, {
    refundReference: req.body.refundReference,
  });
  res.status(httpStatus.OK).send({ request });
});

const createExchangeRequest = catchAsync(async (req, res) => {
  const request = await returnService.createExchangeRequest({
    ...req.body,
    outlet: req.outletId,
    chain: req.chainId,
    customer: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ request });
});

const transitionExchange = catchAsync(async (req, res) => {
  const request = await returnService.transitionExchange(req.params.exchange, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ request });
});

const getReturnRequest = catchAsync(async (req, res) => {
  const request = await returnService.getReturnRequest(req.params.return);
  res.status(httpStatus.OK).send({ request });
});

const listReturns = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'page', 'limit']);
  const result = await returnService.listReturns({ ...filter, outlet: req.outletId });
  res.status(httpStatus.OK).send(result);
});

module.exports = {
  createReturnRequest,
  transitionReturn,
  processReturnRefund,
  createExchangeRequest,
  transitionExchange,
  getReturnRequest,
  listReturns,
};