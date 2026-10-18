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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const crypto = require('crypto');

const RealEstateAuditLog = require('../models/realestate.audit.log.model');

const GENESIS_HASH = 'GENESIS';

/**
 * Canonical encoding for hashing: fixed key order, ObjectIds and
 * dates rendered as strings, undefined dropped. Nested `before` /
 * `after` / `metadata` keep their stored key order (stable in
 * practice from toObject), which is why writers must pass plain
 * data, not live documents.
 */
function canonicalHashPayload(row) {
  const str = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  };
  return JSON.stringify({
    prevHash: str(row.prevHash),
    eventType: str(row.eventType),
    targetType: str(row.targetType),
    targetId: str(row.targetId),
    actor: str(row.actor),
    actorType: str(row.actorType),
    reason: str(row.reason),
    before: str(row.before),
    after: str(row.after),
    metadata: str(row.metadata),
    ip: str(row.ip),
    userAgent: str(row.userAgent),
  });
}

function computeHash(row) {
  return crypto.createHash('sha256').update(canonicalHashPayload(row), 'utf8').digest('hex');
}

/**
 * Normalize the actor vocabulary. Several writers pass lowercase
 * ('admin', 'system', 'bank'...); the schema enum is uppercase, and
 * without this every one of those rows failed validation and was
 * swallowed by design — an audit trail with silent holes.
 */
function normalizeActorType(actorType) {
  if (actorType === null || actorType === undefined || actorType === '') return undefined;
  return String(actorType).toUpperCase();
}

/**
 * Audit service — the single writer for `RealEstateAuditLog` (BR-20, F-2).
 *
 * ## `record` never throws
 *
 * An audit failure must not roll back the business action it describes. If the log write
 * fails, the caller has already moved an entitlement or published a listing; throwing here
 * would leave the system reporting failure for work that actually succeeded, and a
 * caller might retry it — double-consuming an entitlement or double-publishing.
 *
 * So a failure is reported on the returned object and swallowed. The cost is that a broken
 * audit log degrades silently, which is why `record` returns `{ ok, error }` and why
 * `verify.realestate.audit.js` asserts the happy path rather than assuming it.
 *
 * ## No update path, by design
 *
 * BR-17: "The settlement ledger is append-only. Corrections are compensating entries."
 * There is deliberately no `update`, no `amend` and no `remove` here. A correction is a new
 * row with `eventType: 'ENTITLEMENT_RESTORED'` and a reason.
 */

/**
 * Record one consequential action.
 *
 * @param {Object} entry — {
 *   eventType, targetType, targetId,
 *   actor?, actorType, reason?, before?, after?, metadata?, ip?, userAgent?
 * }
 * @returns {Promise<{ok: boolean, log?: object, error?: Error}>} never rejects
 */
async function record(entry) {
  try {
    // `strict: true` on the schema means an unknown key is dropped rather than stored.
    // That is deliberate: a caller passing `ammount` should get no amount column, not a
    // silently persisted number that a later report would sum.
    const prev = await RealEstateAuditLog.findOne({})
      .sort({ createdAt: -1, _id: -1 })
      .select('hash')
      .lean();
    const row = {
      eventType: entry.eventType,
      targetType: entry.targetType,
      targetId: entry.targetId,
      actor: entry.actor,
      actorType: normalizeActorType(entry.actorType),
      reason: entry.reason,
      before: entry.before,
      after: entry.after,
      metadata: entry.metadata,
      ip: entry.ip,
      userAgent: entry.userAgent,
      prevHash: (prev && prev.hash) || GENESIS_HASH,
    };
    row.hash = computeHash(row);
    const log = await RealEstateAuditLog.create(row);

    return { ok: true, log };
  } catch (error) {
    // Intentionally swallowed — see the class doc. The reason is attached so a caller that
    // *is* in a position to handle it (a script, a test) can assert on it.
    return { ok: false, error };
  }
}

/**
 * Verify the hash chain over the newest `limit` rows (oldest first).
 *
 * Detects: rewritten rows (hash mismatch), deleted rows are NOT
 * detectable here (a gap looks clean) — deletion shows only against
 * an external count baseline, which is why compliance exports carry
 * row counts. Concurrent writers can fork (two rows, same prevHash);
 * forks are reported, not resolved — single-process deploys avoid
 * them; multi-process needs a transaction around record().
 *
 * @returns {Promise<{ok: boolean, checked: number, brokenAt?: string, branched?: boolean}>}
 */
