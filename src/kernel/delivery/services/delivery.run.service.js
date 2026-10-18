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
const { DeliveryRun, DeliveryStop, DeliveryPOD, Business, DairyDriver } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');
const deliveryHooks = require('../delivery.hooks');

/**
 * Delivery run lifecycle.
 *
 * Assignment policy — own fleet first, platform pool as fallback:
 *
 *   1. If `Business.ownDeliveryPartner === true`, pick an active `DairyDriver`
 *      carrying that business id.
 *   2. Otherwise pick from the platform pool (`DairyDriver.business === null`).
 *
 * This mirrors the `fetchMyDriver` branch already proven for food at
 * `services/orders.service.js`. Own fleet is the primary path for dairy
 * because a milk route is territory-bound and recurring, not a per-trip
 * dispatch — the pool exists mainly for launch and absentee cover.
 */

/** Rounds a date down to midnight local time so day lookups are stable. */
const startOfDay = (value) => {
  const date = value ? new Date(value) : new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const nextRunNo = async () => {
  const latest = await DeliveryRun.findOne().sort({ runNo: -1 }).select('runNo');
  return latest && latest.runNo ? latest.runNo + 1 : 1;
};

/**
 * Builds a GeoJSON point, or `undefined` when there are no coordinates.
 *
 * Returning `undefined` matters: a 2dsphere index rejects a document whose
 * location is a malformed point, and most manual/COD stops have no GPS.
 *
 * @param {Object} location
 * @returns {Object|undefined}
 */
const geoPoint = (location) => {
  if (!location || !Array.isArray(location.coordinates) || location.coordinates.length < 2) {
    return undefined;
  }
  return { type: 'Point', coordinates: location.coordinates };
};

/**
 * Picks a rider for a business on a given date.
 *
 * @param {string} businessId
 * @param {Date} serviceDate
 * @returns {Promise<{driver: Object|null, agentMode: string}>}
 */
const assignAgent = async (businessId, serviceDate) => {
  const business = await Business.findById(businessId).select('ownDeliveryPartner');
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const dayStart = startOfDay(serviceDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Riders already committed to another run that day cannot take a second one.
  const busyAgentIds = await DeliveryRun.find({
    serviceDate: { $gte: dayStart, $lt: dayEnd },
    status: { $ne: 'cancelled' },
    agent: { $ne: null },
  })
    .distinct('agent');

  const baseFilter = {
    activeStatus: true,
    isBlocked: { $ne: true },
    status: true,
    _id: { $nin: busyAgentIds },
  };

  let agentMode = 'platform_pool';
  let query = { ...baseFilter, business: null };

  if (business.ownDeliveryPartner === true) {
    agentMode = 'own_fleet';
    query = { ...baseFilter, business: business._id };
  }

  let driver = await DairyDriver.findOne(query);

  // Own fleet exhausted — fall back to the platform pool rather than leaving
  // the outlet with no route. Recorded as `platform_pool` so settlement charges
  // the correct payer.
  if (!driver && agentMode === 'own_fleet') {
    agentMode = 'platform_pool';
    driver = await DairyDriver.findOne({ ...baseFilter, business: null });
  }

  return { driver, agentMode };
};

/**
 * Recomputes the denormalised totals on a run from its stops.
 *
 * Called after every stop mutation because the rider manifest reads
 * `run.totals` directly and must not aggregate on every pull.
 *
 * @param {string} runId
 * @returns {Promise<Object>} updated run
 */
const recomputeTotals = async (runId) => {
  const agg = await DeliveryStop.aggregate([
    { $match: { run: new mongoose.Types.ObjectId(runId) } },
    {
      $group: {
        _id: null,
        stopCount: { $sum: 1 },
        cansOut: { $sum: '$cansOut' },
        cansIn: { $sum: '$cansIn' },
        amountToCollect: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$amountDue', 0] },
        },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
      },
    },
  ]);

  const totals = agg[0] || { stopCount: 0, cansOut: 0, cansIn: 0, amountToCollect: 0, delivered: 0 };

  return DeliveryRun.findByIdAndUpdate(
    runId,
    {
      $set: {
        totals: {
          stopCount: totals.stopCount,
          cansOut: totals.cansOut,
          cansIn: totals.cansIn,
          // The aggregation sums raw stored values, which are paise. The
          // `amountToCollect` setter converts rupees to paise, so divide first
          // or the amount is inflated 100x.
          amountToCollect: Math.round(totals.amountToCollect / 100),
        },
      },
    },
    { new: true, runValidators: true }
  );
};

/**
 * Creates a run and its stops.
 *
 * @param {Object} param
 * @returns {Promise<Object>} created run
 */
const createRun = async (param) => {
  const business = await Business.findById(param.business);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const { driver, agentMode } = await assignAgent(param.business, param.serviceDate);

  try {
    const created = await withOptionalTransaction(async (session) => {
      const runNo = await nextRunNo();
      const run = await DeliveryRun.create(
        [
          {
            runNo,
            vertical: business.vertical,
            business: business._id,
            serviceDate: startOfDay(param.serviceDate),
            agent: driver ? driver._id : null,
            agentMode,
            slot: param.slot,
            status: 'planned',
          },
        ],
        session ? { session } : undefined
      );

      const stops = (param.stops || []).map((stop, index) => ({
        run: run[0]._id,
        sequence: index + 1,
        customer: stop.customer,
        address: stop.address,
        addressRaw: stop.addressRaw,
        receiverName: stop.receiverName,
        receiverContact: stop.receiverContact,
        location: geoPoint(stop.location),
        order: stop.order,
        subscription: stop.subscription,
        slot: {
          windowStart: param.slot?.startTime,
          windowEnd: param.slot?.endTime,
        },
        cansOut: stop.cansOut || 0,
        cansIn: 0,
        amountDue: stop.amountDue || 0,
        amountCollected: 0,
        paymentMode: stop.paymentMode || 'cod',
        status: 'pending',
      }));

      if (stops.length > 0) {
        await DeliveryStop.insertMany(stops, session ? { session } : undefined);
      }

      return run[0];
    });

    return recomputeTotals(created._id);
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

/**
 * The rider's run for a date. Returns null when nothing is assigned, which the
 * app renders as the "no run assigned" empty state.
 *
 * @param {string} agentId
 * @param {Date} serviceDate
 */
const getRunForAgentAndDate = async (agentId, serviceDate) => {
  const dayStart = startOfDay(serviceDate);

  const run = await DeliveryRun.findOne({
    agent: new mongoose.Types.ObjectId(agentId),
    serviceDate: dayStart,
    status: { $ne: 'cancelled' },
  })
    .populate('business', 'name businessModel ownDeliveryPartner')
    .populate('agent', 'payoutMode canCapacity vehicleType business');

  return run;
};

const getRunDetail = async (runId, agentId, businessId) => {
  const run = await DeliveryRun.findById(runId)
    .populate('business', 'name businessModel ownDeliveryPartner driverPayoutMode')
    .populate('agent', 'payoutMode canCapacity vehicleType');
  
  if (!run) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  
  // A rider may only read their own run.
  if (agentId && run.agent && run.agent._id.toString() !== agentId.toString()) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
  
  // A partner may only read runs belonging to their own outlet. Checked here
  // rather than in the controller because a partner is not a driver, so
  // `agentId` is empty and the agent check above cannot cover them.
  if (businessId) {
    const runBusiness = run.business && run.business._id ? run.business._id : run.business;
    if (!runBusiness || runBusiness.toString() !== businessId.toString()) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Run not found');
    }
  }
  
  return run;
};

/**
 * Sequenced stops for a run, with customer contact joined in.
 *
 * @param {string} runId
 * @param {string} agentId
 */
const getStops = async (runId, agentId) => {
  await getRunDetail(runId, agentId);

  const stops = await DeliveryStop.aggregate([
    { $match: { run: new mongoose.Types.ObjectId(runId) } },
    { $sort: { sequence: 1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'customer',
        foreignField: '_id',
        as: 'customerInfo',
        // MongoDB has no `$lookup.project`; projection goes inside the pipeline,
        // matching the pattern at services/kitchen.owner.service.js.
        pipeline: [
          {
            $project: {
              _id: 1,
              firstName: 1,
              lastName: 1,
              mobile: 1,
              image: 1,
              // Rider-facing contact is partially masked, consistent with how
              // `kitchen.owner.service` masks numbers in listings.
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
            },
          },
        ],
      },
    },
    { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        run: 1,
        sequence: 1,
        customer: 1,
        customerInfo: 1,
        address: 1,
        addressRaw: 1,
        receiverName: 1,
        receiverContact: 1,
        location: 1,
        order: 1,
        subscription: 1,
        slot: 1,
        cansOut: 1,
        cansIn: 1,
        amountDue: 1,
        amountCollected: 1,
        paymentMode: 1,
        status: 1,
        skipReason: 1,
      },
    },
  ]);

  return stops;
};

/**
 * Starts a run at the depot, recording what the rider loaded out.
 *
 * @param {string} runId
 * @param {string} agentId
 * @param {Object} param
 */
const startRun = async (runId, agentId, param) => {
  const run = await getRunDetail(runId, agentId);

  if (run.status === 'completed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Run already completed');
  }
  if (run.status === 'in_progress') {
    return run;
  }
  if (run.pickup && run.pickup.completedAt) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Run already started');
  }

  const cansLoaded = param.cansLoaded || 0;
  const cansLoadedForReturn = param.cansLoadedForReturn || 0;
  const stopCount = run.totals?.stopCount || 0;

  // Cannot leave with fewer cans than the manifest requires, or the rider will
  // be short at the doors and the reconciliation will not balance.
  if (cansLoaded < (run.totals?.cansOut || 0)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Manifest requires ${run.totals?.cansOut || 0} cans but only ${cansLoaded} were loaded`
    );
  }

  run.status = 'in_progress';
  run.startedAt = new Date();
  run.pickup = {
    completedAt: new Date(),
    location: param.location,
    cansLoaded,
    cansLoadedForReturn,
  };
  await run.save();

  return { run, stopCount };
};

/**
 * Closes a run at the depot.
 *
 * The reconciliation gate:
 *
 *   expectedReturn = cansLoaded - cansIssuedToCustomers
 *   variance       = cansReturned - expectedReturn
 *
 * A non-zero variance requires an `adjustmentReason`. This is enforced here and
 * surfaced in the app at
 * `DairyPartner_app/lib/app/presentation/pages/delivery/run_complete/`.
 *
 * @param {string} runId
 * @param {string} agentId
 * @param {Object} param
 */
const completeRun = async (runId, agentId, param) => {
  const run = await getRunDetail(runId, agentId);

  if (run.status !== 'in_progress') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Run has not started');
  }
  if (!run.pickup || !run.pickup.completedAt) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Pickup was not recorded');
  }

  const issued = await DeliveryStop.aggregate([
    { $match: { run: new mongoose.Types.ObjectId(runId), status: 'delivered' } },
    { $group: { _id: null, cansOut: { $sum: '$cansOut' } } },
  ]);
  const cansIssued = issued[0]?.cansOut || 0;

  const cansReturned = param.cansReturned || 0;
  const expectedReturn = (run.pickup.cansLoaded || 0) - cansIssued;
  const variance = cansReturned - expectedReturn;

  if (variance !== 0 && !param.adjustmentReason) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Cans are not balanced. Expected ${expectedReturn} back, received ${cansReturned}. An adjustment reason is required.`
    );
  }

  // Balance check, stop closure and the run close must land together. On a
  // standalone mongod `withOptionalTransaction` degrades to sequential writes —
  // see utils/optionalTransaction.js. Do NOT deploy production on standalone.
  const updated = await withOptionalTransaction(async (session) => {
    const stillRunning = await DeliveryRun.findById(runId);
    if (stillRunning.status !== 'in_progress') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Run has not started');
    }

    const openStops = await DeliveryStop.countDocuments({
      run: run._id,
      status: { $in: ['pending', 'arrived'] },
    });

    if (openStops > 0 && !param.forceClose) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${openStops} stop(s) are still open`);
    }

    stillRunning.status = 'completed';
    stillRunning.endedAt = new Date();
    stillRunning.returnLeg = {
      completedAt: new Date(),
      cansReturned,
      variance,
      adjustmentReason: variance !== 0 ? param.adjustmentReason : undefined,
    };
    await stillRunning.save(session ? { session } : undefined);

    return stillRunning;
  });

  return updated;
};

/** Marks arrival at a stop. */
const arriveStop = async (stopId, agentId, param) => {
  const stop = await getOwnedStop(stopId, agentId);

  if (stop.status !== 'pending') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Stop is already ${stop.status}`);
  }

  stop.status = 'arrived';
  stop.slot = { ...stop.slot, arrivedAt: new Date(), location: param.location };
  await stop.save();

  return stop;
};

