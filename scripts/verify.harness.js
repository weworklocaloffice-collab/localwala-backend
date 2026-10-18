/**
 * verify.harness.js — a minimal mocha+chai stand-in for the Real Estate verify scripts.
 *
 * ## Why this exists
 *
 * Three scripts in this directory — `verify.realestate.entitlement.js`,
 * `verify.realestate.integration.full.js` and `verify.realestate.roles.js` — are written
 * against mocha and chai. Neither is a dependency of this package (`npm test` is
 * `echo "No tests configured"`, and `chai` / `mocha` / `jest` are absent from
 * `package.json` and from `node_modules`). So all three died on
 *
 *     Cannot find module 'chai'
 *
 * the moment they were run, and had therefore **never executed once**. They looked like
 * the most thorough tests in the suite while checking nothing at all.
 *
 * Installing chai+mocha was the alternative. That adds two dev dependencies and a runner
 * config for three files, and leaves the other ten scripts on a different runner — two
 * test styles in one directory, which is its own confusion. This file instead gives the
 * three scripts the small subset of the chai/mocha API they actually use, so their existing
 * assertions run unmodified.
 *
 * ## What is supported
 *
 * Enough for the assertions these scripts make, and nothing more:
 *
 *   expect(x).to.equal(v)      .to.not.equal(v)
 *   expect(x).to.exist         .to.not.exist
 *   expect(x).to.be.null       .to.not.be.null
 *   expect(x).to.be.true       .to.be.false
 *   expect(x).to.include(v)    (string contains, or array contains)
 *   expect(x).to.have.length   (chainable, with .at.least / .above / .below)
 *   expect(x).to.be.lessThan(n)  .to.be.greaterThan(n)  .to.be.at.least(n)
 *
 * An unsupported chain throws immediately with the expression that failed, rather than
 * silently passing. A test double that quietly returns `true` for `to.be.lessThan` would be
 * worse than the original crash: it would report green coverage that does not exist.
 *
 * ## Usage
 *
 *     const { expect, describe, it, before, run } = require('./verify.harness');
 *     ...
 *     run();
 *
 * `describe` collects, `run()` executes sequentially and sets `process.exitCode`.
 */

const util = require('util');

let failed = 0;
let passed = 0;
const failures = [];

const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  failures.push(m);
  console.log('  FAIL ' + m);
};

/**
 * Render a value for a failure message, keeping it short and readable.
 */
const show = (v) => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') {
    try {
      return util.inspect(v, { depth: 2, breakLength: 120 });
    } catch (e) {
      return String(v);
    }
  }
  return JSON.stringify(v);
};

const fail = (subject, what, expected, actual) => {
  throw new Error(`${show(subject)} ${what}${expected !== undefined ? ` ${show(expected)}` : ''} (got ${show(actual)})`);
};

/**
 * The chai subset. Properties chain; `not` flips the comparison.
 */
