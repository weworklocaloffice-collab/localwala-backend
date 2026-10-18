/**
 * transaction.js — run a unit of work inside a MongoDB transaction, correctly.
 *
 * ## Why this exists
 *
 * The pattern used across the Jhatka vertical was:
 *
 *     const session = await Model.startSession();
 *     try   { session.startTransaction(); const r = await fn(session);
 *             await session.commitTransaction(); return r; }
 *     catch (e) { await session.abortTransaction(); throw e; }
 *     finally { await session.endSession(); }
 *
 * That is correct for a SINGLE attempt, and it is wrong for the retry the driver
 * requires. Two stock mutations touching the same `JhatkaInventoryItem` — an adjust
 * followed by a wastage, say — can overlap for a few milliseconds. MongoDB then
 * answers with a *transient* error:
 *
 *     Unable to acquire IX lock on '{Collection : ...}' within 5ms
 *
 * which is the 5ms `maxTransactionLockRequestTimeoutMillis` elapsing, not corruption.
 * Hand-rolled commit/abort surfaces that as a 500 and the caller sees a stock write
 * fail for no reason at all.
 *
 * The driver ships `session.withTransaction()`, which retries transient conflicts and
 * transient errors automatically, and aborts on its own. This wraps it, adds the
 * attempt cap the driver does not give you, and makes the behaviour explicit at every
 * call site.
 *
 * ## Why the callback must be safe to run twice
 *
 * A retry RE-RUNS `fn`. Anything inside must therefore be idempotent or rolled back
 * with the transaction. Mongoose writes inside the session are fine: an aborted
 * attempt leaves nothing behind. Reads inside the session are fine. What is NOT fine
 * is a side effect outside the database — an HTTP call, a clock read used for a
 * human-facing timestamp, a counter incremented in memory. Those must move out of
 * `fn` or be made repeatable.
 *
 * `new Date()` inside `fn` is a mild case: a retry can shift a timestamp by
 * milliseconds, which nothing here compares against. The calls that DO compare
 * timestamps are deliberately outside this helper for that reason.
 */

/** Errors the server labels as safe to retry. */
const RETRYABLE_LABELS = new Set(['TransientTransactionError', 'UnknownTransactionCommitResult']);

/**
 * Lock-acquisition timeouts and write conflicts arrive as codes rather than labels in
 * some driver/server combinations, so both are checked.
 */
const RETRYABLE_CODES = new Set([
  112, // WriteConflict
  251, // NoSuchTransaction - the transaction was already committed elsewhere
  24, // LockTimeout
  244, // TransientTransactionError (some versions report it as a code)
]);

/**
 * `MongoServerError#hasErrorLabel(name)` answers a QUESTION about one label name and
 * returns a boolean. It is not a getter for a list, and its result is not a label name
 * itself — so the names are iterated and each is asked about individually. Looking the
 * boolean up in `RETRYABLE_LABELS` always misses, which is how a retry helper can look
 * correct, never fire on a labelled error, and still pass a suite whose failures happen
 * to arrive with a numeric code instead.
 */
const carriesLabel = (error, name) =>
  typeof error?.hasErrorLabel === 'function' && error.hasErrorLabel(name) === true;

const isRetryable = (error) => {
  if (!error) return false;
  for (const label of RETRYABLE_LABELS) {
    if (carriesLabel(error, label)) return true;
  }
  return RETRYABLE_CODES.has(error.code);
};

/**
 * Delay without a bare `setTimeout`.
 *
 * The `src` tree gets an explicit globals allowlist in `eslint.config.cjs` (console,
 * process, __dirname, __filename) and timers are deliberately not on it — the list
 * exists so an undeclared identifier in a service is a lint error rather than a
 * runtime surprise. Adding one for a backoff would widen a shared config to serve a
 * single call site, so the timer is reached through `global`, which is already
 * available, and the reference is suppressed at the line that needs it.
 */
const sleep = (ms) =>
  new Promise((resolve) => {
    /* eslint-disable-next-line no-undef */
    global.setTimeout(resolve, ms);
  });

/**
 * @param {object}   opts
 * @param {Function} opts.startSession  `() => Promise<ClientSession>` — normally `Model.startSession`
 * @param {Function} opts.fn            `async (session) => result`, retried as a whole
 * @param {number}   [opts.attempts]    default 3
 * @param {number}   [opts.baseDelayMs] default 15, doubled per attempt
 * @returns {Promise<any>}
 */
async function withTransaction({ startSession, fn, attempts = 3, baseDelayMs = 15 }) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const session = await startSession();
    try {
      // `withTransaction` handles begin/commit/abort AND retries conflicts internally.
      // Our own loop sits outside it for the attempt cap and for the backoff, which
      // the driver does not apply.
      let result;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) {
        throw error;
      }
      // Exponential backoff. Two contending writers usually clear in a few ms; the
      // cap keeps a genuine deadlock from turning into a long request stall.
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    } finally {
      await session.endSession();
    }
  }

  /* istanbul ignore next -- the loop always returns or throws */
  throw lastError;
}

module.exports = { withTransaction, isRetryable };