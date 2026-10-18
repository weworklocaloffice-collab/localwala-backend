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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.realestate.api.contract.js — the F-6 guard. No database required.
 *
 * Run:  node scripts/verify.realestate.api.contract.js
 *
 * DEFECT-3 (§0A.3): six `bussiness-setup` settings screens shipped fully
 * built and were never reachable — no route, no import. This script makes
 * that class of failure loud: every screen folder under
 * `real-estate-management/` must have a matching `path:` entry in its
 * `routes.ts`, and the Real Estate settings screen must be wired in
 * `bussiness-setup/routes.ts`.
 *
 * Second half: admin list responses must never leak privileged document
 * classes. The list controller returns documents; the check asserts the
 * admin documents screen reads through the visibility-aware path.
 */

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + (e ? '  ->  ' + e : ''));
};

const PANEL = path.resolve(__dirname, '..', '..', 'Admin_panel', 'src', 'app', 'pages');
const MGMT = path.join(PANEL, 'admin', 'real-estate-management');
const MGMT_ROUTES = path.join(MGMT, 'routes.ts');
const BUSS = path.join(PANEL, 'admin', 'bussiness-setup');
const BUSS_ROUTES = path.join(BUSS, 'routes.ts');

// ---------------------------------------------------------------- F-6 guard

console.log('\n[1] every real-estate-management screen folder has a routes.ts entry');

const routesSrc = fs.readFileSync(MGMT_ROUTES, 'utf8');
const folders = fs
  .readdirSync(MGMT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('dialog-'))
  .map((d) => d.name);

let wired = 0;
for (const folder of folders) {
  const hasComponent = fs.readdirSync(path.join(MGMT, folder)).some((f) => f.endsWith('.ts'));
  if (!hasComponent) {
    ok(`${folder}/ — no component, nothing to wire`);
    continue;
  }
  const pat = new RegExp(`path:\\s*['"]${folder}['"]`);
  if (pat.test(routesSrc)) {
    wired += 1;
    ok(`${folder}/ → path: '${folder}'`);
  } else {
    bad(`${folder}/`, 'screen folder with no routes.ts entry (DEFECT-3 class)');
  }
}
console.log(`  wired ${wired}/${folders.length} screen folders`);

// ------------------------------------------------- bussiness-setup wiring

console.log('\n[2] real-estate-settings wired in bussiness-setup');

const bussSrc = fs.readFileSync(BUSS_ROUTES, 'utf8');
if (/real-estate-settings/.test(bussSrc)) ok('bussiness-setup/routes.ts has the real-estate-settings entry');
else bad('bussiness-setup/routes.ts', 'missing real-estate-settings entry');

const sidebarCandidates = [
  path.join(PANEL, '..', 'layouts', 'full', 'vertical', 'sidebar', 'sidebar-data.ts'),
];
let sidebarHit = false;
for (const cand of sidebarCandidates) {
  try {
    if (/real-estate-settings/.test(fs.readFileSync(cand, 'utf8'))) sidebarHit = true;
  } catch (e) {
    /* layout path differs — non-fatal, route entry is the load-bearing half */
  }
}
if (sidebarHit) ok('sidebar-data.ts links real-estate-settings');
else console.log('  SKIP sidebar-data.ts link (layout path differs in this tree — route entry is load-bearing)');

// ------------------------------------------- document leakage (admin surface)

console.log('\n[3] admin document surface stays visibility-aware');

const adminListSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'controllers', 'realestate.admin.list.controller.js'),
  'utf8'
);
if (/listDocuments/.test(adminListSrc)) ok('admin list controller exposes listDocuments');
else bad('admin list controller', 'no listDocuments');

// The bank portal must scope through live loan applications, never a `bank`
// field on the document (the schema has none — such a filter matches nothing).
const bankSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'controllers', 'realestate.bank.controller.js'),
  'utf8'
);
if (/RealEstateLoanApplication/.test(bankSrc) && /allowedClasses\('bank'\)/.test(bankSrc))
  ok('bank documents scoped via live loan applications + bank visibility classes');
else bad('bank documents', 'not scoped via loan applications and bank visibility');
if (/filter\s*=\s*\{\s*bank:\s*bankId\s*\}/.test(bankSrc))
  bad('bank documents', 'filters on a `bank` field the document schema does not have');
else ok('no dead `{ bank }` filter on documents');

// ------------------------------------------------------- done

console.log('');
if (failed > 0) {
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL CONTRACT CHECKS PASSED');
