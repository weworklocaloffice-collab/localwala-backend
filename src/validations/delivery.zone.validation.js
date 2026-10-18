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

/**
 * delivery.zone.validation.js — Joi schemas for the zone publish flow.
 *
 * Bounds mirror `services/delivery.zone.service.js` so validation and
 * persistence can never disagree. The routes that accept these payloads land
 * with the Settings screen (Batch B); until then the service is called
 * directly and these schemas document the contract.
 */

const Joi = require('joi');
const { objectId } = require('./custom.validation');

const zoneGroupSchema = Joi.object().keys({
  name: Joi.string().max(120).allow('', null),
  localities: Joi.array().items(Joi.string().custom(objectId)).min(1).max(100).required(),
});

const publishZones = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    groups: Joi.array().items(zoneGroupSchema).min(1).max(50).required(),
    reason: Joi.string().max(500).allow('', null),
    maxDiameterKm: Joi.number().min(1).max(100).allow(null),
  }),
};

const moveLocality = {
  params: Joi.object().keys({
    localityId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    toZoneId: Joi.string().custom(objectId).required(),
    reason: Joi.string().max(500).allow('', null),
  }),
};

const cityZones = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId).required(),
  }),
};

// City-master routes carry `:master` alongside the resource id. The validate
// middleware rejects unknown params, so these variants declare both — same
// query/body, cityzen handlers that additionally scope to the master's city.
const masterParams = (extra) =>
  Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
    ...extra,
  });

const cityzenCityZones = {
  params: masterParams({ cityId: Joi.string().custom(objectId).required() }),
};

const cityzenProposeZones = {
  params: masterParams({ cityId: Joi.string().custom(objectId).required() }),
  query: Joi.object().keys({
    maxDiameterKm: Joi.number().min(1).max(100).allow(null, ''),
  }),
};

const cityzenPublishZones = {
  params: masterParams({ cityId: Joi.string().custom(objectId).required() }),
  body: publishZones.body,
};

const cityzenMoveLocality = {
  params: masterParams({ localityId: Joi.string().custom(objectId).required() }),
  body: moveLocality.body,
};

const cityzenMaster = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
};

const proposeZones = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    maxDiameterKm: Joi.number().min(1).max(100).allow(null, ''),
  }),
};

module.exports = {
  zoneGroupSchema,
  publishZones,
  proposeZones,
  moveLocality,
  cityZones,
  cityzenCityZones,
  cityzenProposeZones,
  cityzenPublishZones,
  cityzenMoveLocality,
  cityzenMaster,
};
