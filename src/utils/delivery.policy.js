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
 * delivery.policy.js — per-restaurant dispatch policy (Phase 3, task 3-1)
 * and polygon delivery zones (task 3-2).
 *
 * ## The fallback rule (plan §5.1 C-2)
 *
 * `BusinessSettings.deliveryArea` has ~20 readers across 15+ food services.
 * This module is *purely additive*: a restaurant's `deliveryConfig` *overrides*
 * per field, and every absent field falls back to the platform value. An
 * absent config is behaviourally identical to today, and deleting the config
 * restores the old behaviour with no migration. The field is never repurposed
 * or removed.
 *
 * ## Zones consume the kernel, never modify it (plan §5.1 C-1)
 *
 * Polygon checks go through `kernel/geographic`'s `classifyGeometry` /
 * `pointInRings` / `haversineMeters` exactly as exported. Their signatures
 * are shared with Real Estate; nothing here changes them.
 *
 * Food only. No vertical (stores / jhatka / dairy / realestate) imports this.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('./ApiError');
const { Restaurant, BusinessSettings, City, Locality, UserAddress } = require('../models');
const { resolveDeliveryRadius } = require('./rider.pool');
const geographicService = require('../kernel/geographic/services/geographic.service');
const zoneService = require('../services/delivery.zone.service');
const { DEFAULT_SURGE } = require('../kernel/dispatch/dispatch.surge');

const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 50000;
const MIN_BATCH = 1;
const MAX_BATCH = 20;
const MIN_TTL_SECONDS = 10;
const MAX_TTL_SECONDS = 600;
const MIN_ATTEMPTS = 1;
const MAX_ATTEMPTS = 10;
const MAX_ZONES = 20;
const MAX_LADDER_RUNGS = 8;

const clampInt = (n, lo, hi, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
};

/**
 * Sanitize one ladder rung. A rung missing every field is dropped (returns
 * null) so a half-filled admin form cannot create a zero-radius rung that
 * matches no rider and silently stalls the order.
 */
const sanitizeRung = (rung) => {
  if (!rung || typeof rung !== 'object') return null;
  const hasAny =
    rung.radiusMeters !== undefined && rung.radiusMeters !== null
    || rung.batchSize !== undefined && rung.batchSize !== null
    || rung.ttlSeconds !== undefined && rung.ttlSeconds !== null;
  if (!hasAny) return null;
  return {
    radiusMeters: clampInt(rung.radiusMeters, MIN_RADIUS_METERS, MAX_RADIUS_METERS, 2000),
    batchSize: clampInt(rung.batchSize, MIN_BATCH, MAX_BATCH, 1),
    ttlSeconds: clampInt(rung.ttlSeconds, MIN_TTL_SECONDS, MAX_TTL_SECONDS, 30),
  };
};

const sanitizeLadder = (ladder) => {
  if (!Array.isArray(ladder) || !ladder.length) return null;
  const rungs = ladder.map(sanitizeRung).filter(Boolean).slice(0, MAX_LADDER_RUNGS);
  return rungs.length ? rungs : null;
};

const sanitizeNumberArray = (arr, lo, hi, maxLen) => {
  if (!Array.isArray(arr) || !arr.length) return null;
  const out = arr
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.min(hi, Math.max(lo, Math.floor(n))))
    .slice(0, maxLen);
  return out.length ? out : null;
};

const MAX_SERVED_LOCALITIES = 100;

const sanitizeLocalities = (localities) => {
  if (!Array.isArray(localities) || !localities.length) return null;
  const ids = [...new Set(localities.map(String))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );
  if (!ids.length) return null;
  return ids.slice(0, MAX_SERVED_LOCALITIES);
};

const sanitizeZones = (zones) => {  if (!Array.isArray(zones) || !zones.length) return null;
  const out = [];
  for (const z of zones.slice(0, MAX_ZONES)) {
    if (!z || typeof z !== 'object') continue;
    // Geometry is validated lazily at read time by `classifyGeometry`, not
    // here: rejecting a stored zone on a shape the kernel would have accepted
    // (RING vs POLYGON differ by one nesting level) is exactly the bug the
    // kernel classifier exists to remove.
    if (z.geometry === undefined || z.geometry === null) continue;
    out.push({
      name: typeof z.name === 'string' ? z.name.slice(0, 120) : '',
      geometry: z.geometry,
      enabled: z.enabled !== false,
    });
  }
  return out.length ? out : null;
};

