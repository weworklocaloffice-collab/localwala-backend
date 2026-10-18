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
const { DairyCan, DairyCanLedger, DairyContainerAssignment, DairySku } = require('../../../models');
const ApiError = require('../../../utils/ApiError');

/**
 * Container rotation and lifecycle.
 *
 * Two-bottle rotation, for reusable-container recurring milk deliveries only:
 *
 *   Day 1   A → customer
 *   Day 2   A ← customer   B → customer
 *   Day 3   B ← customer   A → customer
 *
 * One can sits with the customer while the other is collected, washed, refilled
 * and returned to service. Alternate-day plans work identically — the rotation
 * follows the customer's actual schedule, not a fixed daily cadence.
 *
 * Packaged dairy (curd, ghee, butter, paneer, cheese, cream) has
 * `DairySku.reusableContainer === false`, gets no assignment, and is issued from
 * the general pool. One-time orders are never rotated even for milk: a customer
 * buying a single can is not enrolled in a cycle.
 */

/**
 * Legal lifecycle transitions, mirroring the specification:
 * cleaning → inspection → refill → back in rotation.
 *
 *   ready → issued → dirty → washing → washed → refilled → ready
 *
 * `quarantined` is a failed inspection and must never reach `ready`, which is why
 * `refilled → issued` is absent: there is no path out of quarantine that skips
 * the wash line.
 */
const LIFECYCLE_TRANSITIONS = {
  ready: ['issued', 'quarantined', 'scrapped'],
  issued: ['dirty', 'quarantined', 'scrapped'],
  dirty: ['washing', 'quarantined', 'scrapped'],
  washing: ['washed', 'quarantined', 'scrapped'],
  washed: ['refilled', 'quarantined'],
  refilled: ['ready', 'quarantined', 'scrapped'],
  quarantined: ['washing', 'scrapped'],
  scrapped: [],
};

/**
 * Asserts a lifecycle move is legal and returns the target state.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string} next condition
 */
const assertTransition = (from, to) => {
  const allowed = LIFECYCLE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Illegal container lifecycle move: ${from} -> ${to}. Allowed from ${from}: ${allowed.join(', ') || 'none'}`
    );
  }
  return to;
};

/**
 * Appends a lifecycle event to the can ledger.
 *
 * Lifecycle events deliberately do NOT touch `currentHolder` — custody and
 * lifecycle are independent axes.
 *
 * @param {Object} can
 * @param {string} eventType
 * @param {Object} param
 */
const recordLifecycle = async (can, eventType, param) => {
  return DairyCanLedger.create({
    can: can._id,
    business: can.business,
    eventType,
    clientRef: param.clientRef,
    run: param.run,
    stop: param.stop,
    customer: param.customer || can.assignedTo?.ref,
    agent: param.agent,
    note: param.note,
    createdBy: param.createdBy,
  });
};

/**
 * Whether a SKU participates in rotation at all.
 *
 * @param {string} skuId
 * @returns {Promise<{reusable: boolean, rotationSize: number, sku: Object}>}
 */
const getRotationPolicy = async (skuId) => {
  const sku = await DairySku.findById(skuId);
  if (!sku) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return {
    reusable: sku.reusableContainer === true,
    rotationSize: sku.rotationSize || 2,
    sku,
  };
};

/**
 * Enrols a customer into rotation by reserving cans for them.
 *
 * Refuses when the SKU is not reusable, or when the customer already has an
 * active assignment — two overlapping assignments would let the same can be
 * promised to two deliveries.
 *
 * @param {Object} param
 * @returns {Promise<Object>} assignment
 */
const assignContainers = async (param) => {
  const policy = await getRotationPolicy(param.sku);
  if (!policy.reusable) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This product is not supplied in reusable containers, so no rotation applies'
    );
  }

  const existing = await DairyContainerAssignment.findOne({
    customer: new mongoose.Types.ObjectId(param.customer),
    business: new mongoose.Types.ObjectId(param.business),
    status: 'active',
  });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Customer already has an active container assignment');
  }

  const rotationGroup = `RG-${param.customer}-${Date.now().toString(36).toUpperCase()}`;

  // Reserve cans that are unassigned and already in service.
  const cans = await DairyCan.find({
    business: new mongoose.Types.ObjectId(param.business),
    'assignedTo.type': null,
    condition: 'ready',
  })
    .sort({ lastMovementAt: 1 })
    .limit(policy.rotationSize);

  if (cans.length < policy.rotationSize) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Needs ${policy.rotationSize} ready cans to start a rotation but only ${cans.length} are unassigned and in service`
    );
  }

  const canIds = cans.map((c) => c._id);

  const assignment = await DairyContainerAssignment.create({
    customer: param.customer,
    subscription: param.subscription,
    business: param.business,
    cans: canIds,
    rotationSize: policy.rotationSize,
    rotationGroup,
    status: 'active',
  });

  for (const can of cans) {
    can.assignedTo = { type: 'customer', ref: param.customer };
    can.rotationGroup = rotationGroup;
    await can.save();
    await recordLifecycle(can, 'assigned', {
      customer: param.customer,
      subscription: param.subscription,
      note: 'Reserved for rotation',
      createdBy: param.createdBy,
    });
  }

  return assignment;
};

