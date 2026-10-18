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
const payableService = require('../services/dairy.provider.payable.service');

// //// Read ////

const payableDetail = catchAsync(async (req, res) => {
  const payable = await payableService.getPayable(req.params.id, req.outletId);
  res.send({ payable });
});

const payableList = catchAsync(async (req, res) => {
  const result = await payableService.listPayables({
    ...req.query,
    // From the token, not a query the caller could widen.
    business: req.outletId,
  });
  res.send(pick(result, ['payables', 'totalResults', 'page', 'limit']));
});

// //// Generate ////

/**
 * Freezes a period into a draft statement.
 *
 * Generated as a draft on purpose: a provider should see the figure and be able to
 * dispute it before the platform approves and pays.
 */
const payableGenerate = catchAsync(async (req, res) => {
  const payable = await payableService.generatePayable({
    business: req.outletId,
    ...req.body,
  });
  res.send({ payable });
});

// //// Adjust ////

const payableAdjust = catchAsync(async (req, res) => {
  const payable = await payableService.addAdjustment(req.params.id, {
    ...req.body,
    // The operator is whoever is signed in, never the payload.
    recordedBy: req.user._id,
    // The outlet is the token's, never the payload's.
    business: req.outletId,
  });
  res.send({ payable });
});

// //// Status ////

/**
 * Approve, dispute or void.
 *
 * `status` is constrained by the route rather than the body, and the service
 * enforces the transition table, so a client cannot jump a statement straight to
 * `paid` through this path.
 */
const payableStatus = catchAsync(async (req, res) => {
  const payable = await payableService.updateStatus(req.params.id, req.params.status, {
    reason: req.body.reason,
    actor: req.user._id,
    business: req.outletId,
  });
  res.send({ payable });
});

const payableVoid = catchAsync(async (req, res) => {
  const payable = await payableService.voidPayable(req.params.id, {
    reason: req.body.reason,
    actor: req.user._id,
    business: req.outletId,
  });
  res.send({ payable });
});

/** Settles the statement and the collections behind it. */
const payablePay = catchAsync(async (req, res) => {
  const payable = await payableService.payPayable(req.params.id, {
    reference: req.body.reference,
    business: req.outletId,
  });
  res.send({ payable });
});

module.exports = {
  payableDetail,
  payableList,
  payableGenerate,
  payableAdjust,
  payableStatus,
  payableVoid,
  payablePay,
};
