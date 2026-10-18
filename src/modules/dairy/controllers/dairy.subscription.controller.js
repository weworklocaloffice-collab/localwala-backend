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
const dairySubscriptionService = require('../services/dairy.subscription.service');
const dairyManifestService = require('../services/dairy.manifest.service');

/**
/**
 * Creates and activates a plan. Stock is reserved at creation, not at
 * generation, so two customers cannot both be promised the last litre.
 */
  const create = catchAsync(async (req, res) => {
  const { subscription, amount } = await dairySubscriptionService.createSubscription({
    ...req.body,
    // The plan holder is whoever is signed in. `user` used to come from the body,
    // which let any customer open a plan against another customer's account and
    // have the deliveries billed to them.
    user: req.user._id,
    actor: req.user._id,
  });
  res.send({ subscription, amount });
});

/** @returns {Object} paginated subscriptions */
const list = catchAsync(async (req, res) => {
  const result = await dairySubscriptionService.listSubscriptions(req.query);
  res.send(pick(result, ['subscriptions', 'totalResults', 'page', 'limit']));
});

/** @returns {Object} subscription */
const detail = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.getSubscription(req.params.subscription, {
    userId: req.query.user,
  });
  res.send({ subscription });
});

/** @returns {Object[]} upcoming deliveries */
const upcoming = catchAsync(async (req, res) => {
  const result = await dairySubscriptionService.getUpcoming(req.params.subscription, req.query);
  res.send({ upcoming: result });
});

/** @returns {Object[]} append-only lifecycle history */
const events = catchAsync(async (req, res) => {
  const result = await dairySubscriptionService.listEvents(req.params.subscription, req.query);
  res.send({ events: result, totalResults: result.length });
});

const skip = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.skipDate(
    req.params.subscription,
    req.body.date,
    req.body
  );
  res.send({ subscription });
});

const unskip = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.unskipDate(
    req.params.subscription,
    req.body.date,
    req.body
  );
  res.send({ subscription });
});

const pause = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.pause(req.params.subscription, req.body);
  res.send({ subscription });
});

const resume = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.resume(req.params.subscription, req.body);
  res.send({ subscription });
});

const changeQuantity = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.changeQuantity(
    req.params.subscription,
    req.body.quantity,
    req.body
  );
  res.send({ subscription });
});

const changeAddress = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.changeAddress(req.params.subscription, req.body);
  res.send({ subscription });
});

const changeSchedule = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.changeSchedule(req.params.subscription, req.body);
  res.send({ subscription });
});

const cancel = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.cancel(req.params.subscription, req.body);
  res.send({ subscription });
});

const reactivate = catchAsync(async (req, res) => {
  const subscription = await dairySubscriptionService.reactivate(req.params.subscription, req.body);
  res.send({ subscription });
});

// //// Manifest ////

/**
 * Previews what a date would produce. Writes nothing, so an operator can check
 * tomorrow's volume before committing rider assignments.
 *
 * @returns {Object} preview
 */
const manifestPreview = catchAsync(async (req, res) => {
  const preview = await dairyManifestService.previewManifest(req.query.date || new Date());
  res.send({ preview });
});

/**
 * Runs the generator for a date. Idempotent, so a manual re-run after a failure
 * is safe.
 *
 * @returns {Object} summary
 */
const manifestGenerate = catchAsync(async (req, res) => {
  const summary = await dairyManifestService.runManifestJob(req.query.date);
  res.send({ summary });
});

/** @returns {Object} run and occurrence counts for a date */
const manifestSummary = catchAsync(async (req, res) => {
  const summary = await dairyManifestService.getDaySummary(req.query.date || new Date());
  res.send({ summary });
});

/**
 * Demand forecast for procurement — how many cans of each SKU are owed out over
 * the coming days.
 *
 * @returns {Object[]} forecast
 */
const demandForecast = catchAsync(async (req, res) => {
  const forecast = await dairyManifestService.getDemandForecast(
    req.query.date || new Date(),
    req.query.daysAhead !== undefined ? parseInt(req.query.daysAhead, 10) : 3
  );
  res.send({ forecast });
});

module.exports = {
  create,
  list,
  detail,
  upcoming,
  events,
  skip,
  unskip,
  pause,
  resume,
  changeQuantity,
  changeAddress,
  changeSchedule,
  cancel,
  reactivate,
  manifestPreview,
  manifestGenerate,
  manifestSummary,
  demandForecast,
};