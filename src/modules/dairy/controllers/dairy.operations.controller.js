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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const dairyOperationsService = require('../services/dairy.operations.service');

// //// Operations monitoring — read-only, admin console ////

const orderList = catchAsync(async (req, res) => {
  const result = await dairyOperationsService.listOrders(req.query);
  res.send(pick(result, ['orders', 'totalResults', 'page', 'limit', 'statusCounts']));
});

const orderDetail = catchAsync(async (req, res) => {
  const detail = await dairyOperationsService.getOrderDetail(req.params.order);
  res.send(detail);
});

const runList = catchAsync(async (req, res) => {
  const result = await dairyOperationsService.listRuns(req.query);
  res.send(pick(result, ['runs', 'totalResults', 'page', 'limit']));
});

const runDetail = catchAsync(async (req, res) => {
  const detail = await dairyOperationsService.getRunDetail(req.params.run);
  res.send(detail);
});

const driverList = catchAsync(async (req, res) => {
  const result = await dairyOperationsService.listDrivers(req.query);
  res.send(pick(result, ['drivers', 'totalResults', 'page', 'limit']));
});

module.exports = {
  orderList,
  orderDetail,
  runList,
  runDetail,
  driverList,
};