/**
 * Completes a stop.
 *
 * @param {string} stopId
 * @param {string} agentId
 * @param {Object} param
 */
const deliverStop = async (stopId, agentId, param) => {
  const stop = await getOwnedStop(stopId, agentId);

  if (stop.status === 'delivered') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stop already delivered');
  }

  stop.status = 'delivered';
  stop.cansOut = param.cansDelivered || stop.cansOut;
  stop.cansIn = param.emptyCansCollected || 0;
  stop.amountCollected = param.amountCollected || 0;
  stop.slot = { ...stop.slot, completedAt: new Date() };
  await stop.save();

  if (param.proof && (param.proof.photo || param.proof.signature)) {
    await DeliveryPOD.create({
      stop: stop._id,
      run: stop.run,
      clientRef: param.clientRef,
      photo: param.proof.photo,
      signature: param.proof.signature,
      location: param.proof.location,
      note: param.proof.note,
      capturedBy: param.capturedBy,
      capturedAt: param.proof.capturedAt || new Date(),
    });
  }

  await recomputeTotals(stop.run);

  // Let whichever vertical owns this stop settle its own books. The kernel does
  // not know or care what that is — see delivery.hooks.js.
  await deliveryHooks.emit('stop.delivered', { stop, agentId, param });

  return stop;
};

