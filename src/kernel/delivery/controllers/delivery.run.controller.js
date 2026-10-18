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
const deliveryRunService = require('../services/delivery.run.service');

/**
 * The signed-in user's driver id.
 *
 * Every rider route resolves the driver through this instead of reading an id out
 * of the URL. A client-supplied id was only ever compared against the run's
 * assigned agent, which proved the run belonged to the named driver but not that
 * the caller *was* that driver — so any rider could read or act on another
 * rider's runs. With no id in the path there is nothing left to tamper with.
 *
 * @returns {Promise<string>} `DairyDriver._id`
 */
const driverId = (req) => deliveryRunService.getDriverIdForUser(req.user._id);

/**
 * The driver's id for a user who *may* be one, without failing if they are not.
 *
 * `runDetail` serves two audiences: a rider, whose run it is, and a partner
 * reading one of their outlet's runs. Asking a partner for a driver profile
 * threw "No driver profile is linked to this account" and turned every partner
 * run read into a 403. Only the rider path should insist.
 *
 * @returns {Promise<string|null>}
 */
const maybeDriverId = async (req) => {
  try {
    return await driverId(req);
  } catch (_e) {
    return null;
  }
};

/**
 * Rider manifest for a date.
 *
 * Returns `{ run: null }` rather than 404 when nothing is assigned, so the app
 * renders its "no run assigned" empty state instead of an error.
 *
 * @returns {Object|null} run
 */
const todayRun = catchAsync(async (req, res) => {
  const agent = await deliveryRunService.getRunForAgentAndDate(
    await driverId(req),
    req.query.serviceDate
  );
  res.send({ run: agent });
});

/** The signed-in driver's own run history. */
const agentRuns = catchAsync(async (req, res) => {
  const result = await deliveryRunService.getAgentRuns(await driverId(req), req.query);
  res.send(pick(result, ['runs', 'totalResults', 'page', 'limit']));
});

/** @returns {Object} run */
const runDetail = catchAsync(async (req, res) => {
   // A rider is scoped by their own driver profile; a partner is scoped by the
   // outlet the token identifies. Exactly one of the two is present.
   const run = await deliveryRunService.getRunDetail(
     req.params.run,
     await maybeDriverId(req),
     req.outletId
   );
   res.send({ run });
   });

/**
 * Sequenced stops for a run.
 *
 * @returns {Object[]} stops
 */
const stopList = catchAsync(async (req, res) => {
  const stops = await deliveryRunService.getStops(req.params.run, await driverId(req));
  res.send({ stops, totalResults: stops.length });
});

/**
 * Starts a run at the depot.
 *
 * @returns {Object} run
 */
const startRun = catchAsync(async (req, res) => {
  const { run, stopCount } = await deliveryRunService.startRun(
    req.params.run,
    await driverId(req),
    req.body
  );
  res.send({ run, stopCount });
});

/**
 * Closes a run at the depot.
 *
 * Responds 409 when the can ledger does not balance and no adjustment reason
 * was supplied. The app surfaces this as a blocking gate.
 *
 * @returns {Object} run
 */
const completeRun = catchAsync(async (req, res) => {
  const run = await deliveryRunService.completeRun(
    req.params.run,
    await driverId(req),
    req.body
  );
  res.send({ run });
});

/** @returns {Object} stop */
const arriveStop = catchAsync(async (req, res) => {
  const stop = await deliveryRunService.arriveStop(req.params.stop, await driverId(req), req.body);
  res.send({ stop });
});

/** @returns {Object} stop */
const deliverStop = catchAsync(async (req, res) => {
  const agent = await driverId(req);
  const stop = await deliveryRunService.deliverStop(req.params.stop, agent, {
    ...req.body,
    capturedBy: agent,
  });
  res.send({ stop });
});

/**
 * Skips or fails a stop. `status` is constrained by the route, not the body, so
 * a client cannot mark a stop `delivered` through this path.
 *
 * @returns {Object} stop
 */
const markStop = catchAsync(async (req, res) => {
    // Both spellings are accepted: the rider app sends the past participles
    // `skipped`/`failed`, and the imperatives `skip`/`fail` appear in older builds.
    //
    // This used to test only for `fail`, so the app's `failed` fell through to the
    // `skipped` branch — a delivery failure was recorded as a skip. Both are now
    // compared against the failed set, which cannot silently default.
    const requested = String(req.params.status).toLowerCase();
    const status = ['failed', 'fail'].includes(requested) ? 'failed' : 'skipped';
  const stop = await deliveryRunService.markStop(
    req.params.stop,
    await driverId(req),
    status,
    req.body.reason
  );
  res.send({ stop });
});

/**
 * Creates a run manually for a business. Used by the partner when the nightly
 * manifest job has not produced one.
 *
 * @returns {Object} run
 */
const createRun = catchAsync(async (req, res) => {
  const run = await deliveryRunService.createRun({
    ...req.body,
    business: req.outletId,
  });
  res.send({ run: pick(run, ['_id', 'runNo', 'serviceDate', 'agent', 'agentMode', 'slot', 'status', 'totals']) });
});

/** @returns {Object} paginated runs */
const businessRuns = catchAsync(async (req, res) => {
  const result = await deliveryRunService.getBusinessRuns(req.outletId, req.query);
  res.send(pick(result, ['runs', 'totalResults', 'page', 'limit']));
});

/** @returns {Object} run */
const runCancel = catchAsync(async (req, res) => {
  const run = await deliveryRunService.cancelRun(req.params.run, req.outletId, req.body.reason);
  res.send({ run });
});

module.exports = {
  todayRun,
  agentRuns,
  runDetail,
  stopList,
  startRun,
  completeRun,
  arriveStop,
  deliverStop,
  markStop,
  createRun,
  businessRuns,
  runCancel,
};