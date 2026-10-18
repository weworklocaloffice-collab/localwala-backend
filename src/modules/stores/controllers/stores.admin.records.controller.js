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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const pick = require('../../../utils/pick');
const recordsService = require('../services/stores.admin.records.service');
const reviewService = require('../services/stores.review.service');
const orderService = require('../services/stores.order.service');
const settlementService = require('../services/stores.settlement.service');
const returnService = require('../services/stores.return.service');
const driverService = require('../services/stores.driver.service');
const organicService = require('../services/stores.organic.service');

/**
 * Admin CRUD over partner-side records: orders, drivers, returns, promotions, reviews,
 * complaints, settlements, refunds, subscriptions.
 *
 * Reads go through `recordsService`, which is cross-tenant by construction. Mutations
 * delegate to the PARTNER service that owns the transition, so an admin action runs the
 * same guards a partner action does — there is no admin-only shortcut past a rule.
 */

// -- orders -------------------------------------------------------------------

const listOrders = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'search', 'lifecycle', 'outlet', 'chain', 'from', 'to']);
  const result = await recordsService.listOrders(filter);
  res.status(httpStatus.OK).send(result);
});

const getOrder = catchAsync(async (req, res) => {
  const order = await recordsService.getOrder(req.params.order);
  res.status(httpStatus.OK).send(order);
});

/**
 * An admin-driven status change.
 *
 * Delegates to the partner service so `assertTransition` applies. The alternative — an
 * admin-only writer that skips the table — is how a suspended partner's order ends up
 * quietly `completed`.
 */
const transitionOrder = catchAsync(async (req, res) => {
  const order = await orderService.transitionOrder(req.params.order, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ order });
});

// -- drivers ------------------------------------------------------------------

const listDrivers = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'search', 'status', 'outlet', 'chain']);
  const result = await recordsService.listDrivers(filter);
  res.status(httpStatus.OK).send(result);
});

const getDriver = catchAsync(async (req, res) => {
  const driver = await driverService.getDriver(req.params.driver);
  res.status(httpStatus.OK).send({ driver });
});

/**
 * BR-08: a driver is never hard-deleted. Suspend is the strongest admin action available,
 * and the record keeps resolving forever so historical deliveries still name a driver.
 */
const suspendDriver = catchAsync(async (req, res) => {
  const driver = await driverService.suspendDriver(req.params.driver, { reason: req.body.reason });
  res.status(httpStatus.OK).send({ driver });
});

const reactivateDriver = catchAsync(async (req, res) => {
  const driver = await driverService.reactivateDriver(req.params.driver);
  res.status(httpStatus.OK).send({ driver });
});

// -- returns / exchanges / warranties ------------------------------------------

const listPostOrderRequests = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'status', 'outlet', 'chain', 'kind']);
  const result = await recordsService.listReturns(filter);
  res.status(httpStatus.OK).send(result);
});

const transitionReturn = catchAsync(async (req, res) => {
  const request = await returnService.transitionReturn(req.params.return, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ request });
});

const transitionExchange = catchAsync(async (req, res) => {
  const request = await returnService.transitionExchange(req.params.exchange, req.params.status, {
    actor: req.user._id,
    notes: req.body.notes,
  });
  res.status(httpStatus.OK).send({ request });
});

