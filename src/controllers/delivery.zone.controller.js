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
const zoneService = require('../services/delivery.zone.service');

const actorOf = (req) => (req && req.user && (req.user.id || req.user._id)) || null;

const listByCity = catchAsync(async (req, res) => {
  const result = await zoneService.listZonesByCity(req.params.cityId);
  res.send({ zones: result, success: true });
});

const propose = catchAsync(async (req, res) => {
  const result = await zoneService.proposeZones(req.params.cityId, {
    maxDiameterKm: req.query.maxDiameterKm,
  });
  res.send({ ...result, success: true });
});

const publish = catchAsync(async (req, res) => {
  const { groups, reason, maxDiameterKm } = req.body || {};
  const result = await zoneService.publishZones(req.params.cityId, groups, {
    updatedBy: actorOf(req),
    reason,
    maxDiameterKm,
  });
  res.send({ ...result, success: true });
});

const move = catchAsync(async (req, res) => {
  const { toZoneId, reason } = req.body || {};
  const result = await zoneService.moveLocality(req.params.localityId, toZoneId, {
    updatedBy: actorOf(req),
    reason,
  });
  res.send({ ...result, success: true });
});

// City-master variants: identical behaviour, additionally scoped to the
// master's own city (403 otherwise). Auth is role-rights only, so the
// service enforces ownership — see assertMasterOwnsCity.
const cityzenListByCity = catchAsync(async (req, res) => {
  const result = await zoneService.listZonesByCity(req.params.cityId, { masterId: req.params.master });
  res.send({ zones: result, success: true });
});

const cityzenPropose = catchAsync(async (req, res) => {
  const result = await zoneService.proposeZones(req.params.cityId, {
    maxDiameterKm: req.query.maxDiameterKm,
    masterId: req.params.master,
  });
  res.send({ ...result, success: true });
});

const cityzenPublish = catchAsync(async (req, res) => {
  const { groups, reason, maxDiameterKm } = req.body || {};
  const result = await zoneService.publishZones(req.params.cityId, groups, {
    updatedBy: actorOf(req),
    reason,
    maxDiameterKm,
    masterId: req.params.master,
  });
  res.send({ ...result, success: true });
});

const cityzenMove = catchAsync(async (req, res) => {
  const { toZoneId, reason } = req.body || {};
  const result = await zoneService.moveLocality(req.params.localityId, toZoneId, {
    updatedBy: actorOf(req),
    reason,
    masterId: req.params.master,
  });
  res.send({ ...result, success: true });
});

const cityzenMyCity = catchAsync(async (req, res) => {
  const result = await zoneService.getMasterCity(req.params.master);
  res.send({ city: result, success: true });
});

module.exports = {
  listByCity,
  propose,
  publish,
  move,
  cityzenListByCity,
  cityzenPropose,
  cityzenPublish,
  cityzenMove,
  cityzenMyCity,
};
