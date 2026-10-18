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
 * dispatch.events.service.js — writes to the append-only assignment trail.
 *
 * A deliberately tiny module: it requires only models, so both
 * `services/dispatch.service.js` (engine) and `services/orders.service.js`
 * (manual paths + accept/reject) can require it without a dependency cycle.
 *
 * ## Best-effort by contract
 *
 * An audit write must never fail the dispatch it describes. Every function
 * here catches its own errors, logs them, and resolves `null` — the caller
 * never branches on the result. A missing audit row is a gap in observability;
 * a failed assignment because the audit collection was slow would be an outage.
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');
const OrderAssignmentEvent = require('../kernel/dispatch/models/order.assignment.event.model');

const EVENT_TYPES = Object.freeze([
  'dispatched',
  'offered',
  'accepted',
  'rejected',
  'expired',
  'escalated',
  'overridden',
  'notfound',
]);

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  try {
    return new mongoose.Types.ObjectId(value);
  } catch {
    return null;
  }
};

/**
 * Append one assignment event. Never throws.
 *
 * @param {object} event
 * @param {string} event.order
 * @param {string} event.type one of EVENT_TYPES
 * @param {string} [event.restaurant]
 * @param {string} [event.actorType] system | rider | vendor_app | vendor_web | admin | city_master
 * @param {string} [event.actor]
 * @param {string} [event.reason]
 * @param {string} [event.pool] own_fleet | platform
 * @param {number} [event.distance] kilometres
 * @param {number} [event.round] ladder rung
 * @param {string} [event.zone] customer-side DeliveryZone id (Batch A-4)
 * @param {number} [event.zoneVersion]
 * @returns {Promise<object|null>}
 */
const recordAssignmentEvent = async (event = {}) => {
  try {
    if (!event.order || !mongoose.Types.ObjectId.isValid(event.order)) return null;
    if (!EVENT_TYPES.includes(event.type)) return null;
    return await OrderAssignmentEvent.create({
      order: toObjectIdOrNull(event.order),
      restaurant: toObjectIdOrNull(event.restaurant),
      type: event.type,
      actorType: event.actorType || 'system',
      actor: toObjectIdOrNull(event.actor),
      reason: event.reason || null,
      pool: event.pool || null,
      distance: Number.isFinite(Number(event.distance)) ? Number(event.distance) : null,
      round: Number.isFinite(Number(event.round)) ? Number(event.round) : null,
      zone: toObjectIdOrNull(event.zone),
      zoneVersion: Number.isFinite(Number(event.zoneVersion)) ? Number(event.zoneVersion) : null,
    });
  } catch (e) {
    logger.warn(`assignment event not recorded (${event && event.type}): ${e.message}`);
    return null;
  }
};

/**
 * Best-effort zone tag for an order. Spreads onto audit writes:
 * `...(await orderZoneTag(orderId))`. Never throws, never blocks.
 */
const orderZoneTag = async (orderIdOrDoc) => {
  try {
    // Lazy require: `delivery.zone.service` is zone-side code; this module is
    // required by both engine and manual paths, and must stay cycle-free.
    const zoneService = require('./delivery.zone.service');
    const tag = await zoneService.resolveOrderZone(orderIdOrDoc);
    return { zone: tag.zone ? String(tag.zone) : null, zoneVersion: tag.zoneVersion };
  } catch {
    return { zone: null, zoneVersion: null };
  }
};

/**
 * Append one `offered` row per rider. One rung with N riders is therefore one
 * `dispatched` row plus N `offered` rows — the batch size is countable from
 * the trail without joining offers.
 *
 * @param {object} params
 * @returns {Promise<number>} rows written
 */
const recordOfferedEvents = async ({ order, restaurant, riders = [], pool, round, zone = null, zoneVersion = null }) => {
  let written = 0;
  const list = Array.isArray(riders) ? riders : [];
  for (const r of list) {
    // The rider is the *recipient*, not the actor: `actor` stays null and the
    // recipient is recoverable from the sibling offer document written in the
    // same rung. Keeping this loop free of extra queries matters at 5 riders
    // × every rung.
    const row = await recordAssignmentEvent({
      order,
      restaurant,
      type: 'offered',
      actorType: 'system',
      pool: pool || null,
      distance:
        r && Number.isFinite(Number(r.distanceKm))
          ? Number(r.distanceKm)
          : r && Number.isFinite(Number(r.distance))
            ? Number(r.distance)
            : null,
      round: round !== undefined ? round : null,
      reason: 'ladder_broadcast',
      actor: null,
      zone,
      zoneVersion,
    });
    if (row) written += 1;
  }
  return written;
};

module.exports = {
  EVENT_TYPES,
  recordAssignmentEvent,
  recordOfferedEvents,
  orderZoneTag,
};