async function verifyChain(limit = 500) {
  const rows = await RealEstateAuditLog.find({})
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .lean();
  let prev = GENESIS_HASH;
  const seenPrev = new Set();
  for (const r of rows) {
    if (seenPrev.has(r.prevHash) && r.prevHash !== prev) {
      return { ok: false, checked: rows.length, branched: true, brokenAt: String(r._id) };
    }
    seenPrev.add(r.prevHash);
    const recomputed = computeHash({
      prevHash: r.prevHash,
      eventType: r.eventType,
      targetType: r.targetType,
      targetId: r.targetId,
      actor: r.actor,
      actorType: r.actorType,
      reason: r.reason,
      before: r.before,
      after: r.after,
      metadata: r.metadata,
      ip: r.ip,
      userAgent: r.userAgent,
    });
    if (recomputed !== r.hash || r.prevHash !== prev) {
      return { ok: false, checked: rows.length, brokenAt: String(r._id) };
    }
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}

/**
 * Record an action and rethrow on failure.
 *
 * For the one place where losing the audit row is worse than failing the request: the
 * manual entitlement restore, which BR-05 requires to carry a reason and BR-17 requires to
 * be visible. Everywhere else, use `record`.
 *
 * @param {Object} entry — same shape as `record`
 * @returns {Promise<object>} the saved log
 * @throws when the audit row cannot be written
 */
async function recordOrThrow(entry) {
  const { ok: recorded, log, error } = await record(entry);
  if (!recorded) throw error;
  return log;
}

/**
 * Everything that happened to one document, newest first.
 *
 * @param {string} targetType
 * @param {mongoose.Types.ObjectId} targetId
 * @param {Object} [opts] — { limit, eventType, actor }
 * @returns {Promise<Array>}
 */
async function findForTarget(targetType, targetId, opts = {}) {
  const filter = { targetType, targetId };
  if (opts.eventType) filter.eventType = opts.eventType;
  if (opts.actor) filter.actor = opts.actor;

  return RealEstateAuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(opts.limit || 100)
    .lean();
}

/**
 * Everything one actor did, newest first.
 *
 * @param {mongoose.Types.ObjectId} actorId
 * @param {Object} [opts] — { limit, eventType }
 * @returns {Promise<Array>}
 */
async function findForActor(actorId, opts = {}) {
  const filter = { actor: actorId };
  if (opts.eventType) filter.eventType = opts.eventType;

  return RealEstateAuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(opts.limit || 100)
    .lean();
}

/**
 * Money movements within a window — the reconciliation view.
 *
 * @param {Object} opts — { from, to, limit }
 * @returns {Promise<Array>}
 */
const MONEY_EVENTS = [
  'LISTING_PACKAGE_ORDER_CREATED',
  'LISTING_PACKAGE_ORDER_PAID',
  'LISTING_PACKAGE_ORDER_CANCELLED',
  'LISTING_PACKAGE_REFUNDED',
  'ENTITLEMENT_GRANTED',
  'ENTITLEMENT_CONSUMED',
  'ENTITLEMENT_RESTORED',
  'HOLD_CREATED',
  'HOLD_RELEASED',
  'HOLD_REFUNDED',
  'SALE_COMPLETED',
  'COMMISSION_RECORDED',
  'SETTLEMENT_GENERATED',
];

async function findMoneyMovements(opts = {}) {
  const filter = { eventType: { $in: MONEY_EVENTS } };
  if (opts.from || opts.to) {
    filter.createdAt = {};
    if (opts.from) filter.createdAt.$gte = opts.from;
    if (opts.to) filter.createdAt.$lte = opts.to;
  }

  return RealEstateAuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(opts.limit || 500)
    .lean();
}

module.exports = {
  MONEY_EVENTS,
  GENESIS_HASH,
  computeHash,
  normalizeActorType,
  record,
  recordOrThrow,
  verifyChain,
  findForTarget,
  findForActor,
  findMoneyMovements,
};