const sanitizePeakHours = (peakHours) => {
  if (!Array.isArray(peakHours) || !peakHours.length) return null;
  const out = [];
  for (const w of peakHours.slice(0, 12)) {
    if (!w || typeof w !== 'object') continue;
    const startHour = Number(w.startHour);
    const endHour = Number(w.endHour);
    const multiplier = Number(w.multiplier);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) continue;
    if (!Number.isFinite(multiplier) || multiplier < 1) continue;
    out.push({
      startHour: ((Math.floor(startHour) % 24) + 24) % 24,
      endHour: ((Math.floor(endHour) % 24) + 24) % 24,
      multiplier: Math.min(5, multiplier),
    });
  }
  return out.length ? out : null;
};

const sanitizeSurge = (surge) => {
  if (!surge || typeof surge !== 'object') return null;
  const policy = {
    enabled: surge.enabled === true,
    demandThreshold:
      Number(surge.demandThreshold) > 0 ? Number(surge.demandThreshold) : DEFAULT_SURGE.demandThreshold,
    multiplierCap:
      Number(surge.multiplierCap) >= 1 ? Math.min(5, Number(surge.multiplierCap)) : DEFAULT_SURGE.multiplierCap,
    peakHours: sanitizePeakHours(surge.peakHours) || [],
  };
  return policy;
};

/**
 * Sanitize a raw `deliveryConfig` patch. Unknown keys are dropped; invalid
 * values fall back per field rather than failing the whole write, so one bad
 * rung does not block an unrelated radius change.
 *
 * @param {object} [patch]
 * @returns {object} sanitized patch (possibly empty)
 */
const sanitizeDeliveryConfig = (patch = {}) => {
  if (!patch || typeof patch !== 'object') return {};
  const out = {};

  if (patch.deliveryRadiusMeters !== undefined && patch.deliveryRadiusMeters !== null) {
    const v = Number(patch.deliveryRadiusMeters);
    if (Number.isFinite(v) && v > 0) {
      out.deliveryRadiusMeters = Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.floor(v)));
    }
  }
  if (patch.fleetFirst !== undefined && patch.fleetFirst !== null) {
    out.fleetFirst = patch.fleetFirst === true;
  }
  const batchSizes = sanitizeNumberArray(patch.batchSizes, MIN_BATCH, MAX_BATCH, MAX_LADDER_RUNGS);
  if (batchSizes) out.batchSizes = batchSizes;
  const offerTtlSeconds = sanitizeNumberArray(patch.offerTtlSeconds, MIN_TTL_SECONDS, MAX_TTL_SECONDS, MAX_LADDER_RUNGS);
  if (offerTtlSeconds) out.offerTtlSeconds = offerTtlSeconds;
  const ladder = sanitizeLadder(patch.escalationLadder);
  if (ladder) out.escalationLadder = ladder;
  if (patch.maxDispatchAttempts !== undefined && patch.maxDispatchAttempts !== null) {
    const v = Number(patch.maxDispatchAttempts);
    if (Number.isFinite(v)) out.maxDispatchAttempts = clampInt(v, MIN_ATTEMPTS, MAX_ATTEMPTS, null);
  }
  const zones = sanitizeZones(patch.zones);
  if (zones) out.zones = zones;
  const localities = sanitizeLocalities(patch.localities);
  if (localities) out.localities = localities;
  const surge = sanitizeSurge(patch.surge);
  if (surge) out.surge = surge;

  return out;
};

/**
 * Vendor self-narrowing (Batch D-2). A restaurant may shrink its own coverage
 * any time — fewer promises hurt no one — but never widen it: widening makes
 * promises to customers and work for riders, so it stays a city-master
 * approval. No `clearKeys` here by design: resetting to inheritance can
 * widen (a higher city default), so even resets go through the master.
 *
 * @param {string} vendorUserId User _id of the authenticated vendor
 * @param {object} [patch] only deliveryRadiusMeters and/or localities
 * @returns {Promise<object>} the restaurant's deliveryConfig after the write
 * @throws {ApiError} 404 with no restaurant, 422 on any widening
 */
