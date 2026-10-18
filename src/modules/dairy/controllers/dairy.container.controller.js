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
const dairyContainerService = require('../services/dairy.container.service');

/**
 * Enrols a customer into rotation by reserving a pair of cans.
 *
 * @returns {Object} assignment
 */
const assignContainers = catchAsync(async (req, res) => {
  const assignment = await dairyContainerService.assignContainers({
    ...req.body,
    business: req.outletId,
    createdBy: req.outletId,
  });
  res.send({
    assignment: pick(assignment, ['_id', 'customer', 'cans', 'rotationSize', 'rotationGroup', 'status']),
  });
});

/**
 * Plans the rotation for one delivery.
 *
 * The rider calls this at the door to learn which can to collect and which to
 * hand over. Responds 409 when no sibling can is ready, which is a real
 * operational stop rather than a client error.
 *
 * @returns {Object} swap plan
 */
const planSwap = catchAsync(async (req, res) => {
  const plan = await dairyContainerService.planSwap({
    ...req.body,
    business: req.params.id,
  });
  res.send({
    collect: plan.collect ? pick(plan.collect, ['_id', 'canCode', 'condition']) : null,
    deliver: pick(plan.deliver, ['_id', 'canCode', 'condition']),
    rotationSize: plan.rotationSize,
    heldCount: plan.heldCount,
  });
});

/**
 * Confirms the swap after both scans.
 *
 * @returns {Object} assignment
 */
const completeSwap = catchAsync(async (req, res) => {
    const assignment = await dairyContainerService.completeSwap({
      ...req.body,
      assignment: req.params.assignment,
      // The rider who scanned, from the token. This used to read a path segment
      // that was never a user id, so every swap was attributed to `undefined`.
      createdBy: req.user._id,
    });
  res.send({ assignment: pick(assignment, ['_id', 'activeCan', 'lastCollectedCan', 'lastSwappedAt']) });
});

/**
 * Ends a rotation and returns cans to the pool.
 *
 * @returns {Object} result
 */
const releaseContainers = catchAsync(async (req, res) => {
  const result = await dairyContainerService.releaseContainers(req.params.assignment, {
    ...req.body,
    createdBy: req.outletId,
  });
  res.send({
    released: result.released,
    retained: result.retained,
    status: result.assignment.status,
  });
});

/**
 * Advances a can through wash → inspect → refill.
 *
 * @returns {Object} can
 */
const advanceLifecycle = catchAsync(async (req, res) => {
  const can = await dairyContainerService.advanceLifecycle(req.params.can, req.params.action, {
    ...req.body,
    createdBy: req.outletId,
  });
  res.send({ can: pick(can, ['_id', 'canCode', 'condition', 'status', 'currentHolder']) });
});

/**
 * Rotation state for one customer.
 *
 * @returns {Object} view
 */
const rotationView = catchAsync(async (req, res) => {
  const view = await dairyContainerService.getRotationView(req.query.customer, req.outletId);
  res.send({
    assignment: view.assignment
      ? pick(view.assignment, ['_id', 'rotationSize', 'rotationGroup', 'activeCan', 'status'])
      : null,
    cans: view.cans,
    withCustomer: view.withCustomer || 0,
    inService: view.inService || 0,
    inWash: view.inWash || 0,
    quarantined: view.quarantined || 0,
  });
});

/**
 * Container counts by lifecycle state, for the dairy-unit wash dashboard.
 *
 * @returns {Object} summary
 */
const lifecycleSummary = catchAsync(async (req, res) => {
  const summary = await dairyContainerService.getLifecycleSummary(req.outletId);
  res.send(summary);
});

module.exports = {
  assignContainers,
  planSwap,
  completeSwap,
  releaseContainers,
  advanceLifecycle,
  rotationView,
  lifecycleSummary,
};