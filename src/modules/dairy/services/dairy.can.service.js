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
const { DairyCan, DairyCanLedger, DeliveryRun, Wallet } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');

/**
 * Can custody and deposit.
 *
 * Deposit model: the deposit is **held in the customer's wallet** while the can
 * is with them, and released when the can comes back. A lost or damaged can is
 * an admin adjustment. This reuses the existing `Wallet` and `Transactions`
 * models rather than introducing a parallel balance, so a customer's dairy
 * deposit and their spendable balance never drift apart.
 *
 * Two invariants this module exists to protect:
 *
 *   1. **Idempotency.** `clientRef` carries the key from the rider's offline
 *      outbox. A replayed batch must not double-count.
 *   2. **The ledger is append-only.** Corrections are compensating entries, so
 *      custody history stays auditable.
 */

const HOLDER_FOR_EVENT = {
  // Sealed cans loaded at the depot, on their way to a customer.
  pickup: 'agent',
  issue: 'customer',
  // Empties taken off the customer at the door. These are what the rider
  // carries home — they are NOT loaded at the depot, which is why there is no
  // "pickup_empty" event.
  collect: 'agent',
  return_to_store: 'store',
  damaged: 'store',
  lost: null,
};

const STATUS_FOR_EVENT = {
  pickup: 'with_agent',
  issue: 'with_customer',
  collect: 'with_agent',
  return_to_store: 'in_store',
  damaged: 'in_store',
  lost: 'lost',
};

/**
 * Custody event → lifecycle state.
 *
 * This is what keeps the two axes in step. A can handed to a customer must
 * become `issued`, and one taken back must become `dirty` and await the wash
 * line. Without this, `condition` stays `ready` forever and the rotation planner
 * happily hands the same can to the next customer.
 *
 * `pickup` deliberately does NOT change the condition: the can is loaded but not
 * yet delivered, so it is not `issued`.
 */
const CONDITION_FOR_EVENT = {
  issue: 'issued',
  collect: 'dirty',
  return_to_store: 'dirty',
  damaged: 'quarantined',
};

/**
 * Returns true when this `clientRef` has already been applied.
 *
 * @param {string} clientRef
 */
const alreadyApplied = async (clientRef) => {
  if (!clientRef) return false;
  const existing = await DairyCanLedger.findOne({ clientRef }).select('_id');
  return !!existing;
};

/**
 * Records a movement for one can and updates its custody.
 *
 * Called by every scan endpoint. Idempotent on `clientRef`.
 *
 * @param {string} canId
 * @param {Object} param
 * @returns {Promise<{can: Object, ledger: Object, duplicate: boolean}>}
 */
const applyMovement = async (canId, param) => {
  if (await alreadyApplied(param.clientRef)) {
    const can = await DairyCan.findById(canId);
    return { can, ledger: null, duplicate: true };
  }

  const can = await DairyCan.findById(canId);
  if (!can) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const fromHolder = can.currentHolder?.type || 'store';
  const toHolder = HOLDER_FOR_EVENT[param.eventType];
  const nextStatus = STATUS_FOR_EVENT[param.eventType];

  // A can cannot be collected from a customer it was never issued to.
  if (param.eventType === 'collect' && fromHolder !== 'customer') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Can is not with a customer');
  }
  // Re-issuing a can already with a customer would silently lose a deposit.
  if (param.eventType === 'issue' && fromHolder === 'customer') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Can is already with a customer');
  }

  can.status = nextStatus;
  can.currentHolder = { type: toHolder, ref: toHolder === 'agent' ? param.agent : param.customer };
  can.lastMovementAt = new Date();
  if (param.eventType === 'issue') {
    can.issuedAt = new Date();
  }
  // Keep the lifecycle axis in step with custody. Skipped when undefined so a
  // `pickup` or a `lost` write-off does not clobber the current state.
  const nextCondition = CONDITION_FOR_EVENT[param.eventType];
  if (nextCondition) {
    can.condition = nextCondition;
  }
  await can.save();

  const ledger = await DairyCanLedger.create({
    can: can._id,
    business: can.business,
    eventType: param.eventType,
    clientRef: param.clientRef,
    run: param.run,
    stop: param.stop,
    order: param.order,
    agent: param.agent,
    customer: param.customer,
    fromHolder,
    toHolder,
    amount: param.amount || 0,
    note: param.note,
    createdBy: param.createdBy,
  });

  return { can, ledger, duplicate: false };
};

