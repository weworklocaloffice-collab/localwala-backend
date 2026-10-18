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

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const remittanceService = require('../services/stores.remittance.service');

const listRemittances = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['driver', 'status', 'dateFrom', 'dateTo', 'page', 'limit']);
  if (req.outletId) filter.outlet = req.outletId;
  const result = await remittanceService.listRemittances(filter);
  res.status(httpStatus.OK).send(result);
});

const submitRemittance = catchAsync(async (req, res) => {
  const remittance = await remittanceService.submitRemittance({
    remittanceId: req.params.remittance,
    collected: req.body.collected,
    remitted: req.body.remitted,
    notes: req.body.notes,
    actor: req.user._id,
  });
  res.status(httpStatus.OK).send({ remittance });
});

const reconcileRemittance = catchAsync(async (req, res) => {
  const remittance = await remittanceService.reconcileRemittance({
    remittanceId: req.params.remittance,
    actor: req.user._id,
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ remittance });
});

const getPending = catchAsync(async (req, res) => {
  const pending = await remittanceService.getPendingRemittances(req.outletId);
  res.status(httpStatus.OK).send({ pending });
});

module.exports = {
  listRemittances,
  submitRemittance,
  reconcileRemittance,
  getPending,
};