const transitionWarranty = catchAsync(async (req, res) => {
  const StoreWarrantyRequest = mongoose.model('StoreWarrantyRequest');
  const request = await StoreWarrantyRequest.findById(req.params.warranty);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Warranty request not found');

  // No service owns warranty transitions yet, so the guard lives here rather than being
  // absent. An unvalidated status on a warranty is the same class of hole as an
  // unvalidated order status.
  const ALLOWED = ['approved', 'rejected', 'in_repair', 'resolved', 'closed', 'cancelled'];
  if (!ALLOWED.includes(req.params.status)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_WARRANTY_MOVE: ${req.params.status}`);
  }

  request.status = req.params.status;
  if (req.params.status === 'approved') {
    request.approvedAt = new Date();
    request.approvedBy = req.user._id;
  }
  if (req.params.status === 'resolved') request.resolvedAt = new Date();

  await request.save();
  res.status(httpStatus.OK).send({ request });
});

// -- promotions ---------------------------------------------------------------

const listPromotions = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'search', 'status', 'chain', 'approvalStatus']);
  const result = await recordsService.listPromotions(filter);
  res.status(httpStatus.OK).send(result);
});

const moderatePromotion = catchAsync(async (req, res) => {
  const promotion = await recordsService.moderatePromotion(req.params.promotion, {
    status: req.body.status,
    by: req.user._id,
    note: req.body.note,
  });
  res.status(httpStatus.OK).send({ promotion });
});

// -- reviews and complaints ----------------------------------------------------

const listReviews = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'status', 'outlet', 'chain', 'search']);
  const result = await recordsService.listReviews(filter);
  res.status(httpStatus.OK).send(result);
});

const moderateReview = catchAsync(async (req, res) => {
  const review = await reviewService.moderateReview(req.params.review, {
    status: req.body.status,
    reply: req.body.reply,
  });
  res.status(httpStatus.OK).send({ review });
});

const listComplaints = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'status', 'outlet', 'chain', 'search', 'priority']);
  const result = await recordsService.listComplaints(filter);
  res.status(httpStatus.OK).send(result);
});

const moderateComplaint = catchAsync(async (req, res) => {
  const complaint = await recordsService.moderateComplaint(req.params.complaint, {
    status: req.body.status,
    resolution: req.body.resolution,
    resolutionNotes: req.body.resolutionNotes,
    by: req.user._id,
  });
  res.status(httpStatus.OK).send({ complaint });
});

// -- settlements, refunds, subscriptions --------------------------------------

const listSettlements = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'status', 'counterparty', 'store', 'vertical']);
  const result = await recordsService.listSettlements(filter);
  res.status(httpStatus.OK).send(result);
});

const getSettlement = catchAsync(async (req, res) => {
  const settlement = await settlementService.getSettlement(req.params.settlement);
  res.status(httpStatus.OK).send({ settlement });
});

const markSettled = catchAsync(async (req, res) => {
  const settlement = await settlementService.markSettled(req.params.settlement, {
    ...req.body,
    approvedBy: req.user._id,
  });
  res.status(httpStatus.OK).send({ settlement });
});

const markFailed = catchAsync(async (req, res) => {
  const settlement = await settlementService.markFailed(req.params.settlement, {
    failureReason: req.body.failureReason,
  });
  res.status(httpStatus.OK).send({ settlement });
});

/**
 * A settled settlement is reversed, never deleted (BR-25) — a clawback is a NEW reversing
 * entry so the original remains auditable.
 */
const reverseSettlement = catchAsync(async (req, res) => {
  const settlement = await settlementService.reverseSettlement(req.params.settlement, {
    reason: req.body.reason,
    approvedBy: req.user._id,
  });
  res.status(httpStatus.OK).send({ settlement });
});

const listRefunds = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'status', 'outlet', 'chain', 'order']);
  const result = await recordsService.listRefunds(filter);
  res.status(httpStatus.OK).send(result);
});

const listSubscriptions = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'status', 'chain', 'business']);
  const result = await recordsService.listSubscriptions(filter);
  res.status(httpStatus.OK).send(result);
});

const listSubscriptionPayments = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'status', 'chain', 'subscription']);
  const result = await recordsService.listSubscriptionPayments(filter);
  res.status(httpStatus.OK).send(result);
});

// -- organic verification ------------------------------------------------------

const moderateOrganic = catchAsync(async (req, res) => {
  const verification = await organicService.reviewVerification(req.params.verification, {
    status: req.body.status,
    verifiedBy: req.user._id,
    note: req.body.note,
  });
  res.status(httpStatus.OK).send({ verification });
});

module.exports = {
  listOrders,
  getOrder,
  transitionOrder,
  listDrivers,
  getDriver,
  suspendDriver,
  reactivateDriver,
  listPostOrderRequests,
  transitionReturn,
  transitionExchange,
  transitionWarranty,
  listPromotions,
  moderatePromotion,
  listReviews,
  moderateReview,
  listComplaints,
  moderateComplaint,
  listSettlements,
  getSettlement,
  markSettled,
  markFailed,
  reverseSettlement,
  listRefunds,
  listSubscriptions,
  listSubscriptionPayments,
  moderateOrganic,
};