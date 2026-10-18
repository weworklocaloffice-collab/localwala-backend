/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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
const fleetService = require('../services/dairy.fleet.service');
const deliveryRunService = require('../../../kernel/delivery/services/delivery.run.service');

/**
 * A rider's own money: what they earned, and the cash they are holding.
 *
 * Every handler resolves the rider from the signed-in user, never from a path or
 * query parameter. That is the whole security property of these routes - there is
 * no id to tamper with because no id is accepted.
 */

/**
 * The rider's `DairyDriver` record for whoever is signed in.
 *
 * Throws 403 rather than 404: an account with the rider role but no driver
 * profile is a setup problem, not a missing row, and saying "not found" would
 * send the rider looking in the wrong place.
 *
 * @returns {Promise<Document>}
 */
const ownDriverRecord = async (req) => {
  const driver = await deliveryRunService.getDriverIdForUser(req.user._id);
  return driver;
};

/**
 * Earnings for a window.
 *
 * @returns {Object} earnings
 */
const earnings = catchAsync(async (req, res) => {
  const driverId = await ownDriverRecord(req);
  const result = await fleetService.getDriverEarnings(driverId, req.query);
  res.send({ earnings: result });
});

/**
 * Cash collected and not yet handed over.
 *
 * @returns {Object} cashInHand
 */
const cashInHand = catchAsync(async (req, res) => {
  const driverId = await ownDriverRecord(req);
  const result = await fleetService.getCashInHand(driverId, req.query);
  res.send({ cashInHand: result });
});

/**
 * Records cash handed to the depot.
 *
 * @returns {Object} deposit
 */
const cashDeposit = catchAsync(async (req, res) => {
  const driverId = await ownDriverRecord(req);
  const result = await fleetService.recordCashDeposit(driverId, req.body);
  res.send({ deposit: result.deposit });
});

module.exports = {
  earnings,
  cashInHand,
  cashDeposit,
};