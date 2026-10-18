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
 * run.verify.jhatka.js — one command for the whole Jhatka gate set.
 *
 * ## Why this exists
 *
 * §21.1 asked for `npm run verify:jhatka` and it was never added, so the twenty gates
 * had to be run by hand. That is not a convenience problem. It is a correctness one:
 * the Jhatka gates are the ONLY thing standing between a 100x money bug and the
 * database, and a gate that nobody runs is indistinguishable from a gate that passes.
 *
 * The integration suite in particular needs a replica set and SKIPS with exit code 0
 * when there isn't one. That is the right behaviour for the suite itself — a developer
 * without Mongo should not see a red build — but it means a CI run can be green
 * because the important test never executed. This runner reports skips LOUDLY and
 * distinguishes them from passes in the exit code.
 *
 * ## The ordering
 *
 * Cheap static gates first, then the database suite. If the models do not load there
 * is no point booting Express and a replica set, and a failure in the first group
 * usually explains a cascade in the second.
 *
 * Usage:
 *   node scripts/run.verify.jhatka.js              everything
 *   node scripts/run.verify.jhatka.js --no-db      skip the replica-set suite
 *   node scripts/run.verify.jhatka.js --only=vertical,money
 */

process.env.NODE_ENV = 'test';

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname);

/**
 * `db: true` marks a gate that needs a transaction-capable replica set.
 *
 * These are listed rather than discovered by filename, because the property that
 * matters is "does this execute queries", and `verify.jhatka.integration.js` is the
 * only one that does today. When a second one appears it must be added here or it
 * will be reported as passing when it actually skipped.
 */
const GROUPS = [
  {
    name: 'static',
    gates: [
      'verify.jhatka.registration.units.js',
      'verify.jhatka.taxonomy.units.js',
      'verify.jhatka.routeschema.units.js',
      'verify.jhatka.rights.units.js',
      'verify.jhatka.tenancy.units.js',
      'verify.jhatka.transaction.units.js',
      'verify.jhatka.cart.units.js',
      'verify.jhatka.catalog.units.js',
      'verify.jhatka.inventory.units.js',
      'verify.jhatka.procurement.units.js',
      'verify.jhatka.ops.units.js',
      'verify.jhatka.orderpricing.units.js',
      'verify.jhatka.money.units.js',
      'verify.jhatka.variableweight.units.js',
    ],
  },
  { name: 'wire', gates: ['verify.jhatka.vertical.js'] },
  { name: 'database', db: true, gates: ['verify.jhatka.integration.js'] },
];

const argv = process.argv.slice(2);
const skipDb = argv.includes('--no-db');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

const results = [];

for (const group of GROUPS) {
  if (group.db && skipDb) {
    console.log(`\n### ${group.name}: SKIPPED (--no-db)`);
    results.push({ group: group.name, gate: '(all)', status: 'skipped', reason: '--no-db' });
    continue;
  }

  console.log(`\n### ${group.name}`);
  for (const gate of group.gates) {
    if (only && !only.some((o) => gate.includes(o))) continue;

    const started = Date.now();
    const run = spawnSync(process.execPath, [path.join(SCRIPTS, gate)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    const ms = Date.now() - started;

    // The integration suite prints `SKIP` and exits 0 when there is no replica set.
    // Exit code alone would report that as a pass.
    const skipped = /^\s*SKIP\s/m.test(output) && !/CHECK\(S\) FAILED/.test(output);
    const status = skipped ? 'skipped' : run.status === 0 ? 'passed' : 'FAILED';

    results.push({ group: group.name, gate, status, ms, reason: skipped ? 'no replica set' : null });

    const icon = status === 'passed' ? 'PASS' : status === 'skipped' ? 'SKIP' : 'FAIL';
    console.log(`  ${icon}  ${gate}  (${ms}ms)`);

    if (status === 'FAILED') {
      // Echo the failing lines only. A full dump of twenty suites buries the one that
      // matters, and this runner's job is to make the failure findable.
      output
        .split('\n')
        .filter((l) => /FAIL|Error|error:|CHECK\(S\) FAILED/.test(l))
        .slice(0, 20)
        .forEach((l) => console.log(`        ${l.trim()}`));
    }
  }
}

const passed = results.filter((r) => r.status === 'passed').length;
const failed = results.filter((r) => r.status === 'FAILED');
const skipped = results.filter((r) => r.status === 'skipped');

console.log('\n=====================================================');
console.log(`  Jhatka gates: ${passed} passed, ${failed.length} failed, ${skipped.length} skipped`);
if (skipped.length) {
  console.log('  SKIPPED gates did NOT run. A skip is not a pass.');
  skipped.forEach((s) => console.log(`    - ${s.gate} (${s.reason})`));
}
failed.forEach((f) => console.log(`    x ${f.gate}`));
console.log('=====================================================\n');

process.exit(failed.length > 0 ? 1 : 0);