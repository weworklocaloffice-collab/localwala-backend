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

const logger = require('../config/logger');

/**
 * socket.emitter.js — the one place a service can reach a connected socket.
 *
 * `io` is created in `src/index.js` and was previously reachable from nowhere
 * else, which is why rider order offers were push-only over FCM: the delivery
 * engine had no way to tell a rider's phone about an offer without the rider
 * polling `GET /driver/orders/newOrder`. A rider with the screen closed therefore
 * learned about work only if the push notification survived.
 *
 * The reference is injected once at boot. Every emit is a no-op when it is
 * absent, so services stay safe to require from scripts and verify suites that
 * never start a server.
 */

let io = null;

/** Called once from src/index.js after the socket server is constructed. */
const setSocketServer = (server) => {
  io = server || null;
};

const isConnected = () => !!io;

/**
 * Emit to the room named after a user id.
 *
 * `src/index.js` puts each driver in a room keyed by their user id
 * (`joinLiveLocation`), so this is the addressable unit for a person.
 *
 * @param {string|ObjectId} userId
 * @param {string} event
 * @param {object} payload
 * @returns {boolean} whether the emit happened
 */
const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return false;
  try {
    io.to(String(userId)).emit(event, payload);
    return true;
  } catch (e) {
    // A socket failure must never fail the business operation that triggered it.
    logger.warn(`socket emit ${event} to ${userId} failed: ${e.message}`);
    return false;
  }
};

/**
 * Emit to an arbitrary room, such as the `store-order:<id>` room a customer
 * joins for live order tracking.
 *
 * @param {string} room
 * @param {string} event
 * @param {object} payload
 * @returns {boolean} whether the emit happened
 */
const emitToRoom = (room, event, payload) => {
  if (!io || !room) return false;
  try {
    io.to(room).emit(event, payload);
    return true;
  } catch (e) {
    logger.warn(`socket emit ${event} to room ${room} failed: ${e.message}`);
    return false;
  }
};

/**
 * Emit to many users. Fan-out to a dispatch batch, so the one-failure case is
 * logged and skipped rather than aborting the loop.
 *
 * @param {Array<string|ObjectId>} userIds
 * @param {string} event
 * @param {Function} buildPayload  called per id; may return null to skip
 * @returns {number} how many were delivered
 */
const emitToUsers = (userIds, event, buildPayload) => {
  let delivered = 0;
  for (const id of userIds || []) {
    const payload = typeof buildPayload === 'function' ? buildPayload(id) : buildPayload;
    if (payload && emitToUser(id, event, payload)) delivered += 1;
  }
  return delivered;
};

module.exports = { setSocketServer, isConnected, emitToUser, emitToRoom, emitToUsers };
