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

const crypto = require('crypto');
const timers = require('timers');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const sleep = (ms) => new Promise((resolve) => timers.setTimeout(resolve, ms));

async function acquireLock(key, { ttlMs = 5000, waitMs = 500, LockModel } = {}) {
  const Lock = LockModel || require('../models/localservice.slot.lock.model');
  const owner = crypto.randomBytes(12).toString('hex');
  const deadline = Date.now() + waitMs;

  for (;;) {
    const now = new Date();
    try {
      const doc = await Lock.findOneAndUpdate(
        { key, expiresAt: { $lte: now } },
        { $set: { key, owner, expiresAt: new Date(Date.now() + ttlMs) } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (doc && doc.owner === owner) return { key, owner };
    } catch (e) {
      if (!e || e.code !== 11000) throw e;
    }
    if (Date.now() >= deadline) {
      throw new ApiError(httpStatus.CONFLICT, 'Slot is being booked, retry');
    }
    await sleep(25);
  }
}

async function releaseLock(lock, { LockModel } = {}) {
  if (!lock) return;
  const Lock = LockModel || require('../models/localservice.slot.lock.model');
  try {
    await Lock.deleteOne({ key: lock.key, owner: lock.owner });
  } catch {
    // The TTL index removes a lock the process could not release.
  }
}

async function withLock(key, fn, options = {}) {
  const lock = await acquireLock(key, options);
  try {
    return await fn();
  } finally {
    await releaseLock(lock, options);
  }
}

async function expireHolds(providerId, { ReservationModel, now = new Date() } = {}) {
  const Reservation = ReservationModel || require('../models/localservice.reservation.model');
  const result = await Reservation.updateMany(
    { provider: providerId, status: 'held', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount || 0;
}

module.exports = { acquireLock, releaseLock, withLock, expireHolds };
