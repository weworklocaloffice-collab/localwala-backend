/**
 * run.verify.localservices.js — run every Local Services verify script and aggregate the result.
 *
 * ## Why this exists
 *
 * `npm test` was `echo "No tests configured"`. Fifteen verification scripts existed and
 * nothing invoked them, which is how the all shipped at once:
 *
 *   - `src/modules/local-services/index.js` threw on require, so the API could not boot
 *   - fifteen scripts `require('chai')`, which is not a dependency — they had never executed
 *   - various verify scripts were failing on boot error and had
 *     been reported as green
 *
 * Each of those was caught by hand. None would have been caught by a machine, because no
 * machine was running them. This is the smallest thing that changes that.
 *
 * ## Why not mocha
 *
 * The verify scripts are not unit tests. Most need a live MongoDB, some clean up after
 * themselves, and a few assert on things a test runner's reporter would bury. Shelling
 * out per script keeps each one's own output, exit code and teardown intact, and works on a
 * bare checkout with no new dependency.
 *
 * Exit code is 1 if any script fails, so `npm test` is meaningful in CI.
 *
 * Run: node scripts/run.verify.localservices.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPTS = __dirname;

// /**
//  * Every `verify.localservices.*.js` except this runner, which must not invoke itself.
//  */
const files = fs
  .readdirSync(SCRIPTS)
  .filter((f) => /^verify\.localservices\..*\.js$/.test(f) && f !== path.basename(__filename))
  .sort();

if (files.length === 0) {
  console.error('No verify.localservices.*.js scripts found in ' + SCRIPTS);
  process.exit(1);
}

const results = [];
const started = Date.now();

for (const file of files) {
  process.stdout.write(`\n${'='.repeat(72)}\n${file}\n${'='.repeat(72)}\n`);
  const t0 = Date.now();
  let code = 0;
  try {
    // stdio inherited so each script's own OK/FAIL lines reach the console unchanged.
    execFileSync(process.execPath, [path.join(SCRIPTS, file)], {
      stdio: 'inherit',
      cwd: path.resolve(SCRIPTS, '..'),
    });
  } catch (e) {
    // A non-zero exit is the expected failure signal, not a crash of the runner.
    code = typeof e.status === 'number' ? e.status : 1;
  }
  results.push({ file, code, ms: Date.now() - t0 });
}

const failed = results.filter((r) => r.code !== 0);

console.log(`\n${'='.repeat(72)}\nSUMMARY  (${((Date.now() - started) / 1000).toFixed(1)}s)\n${'='.repeat(72)}`);
for (const r of results) {
  const mark = r.code === 0 ? 'PASS' : `FAIL(${r.code})`;
  console.log(`  ${mark.padEnd(9)} ${r.file.padEnd(46)} ${(r.ms / 1000).toFixed(1)}s`);
}
console.log('');

if (failed.length) {
  console.log(`${failed.length} of ${results.length} Local Services verify scripts FAILED`);
  process.exit(1);
}

console.log(`ALL ${results.length} Local Services verify scripts PASSED`);