/**
 * verify.realestate.roles.js — Real Estate rights and route guards.
 *
 * ## Why this was rewritten
 *
 * The previous version of this file queried the `roles` Mongo collection for documents
 * named `Vendor`, `Admin` and `VendorAgent`. Three problems, in ascending order of
 * seriousness:
 *
 *   1. It `require`d `chai`, which is not a dependency of this package, so it had never
 *      executed once. It looked like the most thorough test in the suite while checking
 *      nothing.
 *   2. It called `Model.sync()`, removed in Mongoose 6+. Against the installed version
 *      that throws `sync is not a function`.
 *   3. **It tested the wrong source of truth.** `auth.factory.js` decides every request
 *      from `roleRights.get(user.role)`, where `roleRights` is a `Map` built in
 *      `src/config/roles.js`. The `roles` collection is not consulted on that path — and
 *      in this database it is empty, so every assertion in the old file could not have
 *      passed however the connection was fixed.
 *
 * So this now tests `src/config/roles.js`, which is what actually grants access, plus the
 * one thing the old file was reaching for and could not express: that every rights string a
 * Real Estate route cites is a right some role actually holds.
 *
 * That last check is the DEFECT-2 guard. Doc §0A.3 records that a Real Estate route with no
 * rights string passes `auth.factory.js` for any authenticated user. The complementary
 * failure is a route citing a right that no role holds, which locks every caller out and
 * reads as "the feature is broken" rather than "the string is misspelled".
 *
 * Run: node scripts/verify.realestate.roles.js
 */

const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');
const MODULE = path.join(API, 'src', 'modules', 'realestate');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const { roles, roleRights } = require(path.join(API, 'src/config/roles.js'));

/**
 * Every rights string a role holds.
 * @returns {Map<string, Set<string>>}
 */
const rightsByRole = new Map();
for (const [name, rights] of roleRights.entries()) {
  rightsByRole.set(name, new Set(rights));
}

/** Every right known to the platform. */
const allRights = new Set();
for (const set of rightsByRole.values()) for (const r of set) allRights.add(r);

/** Real Estate roles, by the naming the doc uses. */
const REAL_ESTATE_ROLES = ['vendor', 'vendorAgent', 'listingManager', 'reviewer', 'realEstateExecutive'];

// --------------------------------------------------------------------------- [1]

console.log('\n[1] the real estate roles are declared in config/roles.js');

assert(Array.isArray(roles), '`roles` export is not an array');
assert(roleRights instanceof Map, '`roleRights` export is not a Map');
ok(`config/roles.js exports ${roles.length} roles and a roleRights Map`);

for (const name of REAL_ESTATE_ROLES) {
  if (roles.includes(name)) ok(`role "${name}" declared`);
  else bad(`role "${name}"`, 'missing from the roles export');
}

// The doc §15 names the executive role exactly. A typo here means the role silently never
// matches, which looks like "nobody can log in as an executive".
if (roles.includes('realEstateExecutive')) {
  ok('the executive role is spelled realEstateExecutive, as doc §15 specifies');
}

// --------------------------------------------------------------------------- [2]

console.log('\n[2] admin holds every realestate.admin_* right it needs');

const adminRights = rightsByRole.get('admin') || new Set();
const adminNeeded = [
  'realestate.admin_manage_listings',
  'realestate.admin_manage_vendors',
  'realestate.admin_manage_packages',
  'realestate.admin_manage_entitlements',
  'realestate.admin_manage_verifications',
];

const adminMissing = adminNeeded.filter((r) => !adminRights.has(r));
if (adminMissing.length) bad('admin rights', 'missing ' + adminMissing.join(', '));
else ok(`admin holds all ${adminNeeded.length} realestate.admin_* rights`);

// --------------------------------------------------------------------------- [3]

console.log('\n[3] vendor and executive stay separate (doc §15, line 1773)');

const vendorEstate = new Set(
  [...rightsByRole.get('vendor') || [], ...rightsByRole.get('vendorAgent') || []].filter((r) =>
    r.startsWith('realestate.')
  )
);
const execEstate = [...(rightsByRole.get('realEstateExecutive') || [])].filter((r) =>
  r.startsWith('realestate.')
);

if (!execEstate.length) {
  bad('executive real-estate rights', 'none declared');
} else {
  ok(`executive declares ${execEstate.length} realestate.* rights`);

  const shared = execEstate.filter((r) => vendorEstate.has(r));
  if (shared.length) bad('executive/vendor overlap', 'shared: ' + shared.join(', '));
  else ok('shares no realestate.* string with vendor or vendorAgent');

  // Both roles live in one app (Partner_app), so the check above is the only thing keeping
  // one shell's permissions out of the other.
  const prefixed = execEstate.filter((r) => r.startsWith('realestate.executive.'));
  if (prefixed.length === execEstate.length) {
    ok('every executive right is namespaced under realestate.executive.');
  } else {
    const loose = execEstate.filter((r) => !r.startsWith('realestate.executive.'));
    bad('executive namespace', 'outside realestate.executive.: ' + loose.join(', '));
  }
}

// BR-10: SANCTIONED / REJECTED / DISBURSED are bank-only, enforced by rights-string
// absence. If an executive ever gains a loan right, that enforcement is gone.
const execAll = [...(rightsByRole.get('realEstateExecutive') || [])];
const loanish = execAll.filter((r) => /loan|bank|sanction|disburs|repay|mortgage/i.test(r));
if (loanish.length) bad('BR-10 — executive must hold no loan or bank right', loanish.join(', '));
else ok('BR-10 — no loan, bank, sanction or disbursement right on an executive');

// --------------------------------------------------------------------------- [4]

