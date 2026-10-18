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
const ApiError = require('../../../utils/ApiError');
const { DairyCan, Business } = require('../../../models');
const dairyCanService = require('../services/dairy.can.service');
const deliveryRunService = require('../../../kernel/delivery/services/delivery.run.service');

/**
 * The signed-in rider, taken from the token.
 *
 * These scan routes used to read the rider's id out of the URL. A client-supplied
 * id means anything can be written into the can ledger against any rider, so the
 * path no longer carries one.
 */
const riderId = (req) => deliveryRunService.getDriverIdForUser(req.user._id);

/**
 * Loads sealed cans at the depot onto the rider's crate.
 *
 * Empties are NOT loaded here — they are collected off customers at the door,
 * so reconciliation derives the expected return from the ledger.
 *
 * @returns {Object} scan result
 */
const pickupScan = catchAsync(async (req, res) => {
  const agent = await riderId(req);
  const result = await dairyCanService.applyScanBatch({
    eventType: 'pickup',
    clientRef: req.body.clientRef,
    run: req.body.run,
    agent,
    createdBy: agent,
    note: req.body.note,
  });
  res.send(result);
});

/**
 * Issues cans to a customer at a stop and holds their deposits.
 *
 * @returns {Object} issue result
 */
const issueScan = catchAsync(async (req, res) => {
  const agent = await riderId(req);
  const result = await dairyCanService.issueCans({
    ...req.body,
    agent,
    createdBy: agent,
  });
  res.send(result);
});

/**
 * Collects empty cans from a customer and releases their deposits.
 *
 * @returns {Object} collect result
 */
const collectScan = catchAsync(async (req, res) => {
  const agent = await riderId(req);
  const result = await dairyCanService.collectCans({
    ...req.body,
    agent,
    createdBy: agent,
  });
  res.send(result);
});

/**
 * Deposit summary for the account making the request.
 *
 * Scoped to the signed-in user rather than an `:id`, so one customer cannot read
 * another's deposit position by passing their id.
 *
 * @returns {Object} deposit summary
 */
const depositSummary = catchAsync(async (req, res) => {
  const summary = await dairyCanService.getCustomerDepositSummary(req.user._id);
  res.send(summary);
});

/**
 * Authoritative can balance for a run, derived from the ledger.
 *
 * @returns {Object} balance
 */
const runBalance = catchAsync(async (req, res) => {
  const balance = await dairyCanService.getRunBalance(req.params.run);
  res.send({ balance });
});

/**
 * End-of-shift reconciliation.
 *
 * Responds 409 when the ledger does not balance and no reason was supplied.
 * Anything the rider failed to bring back is written off so no can is left
 * dangling in `with_agent` and every future reconciliation stays balanceable.
 *
 * @returns {Object} reconciliation
 */
const reconcile = catchAsync(async (req, res) => {
  const result = await dairyCanService.reconcileRun(req.params.run, req.outletId, {
    ...req.body,
    createdBy: req.outletId,
  });
  res.send({
    run: result.run,
    balance: result.balance,
    returnedCount: result.returnedCount,
    writtenOffCount: result.writtenOffCount,
  });
});

/** @returns {Object} paginated cans */
const canList = catchAsync(async (req, res) => {
  const result = await dairyCanService.getBusinessCans(req.outletId, req.query);
  res.send(pick(result, ['cans', 'totalResults', 'page', 'limit']));
});

/**
 * Writes off a can as lost or damaged, optionally refunding the deposit.
 *
 * @returns {Object} can
 */
const writeOff = catchAsync(async (req, res) => {
  const result = await dairyCanService.writeOffCan({
    ...req.body,
    can: req.params.can,
    createdBy: req.outletId,
  });
  res.send({ can: result.can });
});

/**
 * Registers a can against an outlet.
 *
 * @returns {Object} can
 */
const createCan = catchAsync(async (req, res) => {
  const business = await Business.findById(req.outletId);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const existing = await DairyCan.findOne({ canCode: req.body.canCode });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Can code already registered');
  }

  const can = await DairyCan.create({
    canCode: req.body.canCode,
    business: business._id,
    canType: req.body.canType,
    capacityL: req.body.capacityL,
    depositAmount: req.body.depositAmount,
    status: 'in_store',
    currentHolder: { type: 'store', ref: null },
    heldAt: business._id,
    // `ready`, not `good`. The can lifecycle vocabulary is
    // ready → issued → dirty → washing → washed → refilled → ready, and rotation
    // only ever matches `ready`. Writing `good` here produced a bottle fleet that
    // was in the database but invisible to `assignContainers` and `planSwap`.
    condition: 'ready',
  });

  res.send({ can });
});

/**
 * Bulk-registers cans, mirroring the import engine shape used by the other
 * verticals.
 *
 * @returns {Object} counts
 */
const importCans = catchAsync(async (req, res) => {
  const business = await Business.findById(req.outletId);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  let created = 0;
  let skipped = 0;

  for (const row of req.body.cans) {
    const exists = await DairyCan.findOne({ canCode: row.canCode });
    if (exists) {
      skipped += 1;
      continue;
    }
    await DairyCan.create({
      canCode: row.canCode,
      business: business._id,
      canType: row.canType,
      capacityL: row.capacityL,
      depositAmount: row.depositAmount,
      status: 'in_store',
      currentHolder: { type: 'store', ref: null },
      heldAt: business._id,
      // Same lifecycle vocabulary as `createCan` — see the note there.
      condition: 'ready',
    });
    created += 1;
  }

  res.send({ success: true, created, skipped });
});

module.exports = {
  pickupScan,
  issueScan,
  collectScan,
  depositSummary,
  runBalance,
  reconcile,
  canList,
  writeOff,
  createCan,
  importCans,
};