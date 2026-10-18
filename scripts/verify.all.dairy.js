/**
 * Runs every dairy verification in sequence and reports a single verdict.
 *
 * Usage: node scripts/verify.all.dairy.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUITES = [
  'roles',
  'run',
  'cans',
  'rotation',
  'catalog',
  'subscriptions',
  'subscription.billing',
  'orders',
  'procurement',
  'settlements',
  'compliance',
  'dashboard',
  'payables',
  'import.templates',
  'import.download.guard',
  'http',
  'location',
  // Proves a rider's inherited coordinates persist and are geo-queryable. The
  // `location` suite covers inheritance; this covers the model and index.
  'driver.location.probe',
'vertical',
    // The `dairy_settings` tab in Business Setup. Also asserts that no field is stored
    // without a reader, so the screen cannot quietly grow decorative switches.
    'settings',
    'admin.routes',
  'route.params',
  'api.contract',
  'postman',
  // The only shared utility this work touched. Kept in the runner so the food
  // module's use of it can never regress silently.
  'pick.compat',
  // Compares the admin panel's transition tables against the services. The panel
  // keeps its own copy so it only offers buttons that will succeed, and a copy
  // drifts silently.
  'admin.transitions',
  // Named to match this runner's `verify.dairy.<suite>.js` convention, so the file is
  // `verify.dairy.pool.retirement.js`. It is listed last because it asserts the
  // end state of the whole pool retirement rather than any one feature.
  'pool.retirement',
];

/**
 * Preflight: every suite name must resolve to a file named `verify.dairy.<name>.js`.
 *
 * This bit me three times in one session — a suite was added under the right name
 * but the file was saved without the `verify.dairy.` prefix, and the runner reported
 * it as `Cannot find module` with a Node stack, which reads like a broken suite
 * rather than a typo. A missing file is now named explicitly and the runner stops
 * before running anything.
 */
const missing = SUITES.filter(
  (suite) => !fs.existsSync(path.join(__dirname, `verify.dairy.${suite}.js`))
);
if (missing.length) {
  console.error(
    `\nMisnamed suite file(s). This runner expects verify.dairy.<name>.js for each:\n` +
      missing.map((s) => `  ${s}  ->  scripts/verify.dairy.${s}.js  (missing)`).join('\n') +
      `\n`
  );
  process.exit(1);
}

let failed = 0;

for (const suite of SUITES) {
  const script = path.join(__dirname, `verify.dairy.${suite}.js`);
  process.stdout.write(`\n=== dairy:${suite} ===\n`);
  try {
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    const lines = out.split('\n').filter((l) => l.includes('ALL ') || l.includes('FAILED'));
    lines.forEach((l) => process.stdout.write(`${l}\n`));
  } catch (e) {
    failed += 1;
    process.stdout.write(`FAILED: ${String(e.stdout || e.message).split('\n').slice(-3).join('\n')}\n`);
  }
}

process.stdout.write(failed === 0 ? '\nALL DAIRY SUITES PASSED\n' : `\n${failed} SUITE(S) FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
