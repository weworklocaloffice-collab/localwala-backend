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
const ApiError = require('../../../utils/ApiError');
const holdService = require('../services/realestate.hold.service');
const holdRefundService = require('../services/realestate.hold.refund.service');
const saleService = require('../services/realestate.sale.service');
const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');

/**
 * Customer hold endpoints — place, view, cancel, convert.
 *
 * Every read and write is scoped to `req.user.id`. A hold id in the
 * path is checked against the hold's customer and answered 404 (not
 * 403) on mismatch, so the endpoint cannot confirm another customer's hold exists.
 * Money moves through the EXISTING payment stack: this controller
 * creates holds and refunds in PENDING states; the payment
 * controller's `property_hold` / `property_hold_refund` branches
 * activate and complete them on gateway confirm.
 */

const requireCustomer = (req) => {
  if (!req.user || !req.user.id) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in to hold a property');
  }
  return req.user.id;
};

const notFound = () => {
  throw new ApiError(httpStatus.NOT_FOUND, 'Hold not found');
};

async function loadOwnHold(holdId, customerId) {
  const hold = await RealEstatePropertyHold.findById(holdId);
  if (!hold || String(hold.customer) !== String(customerId)) notFound();
  return hold;
}

/**
 * POST /customer/holds — PENDING_PAYMENT. The second hold on a held
 * property fails on the BR-12 partial unique index: rejected, not queued.
 */
const createHold = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const hold = await holdService.createHold({
    property: req.body.property,
    customer: customerId,
    lead: req.body.lead || null,
  });
  res.status(httpStatus.CREATED).send({ data: hold });
});

const listMyHolds = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const holds = await RealEstatePropertyHold.find({ customer: customerId }).sort({ createdAt: -1 }).limit(50);
  res.status(httpStatus.OK).send({ results: holds });
});

const getMyHold = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const hold = await loadOwnHold(req.params.id, customerId);
  res.status(httpStatus.OK).send({ data: hold });
});

/**
 * POST /customer/holds/:id/cancel — creates the PENDING refund per
 * the §6.2 matrix (principal YES, fee NO). The payout completes via
 * the `property_hold_refund` payment branch.
 */
const cancelHold = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const hold = await loadOwnHold(req.params.id, customerId);
  if (!['PENDING_PAYMENT', 'ACTIVE'].includes(hold.status)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Hold is ${hold.status} and cannot be cancelled.`);
  }
  // F-11: request creates the refund row and flips the hold — one unit.
  const refund = await withOptionalTransaction((session) =>
    holdRefundService.requestRefund(hold._id, 'CANCELLATION', customerId, session)
  );
  res.status(httpStatus.OK).send({ data: refund });
});

/**
 * POST /customer/holds/:id/pay — initiate the gateway payment for a
 * PENDING_PAYMENT hold. Returns the initiation id as `payLink`, which
 * the app opens in the shared MakePayment screen
 * (`v1/public/payments/makePayment/:id`). On gateway confirm the
 * `property_hold` branch runs `activateHold` (2 ledger rows).
 *
 * OD-01: throws while no APPROVED custodial arrangement is in force —
 * live collection stays disabled until custody is approved. Safe to
 * retry: an existing `initiated` initiation is returned, not duplicated.
 */
const payHold = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const holdPaymentService = require('../services/realestate.hold.payment.service');
  const { hold, initiation } = await holdPaymentService.initiateHoldPayment({
    holdId: req.params.id,
    customerId,
    paymentConfigId: req.body.payment || null,
  });
  res.status(httpStatus.CREATED).send({ data: hold, payLink: String(initiation._id) });
});

/**
 * POST /customer/holds/:id/convert_to_sale — plan §7.3 named route.
 * Principal is applied against the consideration, never revenue (§6.2).
 */
const convertToSale = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const hold = await loadOwnHold(req.params.id, customerId);
  // F-11: conversion writes sale + hold flip + commissions + ledger — one unit.
  const { sale, commissions } = await withOptionalTransaction((session) =>
    saleService.recordSale(
      {
        property: hold.property,
        customer: customerId,
        lead: hold.lead || null,
        holdId: hold._id,
        saleValue: req.body.saleValue,
        transactionType: req.body.transactionType || 'BUY',
      },
      session
    )
  );
  res.status(httpStatus.CREATED).send({ data: { sale, commissions } });
});

module.exports = {
  createHold,
  listMyHolds,
  getMyHold,
  cancelHold,
  payHold,
  convertToSale,
};