/** Marks a stop skipped or failed, both requiring a reason. */
const markStop = async (stopId, agentId, status, reason) => {
  const stop = await getOwnedStop(stopId, agentId);

  if (stop.status === 'delivered') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stop already delivered');
  }
  if (!reason) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A reason is required');
  }

  stop.status = status;
  stop.skipReason = reason;
  stop.slot = { ...stop.slot, completedAt: new Date() };
  await stop.save();

  await recomputeTotals(stop.run);

  // A stop that was dropped is not a delivery, so nothing downstream is owed an
  // update — but the vertical still gets told, in case it holds prepaid money.
  await deliveryHooks.emit('stop.not_delivered', { stop, agentId, status, reason });

  return stop;
};

/**
 * Loads a stop and asserts the agent owns its run.
 *
 * @param {string} stopId
 * @param {string} agentId
 */
const getOwnedStop = async (stopId, agentId) => {
  const stop = await DeliveryStop.findById(stopId);

  if (!stop) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  if (agentId) {
    const run = await DeliveryRun.findById(stop.run).select('agent');
    if (!run || !run.agent || run.agent._id.toString() !== agentId.toString()) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
    }
  }

  return stop;
};

/** Paginated run list for a business (partner view). */
const getBusinessRuns = async (businessId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: new mongoose.Types.ObjectId(businessId) };
  if (options.serviceDate) {
    query.serviceDate = startOfDay(options.serviceDate);
  }
  if (options.status) {
    query.status = options.status;
  }

  const [runs, total] = await Promise.all([
    DeliveryRun.find(query)
      .populate('business', 'name businessModel ownDeliveryPartner')
      .populate('agent', 'userId payoutMode canCapacity')
      .sort({ serviceDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DeliveryRun.countDocuments(query),
  ]);

  return { runs, totalResults: total, page, limit };
};

/**
 * Resolves the signed-in user's `DairyDriver` record.
 *
 * Driver routes used to take the driver id from the URL and simply compare it
 * with the run's assigned agent. That comparison proves the *run* belongs to
 * whoever was named in the path — it says nothing about whether the caller is
 * that person, so any authenticated driver could read and act on another
 * driver's runs by passing their id. Deriving the driver from the access token
 * removes the parameter entirely, so there is nothing left to tamper with.
 *
 * @param {string} userId the authenticated user's id
 * @returns {Promise<string>} the `DairyDriver._id`
 */
const getDriverIdForUser = async (userId) => {
  const driver = await DairyDriver.findOne({ userId: userId }).select('_id');
  if (!driver) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'No driver profile is linked to this account'
    );
  }
  return driver._id;
};

