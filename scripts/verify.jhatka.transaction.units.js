/**
 * verify.jhatka.transaction.units.js — transient-conflict retry semantics.
 *
 * ## Why this suite exists
 *
 * The retry helper was written to make intermittent `Unable to acquire IX lock within
 * 5ms` failures stop reaching the caller as 500s. Those failures are RARE — roughly
 * one integration run in four — so no assertion in the integration suite can pin the
 * behaviour. Without a unit test the helper is untested code on a hot path.
 *
 * It also had a bug that this suite exists to make impossible to reintroduce: it
 * called `hasErrorLabel(name)` (which answers a question and returns a BOOLEAN) and
 * then looked that boolean up in a Set of label NAMES. That is always false, so the
 * label path never fired and only the numeric-code path worked. The integration suite
 * went green on the code path by luck.
 *
 * Run: node scripts/verify.jhatka.transaction.units.js
 */

process.env.NODE_ENV = 'test';

const { withTransaction, isRetryable } = require('../src/modules/jhatka/utils/transaction');

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures += 1; console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n--- ${t} ---`);

/** Stand-in for `MongoServerError`, which carries both a label set and a numeric code. */
const mongoError = (code, labels = []) => ({
  code,
  hasErrorLabel: (name) => labels.includes(name),
});

const main = async () => {
  // -----------------------------------------------------------------------
  section('isRetryable recognises BOTH shapes the driver reports');
  // -----------------------------------------------------------------------
  {
    ok('TransientTransactionError (by LABEL) is retryable',
       isRetryable(mongoError(undefined, ['TransientTransactionError'])),
       'label path did not fire');

    ok('UnknownTransactionCommitResult (by LABEL) is retryable',
       isRetryable(mongoError(undefined, ['UnknownTransactionCommitResult'])));

    ok('WriteConflict (code 112, no label) is retryable',
       isRetryable(mongoError(112)));

    ok('LockTimeout (code 24) is retryable', isRetryable(mongoError(24)));

    ok('NoSuchTransaction (code 251) is retryable', isRetryable(mongoError(251)));

    ok('an unrelated label is NOT retryable',
       !isRetryable(mongoError(undefined, ['SomeOtherLabel'])));

    ok('a validation error is NOT retryable', !isRetryable(mongoError(121)));

    ok('a plain Error is NOT retryable', !isRetryable(new Error('nope')));
    ok('null is NOT retryable', !isRetryable(null));

    // The exact shape that broke the first implementation.
    ok('hasErrorLabel returning true is honoured (regression)',
       isRetryable(mongoError(undefined, ['TransientTransactionError'])),
       'REGRESSION: boolean treated as a label name');
  }

  // -----------------------------------------------------------------------
  section('a transient conflict is retried, and the result survives');
  // -----------------------------------------------------------------------
  {
    let sessionsStarted = 0;
    let fnCalls = 0;
    let sessionsEnded = 0;

    const result = await withTransaction({
      startSession: async () => {
        sessionsStarted += 1;
        return {
          withTransaction: async (cb) => cb({}),
          endSession: async () => { sessionsEnded += 1; },
        };
      },
      fn: async () => {
        fnCalls += 1;
        if (fnCalls === 1) throw mongoError(112);
        if (fnCalls === 2) throw mongoError(112);
        return { written: true };
      },
      baseDelayMs: 1,
    });

    ok('the operation SUCCEEDED on the third attempt',
       result && result.written === true, JSON.stringify(result));
    ok('...and it was attempted 3 times', fnCalls === 3, String(fnCalls));
    ok('...opening a fresh session per attempt', sessionsStarted === 3, String(sessionsStarted));
    ok('...and closing EVERY session, including the failed ones',
       sessionsEnded === 3, `${sessionsEnded} of ${sessionsStarted} closed`);
  }

  // -----------------------------------------------------------------------
  section('the attempt cap is real — a permanent conflict stops, it does not spin');
  // -----------------------------------------------------------------------
  {
    let fnCalls = 0;
    let sessionsEnded = 0;

    let thrown = null;
    try {
      await withTransaction({
        startSession: async () => ({
          withTransaction: async (cb) => cb({}),
          endSession: async () => { sessionsEnded += 1; },
        }),
        fn: async () => {
          fnCalls += 1;
          throw mongoError(112);
        },
        attempts: 3,
        baseDelayMs: 1,
      });
    } catch (error) {
      thrown = error;
    }

    ok('a never-resolving conflict THROWS rather than looping', !!thrown);
    ok('...after exactly the configured attempts', fnCalls === 3, String(fnCalls));
    ok('...and every session was still closed', sessionsEnded === 3, String(sessionsEnded));
  }

  // -----------------------------------------------------------------------
  section('a non-transient failure is NOT retried');
  // -----------------------------------------------------------------------
  {
    let fnCalls = 0;
    let thrown = null;

    try {
      await withTransaction({
        startSession: async () => ({
          withTransaction: async (cb) => cb({}),
          endSession: async () => { },
        }),
        fn: async () => {
          fnCalls += 1;
          throw new ApiErrorLike('stock would go negative');
        },
        attempts: 3,
        baseDelayMs: 1,
      });
    } catch (error) {
      thrown = error;
    }

    ok('a business error surfaces immediately (1 attempt)', fnCalls === 1, String(fnCalls));
    ok('...and it is the ORIGINAL error, unwrapped', thrown?.message === 'stock would go negative',
       String(thrown?.message));
  }

  console.log('\n--- summary ---');
  console.log(failures === 0 ? 'ALL TRANSACTION CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

/** Stand-in for ApiError: has a statusCode, but no transient markers. */
function ApiErrorLike(message) {
  const e = new Error(message);
  e.statusCode = 400;
  e.isOperational = true;
  return e;
}

main().catch((e) => {
  console.error('RUN ERROR', e);
  process.exit(1);
});