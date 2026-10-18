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
 * Real Estate geo helpers — pure maths, no database.
 *
 * DB-backed geography (zone lookup, boundary containment against
 * stored polygons) lives in `kernel/geographic/services/geographic.service.js`.
 * This file holds the small functions every Real Estate service needs
 * inline: distance for the BR-08 geofence, coordinate validation
 * (including the `[0, 0]` null-island reject), and radius conversion
 * for `$centerSphere` queries.
 *
 * Kept separate from the kernel service on purpose: the kernel must
 * stay vertical-agnostic, and these defaults (200 m check-in radius,
 * 50 km search ceiling) are Real Estate policy, not platform maths.
 */

const EARTH_RADIUS_METERS = 6378137;
const DEFAULT_CHECK_IN_RADIUS_METERS = 200;
const SEARCH_MAX_RADIUS_KM = 50;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in metres between two [lng, lat] pairs.
 * Same formula as the kernel service — duplicated here so callers
 * that only need maths do not pull in models.
 */
function haversineMeters(lng1, lat1, lng2, lat2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Validate a [lng, lat] pair. Rejects null-island [0, 0] — a failed
 * geocode must not be publishable, because it silently matches any
 * radius search centred on the Atlantic.
 */
function isValidCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;
  const [lng, lat] = coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng === 0 && lat === 0) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat < -90 || lat > 90) return false;
  return true;
}

function assertValidCoordinates(coordinates) {
  if (!isValidCoordinates(coordinates)) {
    throw new Error('Invalid coordinates. Expected [lng, lat] within bounds and not [0, 0].');
  }
}

/**
 * BR-08 geofence: is the executive within the visit's check-in radius?
 */
function isWithinRadius(execLng, execLat, propLng, propLat, radiusMeters) {
  const distance = haversineMeters(execLng, execLat, propLng, propLat);
  return { within: distance <= radiusMeters, distanceMeters: distance };
}

function assertWithinRadius(execLng, execLat, propLng, propLat, radiusMeters) {
  const { within, distanceMeters } = isWithinRadius(execLng, execLat, propLng, propLat, radiusMeters);
  if (!within) {
    const err = new Error(
      `Check-in outside range: ${Math.round(distanceMeters)} m from property, allowed ${radiusMeters} m.`
    );
    err.code = 'CHECK_IN_OUT_OF_RANGE';
    err.details = { distanceMeters, radiusMeters };
    throw err;
  }
  return distanceMeters;
}

/** Convert metres to radians for `$centerSphere`. */
function metersToRadians(meters) {
  return meters / EARTH_RADIUS_METERS;
}

module.exports = {
  EARTH_RADIUS_METERS,
  DEFAULT_CHECK_IN_RADIUS_METERS,
  SEARCH_MAX_RADIUS_KM,
  toRadians,
  haversineMeters,
  isValidCoordinates,
  assertValidCoordinates,
  isWithinRadius,
  assertWithinRadius,
  metersToRadians,
};
