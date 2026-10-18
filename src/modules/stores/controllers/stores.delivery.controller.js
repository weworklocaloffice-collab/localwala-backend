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
const deliveryService = require('../services/stores.delivery.service');

const assignDriver = catchAsync(async (req, res) => {
  const delivery = await deliveryService.assignDriver({
    ...req.body,
    outlet: req.outletId,
    chain: req.chainId,
  });
  res.status(httpStatus.CREATED).send({ delivery });
});

const transitionDelivery = catchAsync(async (req, res) => {
  const delivery = await deliveryService.transitionDelivery(req.params.delivery, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ delivery });
});

const verifyDeliveryOtp = catchAsync(async (req, res) => {
  const delivery = await deliveryService.verifyDeliveryOtp(req.params.delivery, req.body.otp);
  res.status(httpStatus.OK).send({ delivery });
});

const collectCod = catchAsync(async (req, res) => {
  const delivery = await deliveryService.collectCod(req.params.delivery, req.body.amount);
  res.status(httpStatus.OK).send({ delivery });
});

const reconcileCod = catchAsync(async (req, res) => {
  const delivery = await deliveryService.reconcileCod(req.params.delivery);
  res.status(httpStatus.OK).send({ delivery });
});

const getDelivery = catchAsync(async (req, res) => {
  const delivery = await deliveryService.getDelivery(req.params.order);
  res.status(httpStatus.OK).send({ delivery });
});

const listDeliveries = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['driver', 'status', 'page', 'limit']);
  const result = await deliveryService.listDeliveries({ ...filter, outlet: req.outletId });
  res.status(httpStatus.OK).send(result);
});

const getAvailableDrivers = catchAsync(async (req, res) => {
  const drivers = await deliveryService.getAvailableDrivers(req.outletId);
  res.status(httpStatus.OK).send({ drivers });
});

module.exports = {
  assignDriver,
  transitionDelivery,
  verifyDeliveryOtp,
  collectCod,
  reconcileCod,
  getDelivery,
  listDeliveries,
  getAvailableDrivers,
};