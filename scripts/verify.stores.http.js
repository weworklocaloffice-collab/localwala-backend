/**
 * verify.stores.http.js - the live HTTP gate named by the implementation plan.
 *
 * Runs the real-server stores suites: the customer journey and the route-level
 * role enforcement proof. Service-level suites cannot see whether the assembled
 * router refuses a request; this can.
 *
 * Run: node scripts/verify.stores.http.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  { file: 'verify.stores.http.customer.js', title: 'HTTP customer journey' },
  { file: 'verify.stores.permissions.js', title: 'HTTP route-level role enforcement' },
];

let failed = 0;

for (const suite of SUITES) {
  console.log('\n' + '='.repeat(72));
  console.log(suite.title + '  (' + suite.file + ')');
  console.log('='.repeat(72));

  const run = spawnSync(process.execPath, [path.join(__dirname, suite.file)], {
    stdio: 'inherit',
    env: process.env,
  });

  const code = run.status === null ? 1 : run.status;
  if (code !== 0) failed += 1;
}

console.log('');

if (failed) {
  console.log(failed + ' of ' + SUITES.length + ' HTTP suites FAILED.');
  process.exit(1);
}

console.log('ALL STORES HTTP CHECKS PASSED');
process.exit(0);