/**
 * Bulk-records movements for a scan batch.
 *
 * The rider app submits a batch at a time (`canCodes`), so this is the hot path
 * and applies them sequentially. Partial application is acceptable here because
 * `clientRef` makes a retry safe — the already-applied entries are skipped.
 *
 * @param {Object} param
 * @returns {Promise<{applied: number, duplicates: number, cans: Object[]}>}
 */
const applyScanBatch = async (param) => {
  const codes = (param.canCodes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No can codes supplied');
  }

  const cans = await DairyCan.find({ canCode: { $in: codes } });
  const foundCodes = new Set(cans.map((c) => c.canCode));

  const missing = codes.filter((c) => !foundCodes.has(c));
  if (missing.length > 0) {
    throw new ApiError(httpStatus.NOT_FOUND, `Unknown can code(s): ${missing.join(', ')}`);
  }

  let applied = 0;
  let duplicates = 0;
  const touched = [];

  for (const can of cans) {
    // Movement is idempotent per (can, clientRef) pair. The outbox ref is
    // suffixed per can so a batch of five yields five distinct keys.
    const movement = await applyMovement(can._id, {
      ...param,
      clientRef: param.clientRef ? `${param.clientRef}:${can.canCode}` : undefined,
    });
    if (movement.duplicate) {
      duplicates += 1;
    } else {
      applied += 1;
    }
    touched.push(movement.can);
  }

  return { applied, duplicates, cans: touched };
};

/**
 * Debits a deposit from a customer's wallet when a can is issued.
 *
 * @param {string} customerId
 * @param {number} amountRupees
 */
const holdDeposit = async (customerId, amountRupees) => {
  if (!amountRupees || amountRupees <= 0) return null;

  const wallet = await Wallet.findOne({ holderId: new mongoose.Types.ObjectId(customerId) });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found');
  }

  // `balance` uses a rupees getter / paise setter, so compare in rupees.
  if (wallet.balance < amountRupees) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Insufficient wallet balance for can deposit');
  }

  wallet.balance = Number((wallet.balance - amountRupees).toFixed(2));
  wallet.meta = [
    ...(wallet.meta || []),
    {
      description: 'Dairy can deposit held',
      amount: -amountRupees,
      date: new Date(),
    },
  ];
  await wallet.save();

  return wallet;
};

/**
 * Credits a deposit back to a customer's wallet when a can is returned.
 *
 * @param {string} customerId
 * @param {number} amountRupees
 */
const releaseDeposit = async (customerId, amountRupees) => {
  if (!amountRupees || amountRupees <= 0) return null;

  const wallet = await Wallet.findOne({ holderId: new mongoose.Types.ObjectId(customerId) });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found');
  }

  wallet.balance = Number((wallet.balance + amountRupees).toFixed(2));
  wallet.meta = [
    ...(wallet.meta || []),
    {
      description: 'Dairy can deposit released',
      amount: amountRupees,
      date: new Date(),
    },
  ];
  await wallet.save();

  return wallet;
};

/**
 * Issues cans to a customer at a stop and holds their deposits.
 *
 * @param {Object} param
 */