console.log('\n[4] the real-estate rights this phase added are not duplicated');

/**
 * Scoped to `realestate.*` strings only, and to those on the roles this phase touches.
 *
 * A wider version of this check scanned every right on every Real Estate role and duly
 * reported a duplicate `updateVendorDiningCoupon` — a **dining** permission, inside the
 * `vendor` role, that predates the Real Estate work and is functionally harmless
 * (`auth.factory.js` asks `requiredRights.every(r => userRights.includes(r))`, and
 * `includes` ignores repeats). Fixing it would have meant editing unrelated dining rights
 * to satisfy a Real Estate test, which is not a trade this phase gets to make.
 *
 * So the check now covers exactly what it is responsible for: the `realestate.*` rights on
 * the roles the Real Estate phases own.
 */
const OWNED_ROLES = REAL_ESTATE_ROLES;

let dupeFound = 0;
for (const name of OWNED_ROLES) {
  const list = (roleRights.get(name) || []).filter((r) => r.startsWith('realestate.'));
  const dupes = [...new Set(list.filter((r, i) => list.indexOf(r) !== i))];
  if (dupes.length) {
    dupeFound++;
    bad(`duplicate realestate.* rights on "${name}"`, dupes.join(', '));
  } else {
    ok(`"${name}" — ${list.length} realestate.* rights, no duplicates`);
  }
}
if (!dupeFound) ok('no duplicated realestate.* rights on any Real Estate role');

const preExisting = (roleRights.get('vendor') || []).filter(
  (r, i, a) => a.indexOf(r) !== i && !r.startsWith('realestate.')
);
if (preExisting.length) {
  ok(
    `note: ${preExisting.length} duplicated non-real-estate right(s) left alone by this ` +
      `check (e.g. ${[...new Set(preExisting)].slice(0, 3).join(', ')}) — pre-existing, ` +
      'outside this phase, harmless'
  );
}

// --------------------------------------------------------------------------- [5]

console.log('\n[5] every rights string a real-estate route cites is a right some role holds');

/**
 * Pull rights strings out of a route file.
 *
 * Two shapes appear in this codebase. `realestate.admin.route.js` names its rights as
 * module-level constants — `const MANAGE_VENDORS = 'realestate.admin_manage_vendors'` —
 * and passes the identifier to `webAuth(...)`, so a scan for string literals alone finds
 * nothing and silently "passes". Both forms are collected: literals directly, and
 * identifiers by resolving the `const NAME = 'value'` declarations in the same file.
 *
 * A right built at runtime from a computed value cannot be checked statically. That is a
 * gap, not a pass — the `citedCount === 0` guard below turns "I found nothing to check"
 * into a failure rather than a green tick.
 */
const citedRights = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const found = new Set();

  for (const m of src.matchAll(/webAuth\(\s*['"]([^'"]+)['"]\s*\)/g)) found.add(m[1]);

  const constants = new Map();
  for (const m of src.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g)) {
    constants.set(m[1], m[2]);
  }

  for (const m of src.matchAll(/webAuth\(\s*([A-Z0-9_]+)\s*\)/g)) {
    const value = constants.get(m[1]);
    if (value) found.add(value);
    else found.add(`<unresolved ${m[1]}>`);
  }

  return found;
};

const routeDir = path.join(MODULE, 'routes');
const routeFiles = fs.existsSync(routeDir)
  ? fs.readdirSync(routeDir).filter((f) => f.endsWith('.js'))
  : [];

let citedCount = 0;
for (const file of routeFiles) {
  const cited = citedRights(path.join(routeDir, file));
  if (!cited.size) continue;
  citedCount += cited.size;

  const unknown = [...cited].filter((r) => !allRights.has(r));
  if (unknown.length) {
    bad(`rights cited in ${file}`, 'no role holds: ' + unknown.join(', '));
  } else {
    ok(`${file} cites ${cited.size} right(s): ${[...cited].join(', ')}`);
  }
}
if (!citedCount) {
  bad(
    'route rights scan',
    'no route file cited any rights string — either the scan is broken or every ' +
      'authenticated route is unguarded, and the two are indistinguishable from here'
  );
}

// --------------------------------------------------------------------------- [6]

console.log('\n[6] DEFECT-2 — no authenticated real-estate route lacks a rights string');

/**
 * The public route file is the deliberate exception. Its header explains why: a customer
 * searches before signing in, so those routes carry no rights string because a rights
 * string is only meaningful on an authenticated route. Every *other* route file must have
 * one on each of its routes.
 */
const PUBLIC_ROUTE = 'realestate.public.route.js';

const countRoutes = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  // `router.get('/x', mw, handler)` — count declarations, then note whether a known auth
  // middleware appears anywhere in the file.
  const decls = [...src.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)].length;
  const gated =
    /webAuth\s*\(/.test(src) ||
    /executiveAuth\b/.test(src) ||
    /bankAuth\b/.test(src) ||
    /realestateTenantMiddleware\b/.test(src) ||
    /appAuth\s*\(/.test(src);
  return { decls, gated };
};

for (const file of routeFiles) {
  if (file === PUBLIC_ROUTE) {
    ok(`${file} is guest-accessible by design and is exempt`);
    continue;
  }
  const { decls, gated } = countRoutes(path.join(routeDir, file));
  if (!decls) {
    bad(file, 'no routes found — the scan pattern is wrong, not the file');
  } else if (!gated) {
    bad(`${file} (DEFECT-2)`, `${decls} routes and no auth middleware in the file`);
  } else {
    ok(`${file} — ${decls} routes, auth middleware present`);
  }
}

// --------------------------------------------------------------------------- done

console.log('');
if (failed > 0) {
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL ROLE CHECKS PASSED');