const narrowDeliveryConfig = async (vendorUserId, patch = {}) => {
  if (!vendorUserId || !mongoose.Types.ObjectId.isValid(vendorUserId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Vendor is not valid');
  }
  const restaurant = await Restaurant.findOne(
    { userId: new mongoose.Types.ObjectId(vendorUserId) },
    { city: 1, locality: 1, location: 1 }
  ).lean();
  if (!restaurant) throw new ApiError(httpStatus.NOT_FOUND, 'No restaurant found for this vendor');

  const effective = await resolveDeliveryPolicy(restaurant._id);
  const requested = sanitizeDeliveryConfig(patch);
  const narrowed = {};

  if (requested.deliveryRadiusMeters !== undefined) {
    if (requested.deliveryRadiusMeters > effective.radiusMeters) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Widening coverage needs city-master approval (current effective ${effective.radiusMeters}m)`
      );
    }
    narrowed.deliveryRadiusMeters = requested.deliveryRadiusMeters;
  }

  if (requested.localities) {
    // Current effective served set: the explicit list when set, else the
    // kitchen zone's localities, else localities within rider range.
    let currentSet = new Set((effective.localities || []).map(String));
    if (!currentSet.size) {
      let zoneLocalities = [];
      if (restaurant.locality) {
        try {
          const zoneService = require('../services/delivery.zone.service');
          const zone = await zoneService.resolveZoneForLocality(effective.cityId, restaurant.locality);
          if (zone) zoneLocalities = (zone.localities || []).map(String);
        } catch {
          zoneLocalities = [];
        }
      }
      if (zoneLocalities.length) {
        currentSet = new Set(zoneLocalities);
      } else if (kitchenInRange(effective)) {
        currentSet = await localitiesWithinRadius(effective);
      }
    }
    const outside = requested.localities.filter((id) => !currentSet.has(String(id)));
    if (outside.length) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        'Widening coverage needs city-master approval — only currently served localities can be kept'
      );
    }
    narrowed.localities = requested.localities;
  }

  if (!Object.keys(narrowed).length) {
    const cfg = await Restaurant.findById(restaurant._id, { deliveryConfig: 1 }).lean();
    return (cfg && cfg.deliveryConfig) || {};
  }
  return updateDeliveryConfig(restaurant._id, narrowed);
};

const kitchenInRange = (effective) =>
  Array.isArray(effective.kitchenCoords) &&
  effective.kitchenCoords.length >= 2 &&
  Number.isFinite(effective.radiusMeters) &&
  effective.radiusMeters > 0;

const localitiesWithinRadius = async (effective) => {
  const rows = await Locality.find({
    city: new mongoose.Types.ObjectId(effective.cityId),
    status: true,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [effective.kitchenCoords[0], effective.kitchenCoords[1]] },
        $maxDistance: effective.radiusMeters,
      },
    },
  })
    .limit(200)
    .lean();
  return new Set(rows.map((r) => String(r._id)));
};

/**
 * Persist a sanitized `deliveryConfig` patch onto a restaurant. Additive: only
 * the given keys are set; everything else keeps its value. Pass `{ key: null }`
 * semantics via `clearKeys` to remove an override and restore the fallback.
 *
 * @param {string} restaurantId
 * @param {object} [patch]
 * @param {string[]} [clearKeys] top-level deliveryConfig keys to `$unset`
 * @returns {Promise<object>} the restaurant's deliveryConfig after the write
 */
const updateDeliveryConfig = async (restaurantId, patch = {}, clearKeys = []) => {
  if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Restaurant is not valid');
  }
  const restaurant = await Restaurant.findById(restaurantId, { deliveryConfig: 1, city: 1 });
  if (!restaurant) throw new ApiError(httpStatus.NOT_FOUND, 'Restaurant not found');

  const sanitized = sanitizeDeliveryConfig(patch);

  // City guard: served localities must all belong to the restaurant's city.
  // "Kukatpally" exists in two cities — without this, a ticked id can silently
  // resolve across a city boundary and cover the wrong households.
  if (sanitized.localities) {
    const inCity = await Locality.countDocuments({
      _id: { $in: sanitized.localities.map((id) => new mongoose.Types.ObjectId(id)) },
      city: restaurant.city,
    });
    if (inCity !== sanitized.localities.length) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        'Every served locality must belong to the restaurant city'
      );
    }
  }
  const set = {};
  for (const [key, value] of Object.entries(sanitized)) {
    set[`deliveryConfig.${key}`] = value;
  }
  const unset = {};
  for (const key of clearKeys || []) {
    unset[`deliveryConfig.${key}`] = 1;
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) {
    return (restaurant.deliveryConfig && restaurant.deliveryConfig.toObject
      ? restaurant.deliveryConfig.toObject()
      : restaurant.deliveryConfig) || {};
  }

  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  const updated = await Restaurant.findByIdAndUpdate(restaurantId, update, {
    new: true,
    projection: { deliveryConfig: 1 },
  });
  const cfg = updated && updated.deliveryConfig;
  return (cfg && cfg.toObject ? cfg.toObject() : cfg) || {};
};

/**
 * Resolve the effective dispatch policy for a restaurant: per-restaurant
 * overrides merged over the platform defaults. An absent config returns the
 * platform values untouched.
 *
 * @param {string} restaurantId
 * @returns {Promise<{restaurantId, radiusMeters, findMode, ladder, maxAttempts, fleetFirst, zones, surge, sources}>}
 */
const resolveDeliveryPolicy = async (restaurantId) => {
  const { radiusMeters: platformRadius, findMode } = await resolveDeliveryRadius();
  const businessSettings = await BusinessSettings.findOne(
    {},
    { dispatchMaxAttempts: 1 }
  ).lean().catch(() => null);

  const restaurant = await Restaurant.findById(restaurantId, {
    deliveryConfig: 1,
    location: 1,
    name: 1,
    city: 1,
  }).lean();
  if (!restaurant) throw new ApiError(httpStatus.NOT_FOUND, 'Restaurant not found');

  const cfg = (restaurant && restaurant.deliveryConfig) || {};
  const sources = {};

  // Radius precedence (Batch A-1): restaurant override → city default →
  // platform. Every layer is admin-set; an unset layer falls through, so a
  // restaurant with no config in a city with no default behaves exactly as
  // before (platform radius).
  const clampRadius = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.floor(n)));
  };

  let cityRadius = null;
  try {
    if (restaurant.city) {
      const city = await City.findById(restaurant.city, { defaultDeliveryRadiusMeters: 1 }).lean();
      cityRadius = city ? clampRadius(city.defaultDeliveryRadiusMeters) : null;
    }
  } catch {
    cityRadius = null;
  }

  let radiusMeters = platformRadius;
  sources.radius = 'platform';
  if (cityRadius !== null) {
    radiusMeters = cityRadius;
    sources.radius = 'city';
  }
  const restaurantRadius = clampRadius(cfg.deliveryRadiusMeters);
  if (restaurantRadius !== null) {
    radiusMeters = restaurantRadius;
    sources.radius = 'restaurant';
  }

  let ladder = sanitizeLadder(cfg.escalationLadder);
  sources.ladder = ladder ? 'restaurant' : 'derived';
  if (!ladder) {
    // Compose from parallel arrays when given, else leave null for the
    // caller to substitute the platform default ladder.
    const sizes = sanitizeNumberArray(cfg.batchSizes, MIN_BATCH, MAX_BATCH, MAX_LADDER_RUNGS);
    const ttls = sanitizeNumberArray(cfg.offerTtlSeconds, MIN_TTL_SECONDS, MAX_TTL_SECONDS, MAX_LADDER_RUNGS);
    if (sizes || ttls) {
      const len = Math.max(sizes ? sizes.length : 0, ttls ? ttls.length : 0);
      const radii = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000];
      ladder = [];
      for (let i = 0; i < len; i++) {
        ladder.push({
          radiusMeters: Math.min(radii[Math.min(i, radii.length - 1)], radiusMeters),
          batchSize: sizes ? sizes[Math.min(i, sizes.length - 1)] : 1,
          ttlSeconds: ttls ? ttls[Math.min(i, ttls.length - 1)] : 30,
        });
      }
      sources.ladder = 'restaurant';
    }
  }

  let maxAttempts = null;
  sources.maxAttempts = 'platform';
  if (Number(cfg.maxDispatchAttempts) > 0) {
    maxAttempts = clampInt(cfg.maxDispatchAttempts, MIN_ATTEMPTS, MAX_ATTEMPTS, null);
    sources.maxAttempts = 'restaurant';
  } else if (businessSettings && Number(businessSettings.dispatchMaxAttempts) > 0) {
    maxAttempts = clampInt(businessSettings.dispatchMaxAttempts, MIN_ATTEMPTS, MAX_ATTEMPTS, null);
    sources.maxAttempts = 'businessSettings';
  }

  const kitchenCoords =
    restaurant.location && Array.isArray(restaurant.location.coordinates)
      ? restaurant.location.coordinates.slice(0, 2)
      : null;

  return {
    restaurantId: String(restaurantId),
    cityId: restaurant.city ? String(restaurant.city) : null,
    kitchenCoords,
    radiusMeters,
    findMode,
    ladder,
    maxAttempts,
    fleetFirst: cfg.fleetFirst === true ? true : cfg.fleetFirst === false ? false : null,
    zones: sanitizeZones(cfg.zones) || [],
    localities: sanitizeLocalities(cfg.localities) || [],
    surge: sanitizeSurge(cfg.surge) || { ...DEFAULT_SURGE, peakHours: [] },
    sources: {
      ...sources,
      localities: (sanitizeLocalities(cfg.localities) || []).length ? 'restaurant' : 'inherit',
    },
  };
};

/**
 * Enabled zones for a restaurant: the polygon set the customer pin is tested
 * against. Disabled zones are skipped, not deleted, so a zone can be toggled
 * without losing its geometry.
 *
 * @param {object} cfg sanitized or raw deliveryConfig
 * @returns {Array<{name, geometry}>}
 */
const enabledZones = (cfg = {}) => {
  const zones = sanitizeZones(cfg.zones) || [];
  return zones.filter((z) => z.enabled !== false && z.geometry !== null && z.geometry !== undefined);
};

/**
 * Is a customer pin inside this restaurant's service area?
 *
 * With no zones configured this is the same radius check the platform has
 * always used (kitchen → pin ≤ radius). With zones it is a point-in-polygon
 * test against every enabled zone, and the radius becomes a backstop: a pin
 * inside a zone but beyond the radius is still outside. That ordering matters —
 * a zone drawn wider than the delivery area must not silently extend it.
 *
 * @param {object} params
 * @param {number[]} params.kitchenCoords `[lng, lat]`
 * @param {number} params.customerLng
 * @param {number} params.customerLat
 * @param {object} [params.deliveryConfig] raw or sanitized
 * @param {number} params.radiusMeters fallback radius (platform or override)
 * @returns {{inside: boolean, reason: string, zone: string|null}}
 */
const isCustomerInDeliveryArea = ({ kitchenCoords, customerLng, customerLat, deliveryConfig = {}, radiusMeters }) => {
  const lng = Number(customerLng);
  const lat = Number(customerLat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { inside: false, reason: 'invalid_pin', zone: null };
  }

  const zones = enabledZones(deliveryConfig);
  if (zones.length) {
    let inZone = null;
    for (const z of zones) {
      // Consumed as-is (C-1). Accepts RING, POLYGON or MULTIPOLYGON. A stored
      // zone the classifier rejects reads as "outside", so one bad row cannot
      // fail a coverage query.
      let inside;
      try {
        inside = geographicService.pointInRings(z.geometry, lng, lat);
      } catch {
        inside = false;
      }
      if (inside) {
        inZone = z;
        break;
      }
    }
    if (!inZone) return { inside: false, reason: 'outside_zones', zone: null };
    if (
      Array.isArray(kitchenCoords) && kitchenCoords.length >= 2
      && Number.isFinite(radiusMeters) && radiusMeters > 0
    ) {
      const metres = geographicService.haversineMeters(kitchenCoords[0], kitchenCoords[1], lng, lat);
      if (metres > radiusMeters) return { inside: false, reason: 'beyond_radius', zone: inZone.name || null };
    }
    return { inside: true, reason: 'inside_zone', zone: inZone.name || null };
  }

  if (
    !Array.isArray(kitchenCoords) || kitchenCoords.length < 2
    || !Number.isFinite(radiusMeters) || radiusMeters <= 0
  ) {
    return { inside: false, reason: 'no_coverage', zone: null };
  }
  const metres = geographicService.haversineMeters(kitchenCoords[0], kitchenCoords[1], lng, lat);
  return metres <= radiusMeters
    ? { inside: true, reason: 'inside_radius', zone: null }
    : { inside: false, reason: 'beyond_radius', zone: null };
};

/**
 * Nearest active locality in a city to a pin, or null when nothing is within
 * range (the pin is plausibly outside the city — null, not a wrong answer).
 */
const nearestLocalityInCity = async (cityId, lng, lat, maxDistanceKm = 25) => {
  const x = Number(lng);
  const y = Number(lat);
  if (!cityId || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const rows = await Locality.find({
    city: new mongoose.Types.ObjectId(cityId),
    status: true,
    location: {
      $near: { $geometry: { type: 'Point', coordinates: [x, y] }, $maxDistance: maxDistanceKm * 1000 },
    },
  })
    .limit(1)
    .lean();
  return rows.length ? rows[0] : null;
};

/**
 * Checkout guard (Batch E-1). The single funnel every home-delivery order
 * passes through: a decidable-but-uncovered pin is refused with 422 instead
 * of becoming a doomed order no rider can reach (the original stuck-order
 * bug, previously silent — now loud at the only moment the customer can act
 * on it: before paying).
 *
 * Deliberately narrow: self-pickup skips, unresolvable pins allow (today's
 * behaviour — an old address without coordinates must not start failing),
 * and only a pin the restaurant demonstrably cannot serve is refused.
 *
 * @param {object} params { restaurantId, orderTo, deliveryAddress, deliveryAddressRaw }
 * @returns {Promise<object>} coverage result, or { skipped } when undecidable
 * @throws {ApiError} 422 when covered === false
 */
const assertOrderCovered = async ({ restaurantId, orderTo, deliveryAddress, deliveryAddressRaw }) => {
  if (orderTo !== 'homedelivery') return { skipped: 'not_home_delivery', inside: true };
  if (!restaurantId) return { skipped: 'no_restaurant', inside: true };

  let lng = null;
  let lat = null;
  let localityId = null;
  const fromDoc = await readAddressPin(deliveryAddress);
  if (fromDoc) {
    lng = fromDoc.lng;
    lat = fromDoc.lat;
    localityId = fromDoc.localityId;
  }
  if (lng === null && deliveryAddressRaw) {
    try {
      const parsed = typeof deliveryAddressRaw === 'string' ? JSON.parse(deliveryAddressRaw) : deliveryAddressRaw;
      const coords = parsed && parsed.location && parsed.location.coordinates;
      if (Array.isArray(coords) && coords.length >= 2 && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))) {
        lng = Number(coords[0]);
        lat = Number(coords[1]);
      }
    } catch {
      /* free-form raw address — undecidable, allowed */
    }
  }
  if (lng === null || lat === null) return { skipped: 'no_pin', inside: true };

  const coverage = await resolveCustomerCoverage({
    restaurantId,
    customerLng: lng,
    customerLat: lat,
    customerLocalityId: localityId,
  });
  if (coverage.inside) return coverage;
  throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'This restaurant does not deliver to your address');
};

const readAddressPin = async (deliveryAddress) => {
  try {
    if (!deliveryAddress || !mongoose.Types.ObjectId.isValid(deliveryAddress)) return null;
    const address = await UserAddress.findById(deliveryAddress, { location: 1, localityRef: 1 }).lean();
    if (!address) return null;
    const coords = address.location && address.location.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return {
      lng,
      lat,
      localityId: address.localityRef ? String(address.localityRef) : null,
    };
  } catch {
    return null;
  }
};

/**
 * Full coverage decision for one customer pin (Batch A-3). Most specific
 * configured level decides; each level carries the radius as a backstop, so
 * a wider commercial promise can never outrun rider range:
 *
 *   polygon zones → served localities → radius
 *
 * @param {object} params
 * @param {string} params.restaurantId
 * @param {number} params.customerLng
 * @param {number} params.customerLat
 * @param {string} [params.customerLocalityId] address `localityRef` when present
 * @returns {Promise<{inside, reason, level, zone, locality}>}
 */
const resolveCustomerCoverage = async ({ restaurantId, customerLng, customerLat, customerLocalityId }) => {
  const lng = Number(customerLng);
  const lat = Number(customerLat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { inside: false, reason: 'invalid_pin', level: null, zone: null, locality: null };
  }
  const policy = await resolveDeliveryPolicy(restaurantId);
  const kitchen = policy.kitchenCoords;

  const withinRadius = () => {
    if (!Array.isArray(kitchen) || kitchen.length < 2 || !Number.isFinite(policy.radiusMeters)) return false;
    return geographicService.haversineMeters(kitchen[0], kitchen[1], lng, lat) <= policy.radiusMeters;
  };

  const zoneOf = async (localityId) => {
    try {
      if (!localityId || !policy.cityId) return null;
      return await zoneService.resolveZoneForLocality(policy.cityId, localityId);
    } catch {
      return null;
    }
  };

  // Level 1 — drawn polygons. Most specific wins outright.
  if (policy.zones && policy.zones.length) {
    const checked = isCustomerInDeliveryArea({
      kitchenCoords: kitchen,
      customerLng: lng,
      customerLat: lat,
      deliveryConfig: { zones: policy.zones },
      radiusMeters: policy.radiusMeters,
    });
    return { ...checked, level: 'polygon', locality: null };
  }

  // Level 2 — served-locality list. Direct hit on the address ref, else the
  // nearest locality to the pin; either way the radius still backstops.
  if (policy.localities && policy.localities.length) {
    const served = new Set(policy.localities.map(String));
    let localityId =
      customerLocalityId && mongoose.Types.ObjectId.isValid(customerLocalityId)
        ? String(customerLocalityId)
        : null;
    let locality = null;
    if (!localityId) {
      locality = await nearestLocalityInCity(policy.cityId, lng, lat);
      if (!locality) {
        return { inside: false, reason: 'locality_unresolvable', level: 'localities', zone: null, locality: null };
      }
      localityId = String(locality._id);
    }
    if (!served.has(localityId)) {
      if (!locality && mongoose.Types.ObjectId.isValid(localityId)) {
        locality = await Locality.findById(localityId, { name: 1 }).lean().catch(() => null);
      }
      return { inside: false, reason: 'outside_served_localities', level: 'localities', zone: await zoneOf(localityId), locality };
    }
    if (!withinRadius()) {
      return { inside: false, reason: 'beyond_radius', level: 'localities', zone: await zoneOf(localityId), locality };
    }
    return { inside: true, reason: 'in_served_localities', level: 'localities', zone: await zoneOf(localityId), locality };
  }

  // Level 3 — radius. Today's behaviour, unchanged.
  const checked = isCustomerInDeliveryArea({
    kitchenCoords: kitchen,
    customerLng: lng,
    customerLat: lat,
    deliveryConfig: {},
    radiusMeters: policy.radiusMeters,
  });
  return { ...checked, level: 'radius', locality: null, zone: null };
};

module.exports = {
  MIN_RADIUS_METERS,
  MAX_RADIUS_METERS,
  MAX_SERVED_LOCALITIES,
  sanitizeRung,
  sanitizeLadder,
  sanitizeLocalities,
  sanitizeDeliveryConfig,
  updateDeliveryConfig,
  narrowDeliveryConfig,
  assertOrderCovered,
  resolveDeliveryPolicy,
  enabledZones,
  isCustomerInDeliveryArea,
  resolveCustomerCoverage,
};