/**
 * Plans the rotation swap for one delivery.
 *
 * Returns which can to COLLECT (the one the customer holds) and which to
 * DELIVER (a sibling that is back in service). Blocking on an unready sibling is
 * deliberate: handing a customer a can that is still in the wash is worse than
 * delaying, and silently substituting a stranger's can would break rotation.
 *
 * @param {Object} param
 * @returns {Promise<{collect: Object|null, deliver: Object, rotationSize: number}>}
 */
const planSwap = async (param) => {
  const assignment = await DairyContainerAssignment.findOne({
    customer: new mongoose.Types.ObjectId(param.customer),
    business: new mongoose.Types.ObjectId(param.business),
    status: 'active',
  });

  if (!assignment) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'No active container assignment for this customer — they are not on a rotation'
    );
  }

  const cans = await DairyCan.find({ _id: { $in: assignment.cans } });
  if (cans.length < assignment.rotationSize) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Assignment holds fewer cans than its rotation size');
  }

  // What the customer currently has.
  const held = cans.filter((c) => c.currentHolder?.type === 'customer');

  // What is available to hand over: back with the store and back in service.
  const readyForHandover = cans.filter(
    (c) => c.currentHolder?.type === 'store' && c.condition === 'ready'
  );

  if (readyForHandover.length === 0) {
    const states = cans.map((c) => `${c.canCode}:${c.condition}`).join(', ');
    throw new ApiError(
      httpStatus.CONFLICT,
      `No sibling can is ready to deliver. Container states — ${states}`
    );
  }

  return {
    collect: held[0] || null,
    deliver: readyForHandover[0],
    assignment,
    rotationSize: assignment.rotationSize,
    heldCount: held.length,
  };
};

/**
 * Records the swap after the rider has scanned both movements.
 *
 * @param {Object} param
 */
const completeSwap = async (param) => {
  const assignment = await DairyContainerAssignment.findById(param.assignment);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  assignment.activeCan = param.deliveredCan;
  assignment.lastCollectedCan = param.collectedCan;
  assignment.lastSwappedAt = new Date();
  await assignment.save();

  const delivered = await DairyCan.findById(param.deliveredCan);
  if (delivered) {
    await recordLifecycle(delivered, 'swapped', {
      customer: assignment.customer,
      subscription: assignment.subscription,
      run: param.run,
      stop: param.stop,
      agent: param.agent,
      note: `Rotated out; previously held ${param.collectedCan ? param.collectedCan.toString() : 'none'}`,
      createdBy: param.createdBy,
    });
  }

  return assignment;
};

/**
 * Ends a rotation and returns the cans to the general pool.
 *
 * @param {string} assignmentId
 * @param {Object} param
 */
