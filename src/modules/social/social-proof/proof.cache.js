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
 * TTL cache for social-proof results, keyed userId:reelId.
 *
 * Two backends:
 *  - memory (default): per-process Map, evicted at CACHE_TTL_MS, 5000-entry cap.
 *    Fine for a single instance; ineffective when the API runs >1 pod.
 *  - redis: set when REDIS_URL is configured. The same `get` / `set` interface
 *    so social-proof.service never knows which one it's talking to.
 *
 * Social proof tolerates 1–5 min staleness (docs §10), so a single instance
 * is fine until horizontal scaling starts. The `node-cache` Map is the safe
 * default; `ioredis` is the production swap (deliberately not added to
 * package.json yet — see social-reels-hybrid-monolith.md §14).
 */

const TTL_MS = 60 * 1000;
const MAX_ENTRIES = 5000;

const memory = new Map();
let redisClient = null;
let redisInitFailed = false;

const memoryGet = (key) => {
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    memory.delete(key);
    return null;
  }
  return entry.value;
};

const memorySet = (key, value) => {
  memory.set(key, { value, at: Date.now() });
  if (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
};

const getRedisClient = () => {
  if (redisClient || redisInitFailed) return redisClient;
  if (!process.env.REDIS_URL) return null;
  try {
    // Lazy require so the dependency is optional. ioredis is the project's
    // choice; the contract is just { get(key), set(key, value, 'EX', ttlSec) }.
    // eslint-disable-next-line global-require
    const IORedis = require('ioredis');
    redisClient = new IORedis(process.env.REDIS_URL);
  } catch (error) {
    redisInitFailed = true;
    // eslint-disable-next-line no-console
    console.warn(`proof.cache: Redis init failed, falling back to memory (${error.message})`);
  }
  return redisClient;
};

const redisGet = async (key) => {
  const client = getRedisClient();
  if (!client) return null;
  const raw = await client.get(`proof:${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

const redisSet = async (key, value) => {
  const client = getRedisClient();
  if (!client) return;
  await client.set(`proof:${key}`, JSON.stringify(value), 'EX', Math.ceil(TTL_MS / 1000));
};

const useRedis = () => Boolean(process.env.REDIS_URL) && !redisInitFailed;

const get = async (key) => (useRedis() ? redisGet(key) : memoryGet(key));
const set = async (key, value) => {
  if (useRedis()) return redisSet(key, value);
  return memorySet(key, value);
};

module.exports = { get, set, TTL_MS };