function expect(actual) {
  const build = (negated) => {
    const api = {};

    api.equal = (expected) => {
      const same = actual === expected;
      if (same === negated) fail(actual, negated ? 'should not equal' : 'should equal', expected, actual);
      return api;
    };

    api.exist = () => {
      const isThere = actual !== null && actual !== undefined;
      if (isThere === negated) {
        fail(actual, negated ? 'should not exist' : 'should exist');
      }
      return api;
    };

    const beNull = () => {
      if ((actual === null) === negated) {
        fail(actual, negated ? 'should not be null' : 'should be null');
      }
      return api;
    };
    api.null = beNull;

    api.true = () => {
      if ((actual === true) === negated) fail(actual, negated ? 'should not be true' : 'should be true');
      return api;
    };
    api.false = () => {
      if ((actual === false) === negated) fail(actual, negated ? 'should not be false' : 'should be false');
      return api;
    };

    api.include = (needle) => {
      const has =
        typeof actual === 'string'
          ? actual.includes(needle)
          : Array.isArray(actual) && actual.includes(needle);
      if (has === negated) fail(actual, negated ? 'should not include' : 'should include', needle, actual);
      return api;
    };

    const lessThan = (n) => {
      if (!(actual < n) !== negated) fail(actual, negated ? 'should not be less than' : 'should be less than', n, actual);
      return api;
    };
    const greaterThan = (n) => {
      if (!(actual > n) !== negated) fail(actual, negated ? 'should not be greater than' : 'should be greater than', n, actual);
      return api;
    };
    const atLeast = (n) => {
      if (!(actual >= n) !== negated) fail(actual, negated ? 'should not be at least' : 'should be at least', n, actual);
      return api;
    };
    api.lessThan = lessThan;
    api.greaterThan = greaterThan;
    api.atLeast = atLeast;
    api.above = greaterThan;
    api.below = lessThan;

    /**
     * `length` must be both callable and property-accessible, because chai allows
     * `expect(x).to.have.length(3)` and `expect(x).to.have.length.at.least(3)`.
     * A function carries properties, so one object serves both forms.
     */
    const lengthFn = function (n) {
      if (n === undefined) return undefined;
      const len = actual == null ? undefined : actual.length;
      if (len !== n) fail(actual, 'should have length', n, len);
      return api;
    };
    lengthFn.at = {
      least: atLeast,
      most: (n) => {
        if (!(actual <= n) !== negated) fail(actual, 'should be at most', n, actual);
        return api;
      },
    };
    lengthFn.least = atLeast;
    lengthFn.above = greaterThan;
    lengthFn.below = lessThan;
    api.length = lengthFn;

    return api;
  };

  const positive = build(false);
  positive.to = positive;
  positive.be = positive;
  positive.have = positive;
  positive.that = positive;
  positive.and = positive;
  positive.with = positive;

  Object.defineProperty(positive, 'not', {
    get: () => {
      const n = build(true);
      n.to = n;
      n.be = n;
      n.have = n;
      n.that = n;
      n.and = n;
      n.with = n;
      return n;
    },
    configurable: true,
  });

  return positive;
}

// ------------------------------------------------------------------- collection

const suites = [];
let current = null;

function describe(name, fn) {
  const suite = { name, tests: [], before: [], beforeEach: [], after: [] };
  suites.push(suite);
  const previous = current;
  current = suite;
  fn.call({ timeout() {} });
  current = previous;
}

function it(name, fn) {
  if (!current) throw new Error(`it("${name}") must be inside a describe()`);
  current.tests.push({ name, fn });
}

function before(fn) {
  if (!current) throw new Error('before() must be inside a describe()');
  current.before.push(fn);
}

/**
 * Runs before every test in the enclosing suite.
 *
 * Two of the three scripts migrated here use it to reset collections between tests. It is
 * supported because silently ignoring it would be the worst outcome available: the tests
 * would still pass, but the isolation the author asked for would be gone, and the first
 * one to depend on a clean collection would fail much later and confusingly.
 */
function beforeEach(fn) {
  if (!current) throw new Error('beforeEach() must be inside a describe()');
  current.beforeEach.push(fn);
}

/**
 * Runs once after every test in the enclosing suite.
 *
 * Supported because `verify.realestate.integration.full.js` uses it to close a connection.
 * An `after` that silently never ran would leave a socket open and hang the process, which
 * looks like the suite passing and then never exiting.
 */
function after(fn) {
  if (!current) throw new Error('after() must be inside a describe()');
  current.after.push(fn);
}

/**
 * Run every collected suite in order and set the process exit code.
 */
async function run() {
  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const hook of suite.before) {
      try {
        await hook.call({ timeout() {} });
      } catch (e) {
        bad(`before hook failed: ${e.message}`);
        break;
      }
    }
    for (const test of suite.tests) {
      let setupFailed = false;
      for (const hook of suite.beforeEach) {
        try {
          await hook.call({ timeout() {} });
        } catch (e) {
          bad(`${test.name}  ->  beforeEach failed: ${e.message}`);
          setupFailed = true;
          break;
        }
      }
      if (setupFailed) continue;

      try {
        await test.fn.call({ timeout() {} });
        passed++;
        ok(test.name);
      } catch (e) {
        bad(`${test.name}  ->  ${e.message}`);
      }
    }

    for (const hook of suite.after) {
      try {
        await hook.call({ timeout() {} });
      } catch (e) {
        bad(`after hook failed: ${e.message}`);
      }
    }
  }

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of ${passed + failed} check(s) FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log(`ALL ${passed} CHECKS PASSED`);
}

module.exports = { expect, describe, it, before, beforeEach, after, run };