const issueCans = async (param) => {
  const codes = (param.canCodes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No can codes supplied');
  }

  // Idempotency is checked BEFORE any state validation.
  //
  // The rider captures scans offline and replays them on reconnect, so an
  // already-applied batch will arrive with the cans now sitting `with_customer`.
  // Validating state first would reject the replay with a confusing
  // "not available to issue" instead of silently skipping it.
  if (param.clientRef && (await alreadyApplied(`${param.clientRef}:${codes[0]}`))) {
    return { issued: codes.length, depositHeld: 0, duplicates: codes.length, cans: [] };
  }

  const cans = await DairyCan.find({ canCode: { $in: codes } });
  const foundCodes = new Set(cans.map((c) => c.canCode));
  const missing = codes.filter((c) => !foundCodes.has(c));
  if (missing.length > 0) {
    throw new ApiError(httpStatus.NOT_FOUND, `Unknown can code(s): ${missing.join(', ')}`);
  }

  /**
 * The `currentHolder.type` values a can may be issued FROM.
 *
 * Both are valid because a can reaches a customer either by being picked up
 * onto the rider's crate first (`agent`, the normal depot flow) or by being
 * handed over directly at the counter (`store`, e.g. a shop pickup). Requiring
 * `store` alone would reject every can that went out on a run.
 *
 * Note these are HOLDER types, not `status` values — the status vocabulary is
 * `in_store` / `with_agent` / `with_customer`.
 */
const ISSUEABLE_HOLDERS = ['store', 'agent'];

  const notIssuable = cans.filter(
    (c) => !ISSUEABLE_HOLDERS.includes(c.currentHolder?.type || 'store')
  );
  if (notIssuable.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Can(s) not available to issue: ${notIssuable.map((c) => c.canCode).join(', ')}`
    );
  }

  const customerId = param.customer;
  let depositTotal = 0;

  for (const can of cans) {
    depositTotal += can.depositAmount || 0;
    await applyMovement(can._id, {
      eventType: 'issue',
      clientRef: param.clientRef ? `${param.clientRef}:${can.canCode}` : undefined,
      run: param.run,
      stop: param.stop,
      order: param.order,
      agent: param.agent,
      customer: customerId,
      createdBy: param.createdBy,
    });
    await DairyCanLedger.create({
      can: can._id,
      business: can.business,
      eventType: 'deposit_held',
      run: param.run,
      stop: param.stop,
      customer: customerId,
      fromHolder: 'store',
      toHolder: 'customer',
      amount: can.depositAmount || 0,
      createdBy: param.createdBy,
    });
  }
  await holdDeposit(customerId, depositTotal);

  return { issued: cans.length, depositHeld: depositTotal, cans };
};

/**
 * Collects empty cans back from a customer and releases their deposits.
 *
 * @param {Object} param
 */
const collectCans = async (param) => {
  const codes = (param.canCodes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No can codes supplied');
  }

  // Same ordering rule as `issueCans` — see the note there.
  if (param.clientRef && (await alreadyApplied(`${param.clientRef}:${codes[0]}`))) {
    return { collected: codes.length, depositReleased: 0, duplicates: codes.length, cans: [] };
  }

  const cans = await DairyCan.find({ canCode: { $in: codes } });
  if (cans.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Unknown can codes');
  }

  const releases = new Map();
  let releasedTotal = 0;

  for (const can of cans) {
    const previousCustomer = can.currentHolder?.ref;
    await applyMovement(can._id, {
      eventType: 'collect',
      clientRef: param.clientRef ? `${param.clientRef}:${can.canCode}` : undefined,
      run: param.run,
      stop: param.stop,
      agent: param.agent,
      createdBy: param.createdBy,
    });

    if (previousCustomer) {
      const key = previousCustomer.toString();
      releases.set(key, (releases.get(key) || 0) + (can.depositAmount || 0));
      releasedTotal += can.depositAmount || 0;
      await DairyCanLedger.create({
        can: can._id,
        business: can.business,
        eventType: 'deposit_released',
        run: param.run,
        stop: param.stop,
        customer: previousCustomer,
        fromHolder: 'customer',
        toHolder: 'agent',
        amount: can.depositAmount || 0,
        createdBy: param.createdBy,
      });
    }
  }

  for (const [customerId, amount] of releases) {
    await releaseDeposit(customerId, amount);
  }

  return { collected: cans.length, depositReleased: releasedTotal, cans };
};

/**
 * Can ledger balance for a run.
 *
 * This is the authoritative reconciliation source. `DeliveryRun.returnLeg`
 * carries the rider's self-reported numbers; this derives the truth from the
 * ledger so a mismatch is detectable rather than merely asserted.
 *
 * The crate holds two kinds of can, which is why this cannot be `pickup - issue`:
 *
 *   - **full cans loaded to issue** (`pickup.cansLoaded`), of which some are
 *     handed to customers
 *   - **empty cans loaded to collect** (`pickup.cansLoadedForReturn`), which
 *     travel out so the rider can bring yesterday's empties home
 *
 * So what should be riding back at the depot is
 * `(cansLoaded - issued) + cansLoadedForReturn - collected`.
 *
 * @param {string} runId
 */
const getRunBalance = async (runId) => {
  const rows = await DairyCanLedger.aggregate([
    { $match: { run: new mongoose.Types.ObjectId(runId) } },
    {
      $group: {
        // Group by the VALUE, not `{ $type: ... }` — `$type` yields the BSON
        // type ('string'), collapsing every event into one bucket.
        _id: '$eventType',
        count: { $sum: 1 },
      },
    },
  ]);

  const byType = rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});

  const issue = byType.issue || 0;
  const collect = byType.collect || 0;
  const returned = byType.return_to_store || 0;
  const lost = byType.lost || 0;
  const damaged = byType.damaged || 0;
  const pickedUpFull = byType.pickup || 0;

  const run = await DeliveryRun.findById(runId).select('pickup');

  // Sealed cans taken out but never handed over — still on the crate.
  const undeliveredFull = Math.max(pickedUpFull - issue, 0);

  // What the rider should be carrying home:
  //   - empties collected off customers this run
  //   - plus any sealed can that never got issued
  //
  // There is deliberately no "empties loaded at the depot" term: empties enter
  // the rider's custody at the customer's door, not at the depot.
  const expectedBackOnAgent = collect + undeliveredFull;

  return {
    pickup: pickedUpFull,
    cansLoaded: run?.pickup?.cansLoaded ?? pickedUpFull,
    issue,
    collect,
    returned,
    lost,
    damaged,
    undeliveredFull,
    expectedBackOnAgent,
    stillWithAgent: expectedBackOnAgent,
  };
};

/**
 * Outstanding deposit exposure for a customer — cans they still hold.
 *
 * @param {string} customerId
 */
const getCustomerDepositSummary = async (customerId) => {
  const cans = await DairyCan.find({ 'currentHolder.type': 'customer', 'currentHolder.ref': new mongoose.Types.ObjectId(customerId) })
    .select('canCode canType capacityL depositAmount status lastMovementAt');

  const total = cans.reduce((sum, can) => sum + (can.depositAmount || 0), 0);

  return { cans, canCount: cans.length, depositOutstanding: total };
};

/**
 * Derives which cans a rider is physically carrying at the depot.
 *
 * Cans loaded or collected on this run, minus cans already handed back to the
 * store **and** cans issued to a customer — a can sitting in a customer's
 * doorway is not on the rider's crate, so counting it here would make every
 * reconciliation permanently over-count.
 *
 * @param {string} runId
 * @returns {Promise<ObjectId[]>}
 */
const getCansStillCarried = async (runId) => {
  const runObjectId = new mongoose.Types.ObjectId(runId);

  const [pickedUp, collected, returned, issued] = await Promise.all([
    DairyCanLedger.distinct('can', { run: runObjectId, eventType: 'pickup' }),
    DairyCanLedger.distinct('can', { run: runObjectId, eventType: 'collect' }),
    DairyCanLedger.distinct('can', { run: runObjectId, eventType: 'return_to_store' }),
    DairyCanLedger.distinct('can', { run: runObjectId, eventType: 'issue' }),
  ]);

  const carried = new Map();
  for (const id of [...pickedUp, ...collected]) {
    carried.set(id.toString(), id);
  }
  for (const id of [...returned, ...issued]) {
    carried.delete(id.toString());
  }

  return Array.from(carried.values());
};

/**
 * Reconciles a run's end-of-shift can counts.
 *
 * Compars the rider's declared return against the ledger and records the
 * variance. Anything short of the declared count is written off as lost so the
 * can is not left dangling in `with_agent` forever.
 *
 * @param {string} runId
 * @param {string} businessId
 * @param {Object} param
 */
const reconcileRun = async (runId, businessId, param) => {
  const run = await DeliveryRun.findOne({
    _id: runId,
    business: new mongoose.Types.ObjectId(businessId),
  });
  if (!run) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const balance = await getRunBalance(runId);
  const cansReturned = param.cansReturned || 0;
  const expected = balance.expectedBackOnAgent;
  const variance = cansReturned - expected;

  if (variance !== 0 && !param.reason) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Cans are not balanced. Expected ${expected} back, received ${cansReturned}. A reason is required.`
    );
  }

  const carriedIds = await getCansStillCarried(runId);
  const returnedIds = carriedIds.slice(0, Math.min(cansReturned, carriedIds.length));
  const shortfallIds = carriedIds.slice(returnedIds.length);

  const result = await withOptionalTransaction(async (session) => {
    if (returnedIds.length > 0) {
      const cans = await DairyCan.find({ _id: { $in: returnedIds } });
      for (const can of cans) {
        can.status = 'in_store';
        can.currentHolder = { type: 'store', ref: null };
        can.lastMovementAt = new Date();
        await can.save(session ? { session } : undefined);
        await DairyCanLedger.create(
          [
            {
              can: can._id,
              business: can.business,
              eventType: 'return_to_store',
              run: run._id,
              fromHolder: 'agent',
              toHolder: 'store',
              note: param.reason,
              createdBy: param.createdBy,
            },
          ],
          session ? { session } : undefined
        );
      }
    }

    // Cans the rider never brought back are written off rather than left
    // dangling in `with_agent`, which would keep every future reconciliation
    // permanently out of balance.
    if (shortfallIds.length > 0) {
      const missing = await DairyCan.find({ _id: { $in: shortfallIds } });
      for (const can of missing) {
        can.status = 'lost';
        // `scrapped` is the end-of-life lifecycle state. `lost` is a custody status
        // (`status: 'lost'`), not a condition — the two axes are separate.
        can.condition = 'scrapped';
        can.currentHolder = { type: null, ref: null };
        can.lastMovementAt = new Date();
        await can.save(session ? { session } : undefined);
        await DairyCanLedger.create(
          [
            {
              can: can._id,
              business: can.business,
              eventType: 'lost',
              run: run._id,
              fromHolder: 'agent',
              toHolder: null,
              note: param.reason || 'Not returned at depot reconciliation',
              createdBy: param.createdBy,
            },
          ],
          session ? { session } : undefined
        );
      }
    }

    run.returnLeg = {
      completedAt: new Date(),
      cansReturned,
      variance,
      adjustmentReason: variance !== 0 ? param.reason : undefined,
    };
    await run.save(session ? { session } : undefined);

    return { run, balance, returnedCount: returnedIds.length, writtenOffCount: shortfallIds.length };
  });

  return result;
};

