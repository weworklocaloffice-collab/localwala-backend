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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const crypto = require('crypto');

const buildIdempotencyKey = (vertical, entityType, entityId, occurrenceDate) =>
  `${vertical}:${entityType}:${entityId}:${occurrenceDate}`;

const acquireLock = async (redis, key, ttlSeconds = 300) => {
  if (!redis) return true;
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
  return result === 'OK';
};

const releaseLock = async (redis, key) => {
  if (!redis) return;
  await redis.del(key);
};

module.exports = {
  buildIdempotencyKey,
  acquireLock,
  releaseLock,
};