const releaseContainers = async (assignmentId, param) => {
  const assignment = await DairyContainerAssignment.findById(assignmentId);
  if (!assignment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const cans = await DairyCan.find({ _id: { $in: assignment.cans } });
  let releasedCount = 0;
  let retainedCount = 0;

  for (const can of cans) {
    // Only cans physically back at the store can be released. One still with the
    // customer must be collected first or the pool gains a phantom can.
    if (can.currentHolder?.type !== 'store') {
      retainedCount += 1;
      continue;
    }
    can.assignedTo = { type: null, ref: null };
    can.rotationGroup = undefined;
    await can.save();
    releasedCount += 1;
    await recordLifecycle(can, 'released', {
      note: param.reason || 'Rotation ended',
      createdBy: param.createdBy,
    });
  }

  assignment.status = 'released';
  assignment.releasedAt = new Date();
  await assignment.save();

  return { assignment, released: releasedCount, retained: retainedCount };
};

/**
 * Moves a can through the wash → inspect → refill pipeline.
 *
 * This is a dairy-unit operation, not a delivery one, so it is deliberately
 * separate from the rider flow. Every step validates the transition, which is what
 * stops a quarantined can ever being refilled and issued.
 *
 * @param {string} canId
 * @param {string} action  send_to_wash | washed | inspect_ok | inspect_fail
 *                         | refill | scrap
 * @param {Object} param
 */
const advanceLifecycle = async (canId, action, param) => {
  const can = await DairyCan.findById(canId);
  if (!can) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const ACTION_TARGET = {
    send_to_wash: { from: ['dirty'], to: 'washing', event: 'sent_to_wash' },
    washed: { from: ['washing'], to: 'washed', event: 'washed' },
    // QA passed. The can is clean and inspected but not yet filled.
    inspect_ok: { from: ['washed'], to: 'refilled', event: 'inspected_ok' },
    inspect_fail: { from: ['washed', 'washing'], to: 'quarantined', event: 'inspected_fail' },
    // Filled with product and returned to the rotation.
    refill: { from: ['refilled'], to: 'ready', event: 'refilled' },
    scrap: { from: null, to: 'scrapped', event: 'scrapped' },
  };

  const rule = ACTION_TARGET[action];
  if (!rule) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unknown lifecycle action: ${action}`);
  }

  if (rule.from && !rule.from.includes(can.condition)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot ${action} a can in state '${can.condition}'. Expected one of: ${rule.from.join(', ')}`
    );
  }

  // The transition itself is the authority — `refill` no longer needs a special
  // case because returning to service is a real `refilled → ready` move.
  assertTransition(can.condition, rule.to);
  can.condition = rule.to;

  if (action === 'scrap') {
    // A scrapped can leaves the pool for good.
    can.status = 'lost';
    can.currentHolder = { type: null, ref: null };
    can.assignedTo = { type: null, ref: null };
  }

  // Only a can that is genuinely back in service rejoins the pool.
  if (action === 'refill') {
    can.status = 'in_store';
    can.currentHolder = { type: 'store', ref: null };
    can.lastMovementAt = new Date();
  }

  await can.save();
  await recordLifecycle(can, rule.event, param);

  return can;
};

/**
 * Rotation state for a customer, for the partner and rider UIs.
 *
 * @param {string} customerId
 * @param {string} businessId
 */
const getRotationView = async (customerId, businessId) => {
  const assignment = await DairyContainerAssignment.findOne({
    customer: new mongoose.Types.ObjectId(customerId),
    business: new mongoose.Types.ObjectId(businessId),
    status: 'active',
  });

  if (!assignment) {
    return { assignment: null, cans: [] };
  }

  const cans = await DairyCan.find({ _id: { $in: assignment.cans } }).select(
    'canCode condition status currentHolder rotationGroup lastMovementAt'
  );

  return {
    assignment,
    cans,
    withCustomer: cans.filter((c) => c.currentHolder?.type === 'customer').length,
    inService: cans.filter((c) => c.condition === 'ready').length,
    inWash: cans.filter((c) => ['dirty', 'washing', 'washed'].includes(c.condition)).length,
    quarantined: cans.filter((c) => c.condition === 'quarantined').length,
  };
};

/**
 * Sweeps the wash line: counts by lifecycle state for the dairy unit dashboard.
 *
 * @param {string} businessId
 */
const getLifecycleSummary = async (businessId) => {
  const rows = await DairyCan.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(businessId) } },
    { $group: { _id: '$condition', count: { $sum: 1 } } },
  ]);

  const byCondition = rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});

  return {
    ready: byCondition.ready || 0,
    issued: byCondition.issued || 0,
    dirty: byCondition.dirty || 0,
    washing: byCondition.washing || 0,
    washed: byCondition.washed || 0,
    refilled: byCondition.refilled || 0,
    quarantined: byCondition.quarantined || 0,
    scrapped: byCondition.scrapped || 0,
  };
};

module.exports = {
  LIFECYCLE_TRANSITIONS,
  assertTransition,
  recordLifecycle,
  getRotationPolicy,
  assignContainers,
  planSwap,
  completeSwap,
  releaseContainers,
  advanceLifecycle,
  getRotationView,
  getLifecycleSummary,
};