/**
 * Admin writes off a can as lost or damaged.
 *
 * @param {Object} param
 */
const writeOffCan = async (param) => {
  const can = await DairyCan.findById(param.can);
  if (!can) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const previousCustomer = can.currentHolder?.type === 'customer' ? can.currentHolder.ref : null;

  const result = await applyMovement(can._id, {
    eventType: param.eventType, // lost | damaged
    run: param.run,
    agent: param.agent,
    customer: previousCustomer,
    note: param.reason,
    createdBy: param.createdBy,
  });

  if (previousCustomer && param.refundDeposit) {
    await releaseDeposit(previousCustomer, can.depositAmount || 0);
    await DairyCanLedger.create({
      can: can._id,
      business: can.business,
      eventType: 'deposit_released',
      customer: previousCustomer,
      fromHolder: 'customer',
      toHolder: 'store',
      amount: can.depositAmount || 0,
      note: `Written off as ${param.eventType}`,
      createdBy: param.createdBy,
    });
  }

  return result;
};

/** Paginated can list for a business, filterable by status. */
const getBusinessCans = async (businessId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: new mongoose.Types.ObjectId(businessId) };
  if (options.status) {
    query.status = options.status;
  }
  if (options.condition) {
    query.condition = options.condition;
  }

  const [cans, total] = await Promise.all([
    DairyCan.find(query).sort({ lastMovementAt: -1 }).skip(skip).limit(limit),
    DairyCan.countDocuments(query),
  ]);

  return { cans, totalResults: total, page, limit };
};

module.exports = {
  applyMovement,
  applyScanBatch,
  holdDeposit,
  releaseDeposit,
  issueCans,
  collectCans,
  getRunBalance,
  getCansStillCarried,
  getCustomerDepositSummary,
  reconcileRun,
  writeOffCan,
  getBusinessCans,
};