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
 * Single source of truth for *which* riders a restaurant may be dispatched from.
 *
 * Before this module the same ternary was written twice and had drifted apart:
 *
 *   - `driver.service.js`  (vendor picker)  — filtered on `city`, omitted `status`
 *   - `fcm.notification.service.js` (auto) — filtered on `status`, omitted `city`
 *   - both filtered the own-fleet branch on the restaurant's *own* id, which is
 *     wrong for a derived outlet that inherits `ownDriver` from its parent.
 *
 * Food only. No vertical (stores / jhatka / dairy / realestate) imports this.
 * Those keep `StoreDriver`, `JhatkaDriver` and `DairyDriver`.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('./ApiError');
const {
  Restaurant,
  Driver,
  DriverSettings,
  DriverNewOrderStatus,
  BusinessSettings,
} = require('../models');

/**
 * Resolve the delivery pool a restaurant dispatches from.
 *
 * A restaurant either owns its fleet (`ownDriver`) or draws from the platform
 * pool (`Driver.restaurant === null`). Never both.
 *
 * A derived outlet inherits `ownDriver` from `outletManagerId`. Its riders are
 * registered against the *parent* restaurant, so `fleetOwnerRestaurantId` is the
 * parent id — querying the outlet's own id returns an empty result.
 *
 * @param {string} restaurantId
 * @returns {Promise<{restaurant: Object, isOwnFleet: boolean, fleetOwnerRestaurantId: string|null, city: string|null, maxOrderLimit: number}>}
 */
const resolveRiderPool = async (restaurantId) => {
  const restaurant = await Restaurant.findById(restaurantId, {
    name: 1,
    city: 1,
    type: 1,
    location: 1,
    ownDriver: 1,
    isOutlet: 1,
    outletManagerId: 1,
  });

  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Restaurant not found');
  }

  let isOwnFleet = restaurant.ownDriver === true;
  let fleetOwnerRestaurantId = restaurant._id;

  if (!isOwnFleet && restaurant.isOutlet === true && restaurant.outletManagerId) {
    const parent = await Restaurant.findById(restaurant.outletManagerId, { ownDriver: 1 });
    if (parent && parent.ownDriver === true) {
      isOwnFleet = true;
      fleetOwnerRestaurantId = parent._id;
    }
  }

  const driverSettings = await DriverSettings.findOne({}, { maxOrderLimit: 1 });
  const maxOrderLimit =
    driverSettings && driverSettings.maxOrderLimit !== null && driverSettings.maxOrderLimit !== ''
      ? driverSettings.maxOrderLimit
      : 1;

  return {
    restaurant,
    isOwnFleet,
    fleetOwnerRestaurantId: isOwnFleet ? fleetOwnerRestaurantId : null,
    city: restaurant.city || null,
    maxOrderLimit,
  };
};

/**
 * The canonical eligibility filter for a pool. Applies the union of every
 * condition the two previous copies each managed to remember.
 *
 * @param {object} pool           result of `resolveRiderPool`
 * @param {object} [extra]        extra query, e.g. `{ userId: { $nin: [...] } }`
 * @returns {object} a Mongo query fragment
 */
const buildPoolQuery = (pool, extra = {}) => {
  const query = {
    city: pool.city ? new mongoose.Types.ObjectId(pool.city) : undefined,
    isBlocked: false,
    status: true,
    activeStatus: true,
    // Own-fleet riders are registered against the fleet owner (the parent
    // restaurant for a derived outlet); platform riders have no restaurant.
    restaurant: pool.isOwnFleet
      ? new mongoose.Types.ObjectId(pool.fleetOwnerRestaurantId)
      : null,
    orderHandling: { $lte: pool.maxOrderLimit },
    ...extra,
  };

  if (!pool.city) {
    delete query.city;
  }

  return query;
};

/**
 * `$geoNear` stage against the pool, sorted nearest-first.
 *
 * `distance` comes back in the same unit as `findMode` — the rider app renders
 * it verbatim ("1.2 km" / "0.7 mile"), so the multiplier has to follow it.
 *
 * @param {object}  pool
 * @param {number[]} coordinates `[longitude, latitude]`
 * @param {number}  maxDistanceMeters
 * @param {string}  findMode      'km' | 'mile'
 * @param {object}  [extra]
 * @returns {object} an aggregation stage
 */
const buildGeoNearStage = (pool, coordinates, maxDistanceMeters, findMode = 'km', extra = {}) => ({
  $geoNear: {
    near: { type: 'Point', coordinates },
    maxDistance: maxDistanceMeters,
    distanceField: 'distance',
    distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
    query: buildPoolQuery(pool, extra),
  },
});

/**
 * Resolve `BusinessSettings.deliveryArea` + `findMode` into meters.
 *
 * @returns {Promise<{radiusMeters: number, findMode: string}>}
 */
const resolveDeliveryRadius = async () => {
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  return {
    findMode,
    radiusMeters: findMode === 'km' ? radius * 1000 : radius * 1609.34,
  };
};

/**
 * Reject ids that cannot address a rider at all. Cheap guard before any query.
 *
 * @param {string} driverId
 * @param {string} label
 */
const assertRiderIdShape = (driverId, label = 'Rider') => {
  if (!driverId || !mongoose.Types.ObjectId.isValid(driverId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `${label} is not a valid rider`);
  }
};

/**
 * Full server-side eligibility check for a manually selected rider.
 *
 * The client supplies `driverId` from a picker that may be minutes stale. Nothing
 * it returns is trustworthy, so every condition is re-derived here.
 *
 * @param {object} params
 * @param {string} params.driverId     user id of the rider
 * @param {string} params.restaurantId the order's restaurant
 * @param {string} [params.orderId]    exclude the rider if they declined this order
 * @param {boolean} [params.checkCapacity=true]
 * @returns {Promise<{rider: Object, pool: object}>}
 */
const assertRiderEligible = async ({ driverId, restaurantId, orderId, checkCapacity = true }) => {
  assertRiderIdShape(driverId);

  const pool = await resolveRiderPool(restaurantId);
  const rider = await Driver.findOne({ userId: new mongoose.Types.ObjectId(driverId) });

  if (!rider) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Rider not found');
  }
  if (rider.status !== true) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Rider account is disabled');
  }
  if (rider.isBlocked === true) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Rider is blocked');
  }
  if (rider.activeStatus !== true) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Rider is offline');
  }

  const riderPoolOwner = rider.restaurant || null;
  const expectedOwner = pool.isOwnFleet ? String(pool.fleetOwnerRestaurantId) : null;
  if (String(riderPoolOwner) !== String(expectedOwner)) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      pool.isOwnFleet
        ? 'Rider does not belong to this restaurant fleet'
        : 'Rider is not part of the platform delivery pool'
    );
  }

  if (pool.city && rider.city && String(rider.city) !== String(pool.city)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Rider is not in this city');
  }

  if (checkCapacity && typeof rider.orderHandling === 'number') {
    if (rider.orderHandling > pool.maxOrderLimit) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Rider is already at order capacity');
    }
  }

  if (orderId) {
    const declined = await DriverNewOrderStatus.exists({
      orderId: new mongoose.Types.ObjectId(orderId),
      driver: new mongoose.Types.ObjectId(driverId),
      driverOrderStatus: 'rejected',
    });
    if (declined) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Rider already declined this order');
    }
  }

  return { rider, pool };
};

module.exports = {
  resolveRiderPool,
  buildPoolQuery,
  buildGeoNearStage,
  resolveDeliveryRadius,
  assertRiderIdShape,
  assertRiderEligible,
};
