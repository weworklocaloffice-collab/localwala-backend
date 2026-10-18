/*
 * The admin panel's transition tables, checked against the API's.
 *
 * ## Why this exists
 *
 * The settlement and franchise screens each keep their own copy of the API's
 * transition table, so an operator is only ever offered a button that will succeed.
 * That is a deliberate duplication — and a duplicated table drifts silently. Nothing
 * in either build notices when the two disagree, and the symptom is an operator
 * clicking a control that returns a raw 400, discovered weeks later.
 *
 * The API is the source of truth, so this check lives here rather than in the panel's
 * test runner: the web build has no Node types, and reading a sibling directory from
 * a browser test is not something to rely on.
 *
 * `paid` is excluded from the settlement comparison on purpose. Payout is
 * `POST /settlements/:settlement/pay`, not a status patch, so the screen must not
 * offer it even though the service lists it as reachable.
 *
 * Usage: `node scripts/verify.admin.transitions.js`
 */

const fs = require('fs');
const path = require('path');

const API_ROOT = path.join(__dirname, '..');
// `AppSourceCode/API/scripts` -> `AppSourceCode/Admin_panel`. Two levels up from
// `__dirname` reaches AppSourceCode; three overshoots into C:\localwala.
const PANEL_ROOT = path.join(__dirname, '..', '..', 'Admin_panel', 'src', 'app', 'pages', 'admin', 'dairy-management');

const SETTLEMENT_SERVICE = path.join(API_ROOT, 'src/modules/dairy/services/dairy.settlement.service.js');
const PARTNER_SERVICE = path.join(API_ROOT, 'src/modules/dairy/services/dairy.partner.service.js');
const SETTLEMENT_TS = path.join(PANEL_ROOT, 'settlements/settlements.ts');
const FRANCHISE_TS = path.join(PANEL_ROOT, 'franchises/franchises.ts');

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/**
 * Pulls `{ draft: ['submitted', 'void'], ... }` out of a source file.
 *
 * Both the API services and the panel components write the table as a plain object
 * literal with quoted or bare keys and single-quoted strings, so one parser covers
 * both. Deliberately not importing: the services open a database connection on
 * require, and the panel is TypeScript.
 */
const readTable = (file, marker, searchAfter) => {
  const source = fs.readFileSync(file, 'utf8');

  // `searchAfter` exists because `dairy.partner.service.js` has two `const allowed`
  // tables — one for partners, one for franchises. Anchoring on the enclosing
  // function name is what stops the franchise comparison silently reading the
  // partner table, which has no `expired` status and would have looked like drift.
  const anchor = searchAfter ? source.indexOf(searchAfter) : -1;
  if (searchAfter && anchor === -1) {
    throw new Error(`Could not find "${searchAfter}" in ${file}`);
  }
  const from = anchor === -1 ? 0 : anchor;

  const start = source.indexOf(marker, from);
  if (start === -1) {
    throw new Error(`Could not find "${marker}" in ${file}${searchAfter ? ` after "${searchAfter}"` : ''}`);
  }

  // Find the object *literal*, not any brace.
  //
  // The panel's constants are typed: `export const X: { [k: string]: string[] } = {`.
  // Taking the first `{` after the marker captures that type annotation, which holds
  // no rows at all. So scan forward for a brace whose contents actually start with
  // `key: [`.
  let open = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] !== '{') continue;
    if (/^\s*\w+\s*:\s*\[/.test(source.slice(i + 1, i + 40))) {
      open = i;
      break;
    }
  }
  if (open === -1) {
    throw new Error(`No object literal with array rows found after "${marker}" in ${file}`);
  }

  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`Unbalanced braces after "${marker}" in ${file}`);
  }
  const literal = source.slice(open, end + 1);
  const table = {};
  const rowRe = /(\w+)\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = rowRe.exec(literal))) {
    table[m[1]] = (m[2].match(/'([^']*)'/g) || []).map((v) => v.replace(/'/g, ''));
  }
  return table;
};

const same = (a, b) => JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort());

console.log('\n1. Settlement transitions');

const apiSettlements = readTable(SETTLEMENT_SERVICE, 'const allowed = {');
const screenSettlements = readTable(SETTLEMENT_TS, 'export const SETTLEMENT_TRANSITIONS');

check(
  'the screen knows every status the API does',
  Object.keys(apiSettlements).every((k) => k in screenSettlements),
  `screen has ${Object.keys(screenSettlements).join(', ')}`
);

for (const [from, allowed] of Object.entries(apiSettlements)) {
  const onScreen = screenSettlements[from] || [];
  // `paid` moves money, so it is a POST endpoint rather than a status patch.
  const wanted = allowed.filter((to) => to !== 'paid');
  check(
    `"${from}" offers exactly what the API allows`,
    same(onScreen, wanted),
    `api=[${wanted.join(',')}] screen=[${onScreen.join(',')}]`
  );
}

console.log('\n2. Settlement rows that are closed');

for (const from of ['paid', 'void']) {
  check(
    `"${from}" offers nothing (it is a closed statement)`,
    (screenSettlements[from] || []).length === 0,
    `[${(screenSettlements[from] || []).join(',')}]`
  );
}

console.log('\n3. Franchise transitions');

// Anchored on the franchise function: the partner table in the same file has no
// `expired` status, and reading that instead would report false drift.
const apiFranchises = readTable(PARTNER_SERVICE, 'const allowed = {', 'const setFranchiseStatus');
const screenFranchises = readTable(FRANCHISE_TS, 'export const FRANCHISE_TRANSITIONS');

check(
  'both sides list the same statuses',
  Object.keys(apiFranchises).sort().join(',') === Object.keys(screenFranchises).sort().join(','),
  `api=[${Object.keys(apiFranchises).sort().join(',')}] screen=[${Object.keys(screenFranchises).sort().join(',')}]`
);

for (const [from, allowed] of Object.entries(apiFranchises)) {
  check(
    `"${from}" offers exactly what the API allows`,
    same(screenFranchises[from] || [], allowed),
    `api=[${allowed.join(',')}] screen=[${(screenFranchises[from] || []).join(',')}]`
  );
}

console.log(
  failures === 0
    ? '\nADMIN TRANSITION TABLES MATCH THE API'
    : `\n${failures} CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);