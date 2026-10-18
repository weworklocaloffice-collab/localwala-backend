/*
 * WeWorkLocal
 * Hyperlocal Commerce, Delivery & Service Platform
 *
 * Copyright © 2026 WeWorkLocal.
 * All Rights Reserved.
 *
 * Website: https://localwala.tech
 * Email: weworklocal1@gmail.com
 *
 * Proprietary and Confidential.
 *
 * Unauthorized copying, modification, distribution,
 * publication, resale, reverse engineering, or use of
 * this software without prior written authorization is
 * strictly prohibited.
 */

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const partnerService = require('../services/dairy.partner.service');
const fleetService = require('../services/dairy.fleet.service');
const subscriptionService = require('../services/dairy.subscription.service');

/**
 * The partner's own view of their outlet.
 *
 * Every handler here reads `req.outletId`, which `resolveOutlet` derives from the
 * access token. None accepts an outlet from the client, so there is no request
 * shape that reaches another outlet's data.
 */

// //// Subscriptions ////

/**
 * Plans sold by this outlet.
 *
 * @returns {Object} paginated subscriptions
 */
const subscriptionList = catchAsync(async (req, res) => {
  const result = await subscriptionService.listSubscriptions({
    ...req.query,
    // Last write wins, so a `?business=` in the query cannot widen the list.
    business: req.outletId,
  });
  res.send(pick(result, ['subscriptions', 'totalResults', 'page', 'limit']));
});

/**
 * Pauses a customer's plan.
 *
 * A partner may pause a plan on their own outlet - a delivery issue, a holiday -
 * but the operation is recorded against the signed-in partner, not a customer id
 * from the payload.
 */
const subscriptionPause = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.pause(req.params.subscription, {
    ...req.body,
    businessId: req.outletId,
    actor: req.user._id,
    actorType: 'partner',
  });
  res.send({ subscription });
});

const subscriptionResume = catchAsync(async (req, res) => {
  const subscription = await subscriptionService.resume(req.params.subscription, {
    ...req.body,
    businessId: req.outletId,
    actor: req.user._id,
    actorType: 'partner',
  });
  res.send({ subscription });
});

// //// Customers ////

/**
 * Everyone who buys from this outlet.
 *
 * @returns {Object} paginated customers
 */
const customerList = catchAsync(async (req, res) => {
  const result = await partnerService.listOutletCustomers(req.outletId, req.query);
  res.send(pick(result, ['customers', 'totalResults', 'page', 'limit']));
});

// //// Own fleet ////

/**
 * The outlet's riders.
 *
 * @returns {Object} paginated drivers
 */
const driverList = catchAsync(async (req, res) => {
  const result = await partnerService.listOutletDrivers(req.outletId, req.query);
  res.send(pick(result, ['drivers', 'totalResults', 'page', 'limit']));
});

// //// Fleet management ////

/**
 * Invites a rider to this outlet's fleet.
 *
 * The rider joins when they register with the invited number. Nothing is created
 * for them here: an invitation is a permission, not a half-made account.
 */
const driverInvite = catchAsync(async (req, res) => {
  const result = await fleetService.inviteRider(req.outletId, {
    ...req.body,
    invitedBy: req.user._id,
  });
  res.send(result);
});

const driverInvites = catchAsync(async (req, res) => {
  const invites = await fleetService.listInvites(req.outletId);
  res.send({ invites });
});

const driverInviteRevoke = catchAsync(async (req, res) => {
  const invite = await fleetService.revokeInvite(
    req.outletId,
    req.params.invite,
    req.body.reason
  );
  res.send({ invite });
});

/**
 * Approves or blocks a rider on this outlet's fleet.
 *
 * `approve` is a boolean in the body rather than two routes: they are one
 * decision with two outcomes.
 */
const driverApproval = catchAsync(async (req, res) => {
  const driver = await fleetService.setDriverApproval(
    req.outletId,
    req.params.driver,
    req.body.approve,
    { reason: req.body.reason }
  );
  res.send({ driver });
});

/** Detaches a rider from this fleet, keeping their history intact. */
const driverRemove = catchAsync(async (req, res) => {
  const driver = await fleetService.removeDriver(req.outletId, req.params.driver, {
    reason: req.body.reason,
  });
  res.send({ driver });
});

/** Pays a rider from the outlet's wallet. */
const driverPayout = catchAsync(async (req, res) => {
  const result = await fleetService.payDriver(req.outletId, req.params.driver, {
    ...req.body,
    actor: req.user._id,
    // So the notice can be addressed to the partner who pressed the button.
    partnerUserId: req.user._id,
  });
  res.send({
    payout: result.payout,
    rider: result.driver,
  });
});

// //// Money ////

/**
 * What the outlet has earned in a period.
 *
 * @returns {Object} earnings
 */
const earnings = catchAsync(async (req, res) => {
  const result = await partnerService.getOutletEarnings(req.outletId, req.query);
  res.send({ earnings: result });
});

/**
 * Settlements closed for this outlet.
 *
 * @returns {Object} paginated settlements
 */
const settlementList = catchAsync(async (req, res) => {
  const result = await partnerService.listOutletSettlements(req.outletId, req.query);
  res.send(pick(result, ['settlements', 'totalResults', 'page', 'limit']));
});

module.exports = {
  subscriptionList,
  subscriptionPause,
  subscriptionResume,
  customerList,
  driverList,
  driverInvite,
  driverInvites,
  driverInviteRevoke,
  driverApproval,
  driverRemove,
  driverPayout,
  earnings,
  settlementList,
};