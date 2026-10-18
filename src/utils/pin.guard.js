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
 * pin.guard.js — pin meaning checks for create paths (Batch A-5).
 *
 * Joi guards *shape* (numbers in range -90..90 / -180..180, shared via
 * `validations/custom.validation.js`). This module asserts *meaning*:
 *
 *   - not Null Island: [0,0] passes every range check and is never a kitchen,
 *     a rider or a household. Created rows with it die silently downstream
 *     ($geoNear never matches a mid-Atlantic pin — no error, just no orders).
 *   - pin in city: a pin whose nearest locality is not in the selected city
 *     is a wrong-city registration. Checked against the locality master, so
 *     no boundary data is needed.
 *   - locality in city: the stated locality must belong to the selected city
 *     ("Kukatpally" exists in two cities — without this, coverage silently
 *     resolves across a city boundary).
 *
 * All throw 422. Applied on create paths only — heartbeats and updates keep
 * their current behaviour (a separate, explicitly-priced change).
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('./ApiError');
const { Locality } = require('../models');

// Beyond this, a pin is plausibly outside its claimed city rather than on an
// edge. Generous on purpose: this guard catches wrong-city/wrong-state pins,
// not border disputes — those stay human-reviewable.
const PIN_CITY_SEARCH_KM = 25;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @throws {ApiError} 422 on out-of-range coordinates
 */
const assertPinRanges = (longitude, latitude, label = 'Location') => {
  const lng = num(longitude);
  const lat = num(latitude);
  if (lng === null || lat === null || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `${label} coordinates are out of range`);
  }
  return { longitude: lng, latitude: lat };
};

/**
 * @throws {ApiError} 422 on [0,0] (or near-zero) pins
 */
const assertPinNotNullIsland = (longitude, latitude, label = 'Location') => {
  const lng = num(longitude);
  const lat = num(latitude);
  if ((lng === 0 || lng === null) && (lat === 0 || lat === null)) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `${label} pin is not set — drop the map marker on the exact location`
    );
  }
  if (lng !== null && lat !== null && Math.abs(lng) < 0.001 && Math.abs(lat) < 0.001) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `${label} pin is not set`);
  }
  return { longitude: lng, latitude: lat };
};

/**
 * Both range and meaning checks in one call for create paths.
 */
const assertUsablePin = (longitude, latitude, label = 'Location') => {
  assertPinRanges(longitude, latitude, label);
  return assertPinNotNullIsland(longitude, latitude, label);
};

/**
 * The stated locality must belong to the stated city.
 *
 * @throws {ApiError} 422 on cross-city localities, 404 on unknown ones
 */
const assertLocalityInCity = async (localityId, cityId, label = 'Locality') => {
  if (!localityId || localityId === '') return null;
  if (!mongoose.Types.ObjectId.isValid(localityId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `${label} is not valid`);
  }
  const locality = await Locality.findById(localityId, { city: 1 }).lean();
  if (!locality) throw new ApiError(httpStatus.NOT_FOUND, `${label} not found`);
  if (String(locality.city) !== String(cityId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `${label} does not belong to the selected city`);
  }
  return locality;
};

/**
 * The pin's nearest locality must be in the selected city. Skipped (passes)
 * when the city has no localities — without master data there is nothing to
 * validate against, and onboarding must not block on it.
 *
 * @throws {ApiError} 422 when the pin is outside the selected city
 */
const assertPinInCity = async (cityId, longitude, latitude, label = 'Location') => {
  const lng = num(longitude);
  const lat = num(latitude);
  if (!cityId || !mongoose.Types.ObjectId.isValid(cityId)) return null;
  const localityCount = await Locality.countDocuments({
    city: new mongoose.Types.ObjectId(cityId),
    status: true,
  });
  if (localityCount === 0) return null;
  const nearest = await Locality.find({
    city: new mongoose.Types.ObjectId(cityId),
    status: true,
    location: {
      $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: PIN_CITY_SEARCH_KM * 1000 },
    },
  })
    .limit(1)
    .lean();
  if (!nearest.length) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `${label} pin is outside the selected city — move the marker to the exact location`
    );
  }
  return nearest[0];
};

module.exports = {
  PIN_CITY_SEARCH_KM,
  assertPinRanges,
  assertPinNotNullIsland,
  assertUsablePin,
  assertLocalityInCity,
  assertPinInCity,
};
