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
const driverService = require('../services/stores.driver.service');

const createDriver = catchAsync(async (req, res) => {
  const driver = await driverService.createDriver({
    ...req.body,
    outlet: req.outletId,
    chain: req.chainId,
  });
  res.status(httpStatus.CREATED).send({ driver });
});

const updateDriver = catchAsync(async (req, res) => {
  const driver = await driverService.updateDriver(req.params.driver, req.body);
  res.status(httpStatus.OK).send({ driver });
});

const deactivateDriver = catchAsync(async (req, res) => {
  const driver = await driverService.deactivateDriver(req.params.driver, {
    reason: req.body.reason,
    deactivatedBy: req.user._id,
  });
  res.status(httpStatus.OK).send({ driver });
});

const suspendDriver = catchAsync(async (req, res) => {
  const driver = await driverService.suspendDriver(req.params.driver, { reason: req.body.reason });
  res.status(httpStatus.OK).send({ driver });
});

const reactivateDriver = catchAsync(async (req, res) => {
  const driver = await driverService.reactivateDriver(req.params.driver);
  res.status(httpStatus.OK).send({ driver });
});

const getDriver = catchAsync(async (req, res) => {
  const driver = await driverService.getDriver(req.params.driver);
  res.status(httpStatus.OK).send({ driver });
});

const listDrivers = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'page', 'limit']);
  const result = await driverService.listDrivers({ ...filter, outlet: req.outletId });
  res.status(httpStatus.OK).send(result);
});

const toggleAvailability = catchAsync(async (req, res) => {
  const driver = await driverService.toggleAvailability(req.params.driver, req.body.isAvailable);
  res.status(httpStatus.OK).send({ driver });
});

module.exports = {
  createDriver,
  updateDriver,
  deactivateDriver,
  suspendDriver,
  reactivateDriver,
  getDriver,
  listDrivers,
  toggleAvailability,
};