/**
 * Paginated run history for one driver (agent view).
 *
 * Scoped by the driver's own `DairyDriver` record rather than by a user id, so a
 * driver cannot page through another driver's runs by passing a different id.
 *
 * @param {string} driverId the `DairyDriver._id` of the signed-in driver
 * @param {Object} options
 */
const getAgentRuns = async (driverId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { agent: new mongoose.Types.ObjectId(driverId) };
  if (options.serviceDate) {
    query.serviceDate = startOfDay(options.serviceDate);
  }
  if (options.status) {
    query.status = options.status;
  }

  const [runs, total] = await Promise.all([
    DeliveryRun.find(query)
      .populate('business', 'name businessModel ownDeliveryPartner')
      .sort({ serviceDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DeliveryRun.countDocuments(query),
  ]);

  return { runs, totalResults: total, page, limit };
};

/** Cancels a run. */
const cancelRun = async (runId, businessId, reason) => {
  const run = await DeliveryRun.findOne({
    _id: runId,
    business: new mongoose.Types.ObjectId(businessId),
  });

  if (!run) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (run.status === 'completed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot cancel a completed run');
  }

  run.status = 'cancelled';
  await run.save();

  await DeliveryStop.updateMany(
    { run: run._id, status: { $in: ['pending', 'arrived'] } },
    { $set: { status: 'skipped', skipReason: reason || 'Run cancelled' } }
  );

  return run;
};

module.exports = {
  startOfDay,
  assignAgent,
  recomputeTotals,
  createRun,
  getRunForAgentAndDate,
  getRunDetail,
  getStops,
  startRun,
  completeRun,
  arriveStop,
  deliverStop,
  markStop,
  getOwnedStop,
  getBusinessRuns,
  getAgentRuns,
  getDriverIdForUser,
  cancelRun,
};