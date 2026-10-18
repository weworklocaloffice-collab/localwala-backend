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
const analyticsService = require('../services/stores.analytics.service');

const getOutletDashboard = catchAsync(async (req, res) => {
  const dashboard = await analyticsService.getOutletDashboard(req.outletId, req.query);
  res.status(httpStatus.OK).send(dashboard);
});

const getChainAnalytics = catchAsync(async (req, res) => {
  const analytics = await analyticsService.getChainAnalytics(req.chainId, req.query);
  res.status(httpStatus.OK).send(analytics);
});

module.exports = {
  getOutletDashboard,
  getChainAnalytics,
};