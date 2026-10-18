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

const mongoose = require('mongoose');
const logger = require('../config/logger');

/**
 * Multi-document transactions require a replica set or mongos. A standalone
 * mongod accepts a session but refuses to commit with
 * "Transaction numbers are only allowed on a replica set member or mongos".
 *
 * Several dairy write paths must be atomic — most importantly the can-ledger
 * reconciliation in `delivery.run.service.completeRun`, where a partial write
 * means cans go missing and the depot gate never balances.
 *
 * This helper detects the capability once, then either runs the callback inside
 * a transaction or falls back to sequential writes and logs a warning. Standalone
 * deployments therefore keep working during development, but the degradation is
 * loud rather than silent.
 *
 * Run `node scripts/check.mongo.capabilities.js` to see which mode you are in.
 *
 * @param {Function} fn  async (session) => void
 * @returns {Promise<*>} whatever fn resolves to
 */
let transactionSupport = null;

const detectTransactionSupport = async () => {
  if (transactionSupport !== null) {
    return transactionSupport;
  }

  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionSupport = typeof info.setName === 'string' || info.msg === 'isdbgrid';
  } catch {
    transactionSupport = false;
  }

  if (transactionSupport === false) {
    logger.warn(
      'MongoDB deployment does not support multi-document transactions (standalone mongod). ' +
        'Dairy writes will run sequentially and are NOT atomic. ' +
        'Enable a replica set before production — see scripts/check.mongo.capabilities.js'
    );
  }

  return transactionSupport;
};

/**
 * Runs `fn` inside a transaction when the deployment supports one.
 *
 * `fn` receives the session, or `null` in fallback mode, so callers must pass
 * the session through to every write rather than assuming it is always present.
 *
 * @param {Function} fn async (session|null) => any
 * @returns {Promise<any>}
 */
const withOptionalTransaction = async (fn) => {
  const supported = await detectTransactionSupport();

  if (supported) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  return fn(null);
};

/** Test seam — forces the fallback path so both branches can be exercised. */
const __setTransactionSupport = (value) => {
  transactionSupport = value;
};

/**
 * REFUSES to run unless the deployment genuinely supports transactions.
 *
 * ## Why a second, stricter helper instead of just using the optional one
 *
 * `withOptionalTransaction` degrades to sequential writes, which is the right trade for a
 * developer laptop running the dairy test suites. It is the WRONG trade for a write that
 * commits money or creates a tenant, because degradation there is silent and partial:
 *
 *   `approveAndCommit` writes Business, StoreChain, StoreOutlet and StoreRoleAssignment.
 *   On a standalone mongod it ran as four separate writes. A failure on the third left
 *   an approved Business with no outlet and no owner assignment — a live tenant that
 *   exists in the accounts table but that nobody can log into, and that no retry will
 *   ever repair, because the retry re-runs a submit that already completed.
 *
 * Nothing threw. That is the whole problem: the caller saw a 500 from an unrelated
 * failure and the residue looked like a partially-migrated database.
 *
 * So paths that commit financial or tenant state call THIS, which turns the same
 * condition into an explicit, named 503 at the very start of the request, before
 * anything has been written.
 *
 * ## Why it fails BEFORE running the callback
 *
 * The check is deliberately ahead of the work. Refusing after the first write would
 * leave exactly the partial state this function exists to prevent.
 *
 * @param {Function} fn async (session) => any
 * @param {string}   [label] what is being committed, for the error message
 * @returns {Promise<any>}
 * @throws {Error} when the deployment cannot guarantee atomicity
 */
const withRequiredTransaction = async (fn, label = 'this write') => {
  const supported = await detectTransactionSupport();

  if (!supported) {
    throw new Error(
      `TRANSACTIONS_UNAVAILABLE: cannot commit ${label} atomically because this ` +
        'MongoDB deployment is a standalone mongod. A partial write here would leave ' +
        'inconsistent money or tenant state. Configure a replica set — see ' +
        'scripts/check.mongo.capabilities.js'
    );
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  withOptionalTransaction,
  withRequiredTransaction,
  detectTransactionSupport,
  __setTransactionSupport,
};