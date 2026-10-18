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
const settlementService = require('../services/stores.settlement.service');

const generateSettlement = catchAsync(async (req, res) => {
  const settlement = await settlementService.generateSettlement({
    vertical: 'stores',
    counterpartyType: 'store_owner',
    ...req.body,
  });
  if (!settlement) {
    return res.status(httpStatus.OK).send({ message: 'No orders found for settlement period' });
  }
  res.status(httpStatus.CREATED).send({ settlement });
});

const getSettlement = catchAsync(async (req, res) => {
  const settlement = await settlementService.getSettlement(req.params.settlement);
  res.status(httpStatus.OK).send({ settlement });
});

const listSettlements = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'period', 'page', 'limit']);
  const result = await settlementService.listSettlements({ ...filter, vertical: 'stores' });
  res.status(httpStatus.OK).send(result);
});

const markSettled = catchAsync(async (req, res) => {
  const settlement = await settlementService.markSettled(req.params.settlement, {
    ...req.body,
    approvedBy: req.user._id,
  });
  res.status(httpStatus.OK).send({ settlement });
});

const markFailed = catchAsync(async (req, res) => {
  const settlement = await settlementService.markFailed(req.params.settlement, { failureReason: req.body.failureReason });
  res.status(httpStatus.OK).send({ settlement });
});

const reverseSettlement = catchAsync(async (req, res) => {
  const settlement = await settlementService.reverseSettlement(req.params.settlement, {
    reason: req.body.reason,
    approvedBy: req.user._id,
  });
  res.status(httpStatus.OK).send({ settlement });
});

module.exports = {
  generateSettlement,
  getSettlement,
  listSettlements,
  markSettled,
  markFailed,
  reverseSettlement,
};