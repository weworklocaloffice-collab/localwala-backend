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
 * jhatka.delivery.js — rider delivery guards.
 *
 * Moved verbatim from `jhatka.driver.route.js`, where every rider handler
 * defined its own copies. One implementation: a rider who learns another
 * rider's delivery id must not be able to move it, and an id alone is not
 * authorisation.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { JhatkaDelivery, JhatkaDriver } = require('../../../models');

/**
 * Load a delivery assigned to THIS rider.
 *
 * `delivery.driver` is the DRIVER RECORD id (set at dispatch), while callers
 * pass the rider's USER id — comparing the two directly rejects every rider,
 * including the assigned one. Resolve the record first, then compare record
 * to record. A rider who learns another rider's delivery id still must not be
 * able to move it, and an id alone is not authorisation.
 */
async function loadOwnDelivery(deliveryId, riderUserId) {
  const driver = await JhatkaDriver.findOne({ user: riderUserId }).select('_id').lean();
  if (!driver) {
    throw new ApiError(httpStatus.FORBIDDEN, 'No rider record for this account');
  }
  const delivery = await JhatkaDelivery.findById(deliveryId);
  if (!delivery) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found');
  if (String(delivery.driver) !== String(driver._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Delivery not assigned to you');
  }
  return delivery;
}

/** Assert the delivery is where the rider thinks it is before moving it. */
function assertStatus(delivery, allowed) {
  if (!allowed.includes(delivery.status)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Delivery is ${delivery.status}; expected ${allowed.join(' or ')}`,
      true,
      '',
      { status: delivery.status, expected: allowed }
    );
  }
  return true;
}

module.exports = { loadOwnDelivery, assertStatus };
