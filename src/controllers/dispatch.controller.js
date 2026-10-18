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

const catchAsync = require('../utils/catchAsync');
const metricsService = require('../services/dispatch.metrics.service');
const zoneService = require('../services/delivery.zone.service');
const restaurantService = require('../services/restaurant.service');

/**
 * dispatch.controller.js — read-only operations dashboards (Batch E-2).
 *
 * Pure reads over the audit trail; no writes, no side effects. City-master
 * variants scope exactly like the write paths (D-1): restaurant reads assert
 * restaurant ownership, zone reads assert city ownership.
 */

const pickScope = (query) => {
  const scope = {};
  if (query.restaurantId) scope.restaurantId = query.restaurantId;
  if (query.since) scope.since = query.since;
  if (query.until) scope.until = query.until;
  return scope;
};

const getMetrics = catchAsync(async (req, res) => {
  const result = await metricsService.getDispatchMetrics(pickScope(req.query || {}));
  res.send({ metrics: result, success: true });
});

const cityzenGetMetrics = catchAsync(async (req, res) => {
  const scope = pickScope(req.query || {});
  if (scope.restaurantId) {
    await restaurantService.assertMasterOwnsRestaurant(req.params.master, scope.restaurantId);
  }
  const result = await metricsService.getDispatchMetrics(scope);
  res.send({ metrics: result, success: true });
});

const getZoneMetrics = catchAsync(async (req, res) => {
  const result = await metricsService.getZoneMetrics(req.params.cityId, pickScope(req.query || {}));
  res.send({ metrics: result, success: true });
});

const cityzenGetZoneMetrics = catchAsync(async (req, res) => {
  await zoneService.assertMasterOwnsCity(req.params.master, req.params.cityId);
  const result = await metricsService.getZoneMetrics(req.params.cityId, pickScope(req.query || {}));
  res.send({ metrics: result, success: true });
});

const getUngrouped = catchAsync(async (req, res) => {
  const result = await zoneService.checkUngroupedVolume(req.params.cityId, {
    threshold: req.query.threshold,
  });
  res.send({ ungrouped: result, success: true });
});

const cityzenGetUngrouped = catchAsync(async (req, res) => {
  await zoneService.assertMasterOwnsCity(req.params.master, req.params.cityId);
  const result = await zoneService.checkUngroupedVolume(req.params.cityId, {
    threshold: req.query.threshold,
  });
  res.send({ ungrouped: result, success: true });
});

module.exports = {
  getMetrics,
  cityzenGetMetrics,
  getZoneMetrics,
  cityzenGetZoneMetrics,
  getUngrouped,
  cityzenGetUngrouped,
};
