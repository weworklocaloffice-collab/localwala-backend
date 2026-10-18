/**
 * verify.jhatka.rights.units.js — every route's rights are held by a role that may use them.
 *
 * ## Why this suite exists
 *
 * All eight `jhatka.admin.*` route files were built, mounted, lint-clean, drift-clean,
 * schema-clean and vertical-green — and **every one of the 64 endpoints would have
 * returned 403**, because the `admin` role held none of the 22 `jhatka_*` rights those
 * routes demand.
 *
 * Nothing caught it. The existing gates check that routes LOAD, that they reference
 * fields that EXIST, and that mounts are not duplicated. Not one of them asked the
 * question this file asks:
 *
 *     "Does a role that is supposed to call this route actually HOLD the right?"
 *
 * That is the inverse of the defect the plan warns about in §15.1, where a stores admin
 * route borrowed a DAIRY permission and worked only because the admin role happened to
 * hold it. Here nothing was borrowed, so nothing worked — and the difference is
 * invisible to every other gate.
 *
 * ## What it asserts
 *
 *   1. Every `jhatka_*` right referenced by a route is held by SOME role. An orphan
 *      right means a route nobody can call.
 *   2. Every right referenced by an ADMIN route is held by `admin`.
 *   3. `admin` holds no OPERATIONAL right — the ones that would let a console become a
 *      second path to a physical act.
 *   4. Customer rights are disjoint from partner and driver rights, so a customer
 *      cannot call an outlet route.
 *
 * Run: node scripts/verify.jhatka.rights.units.js
 */

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');

const { roleRights, JHATKA_ADMIN_RIGHTS } = require('../src/config/roles');

const REPO_ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(REPO_ROOT, 'src', 'modules', 'jhatka', 'routes');

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
};
const section = (t) => console.log(`\n--- ${t} ---`);

/** Every route file, with its actor inferred from the §15.1 filename rule. */
function routeFiles() {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const actor = f.match(/^jhatka\.([a-z]+)\./)?.[1] || 'unknown';
      return { file: f, actor, src: fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8') };
    });
}

/** Rights a route requires: `webAuth('jhatka_x')` and `appAuth('jhatka_y')`. */
function rightsIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:webAuth|appAuth)\(\s*'(jhatka_[a-z_]+)'\s*\)/g)) {
    out.add(m[1]);
  }
  return [...out];
}

const files = routeFiles();
const byActor = files.reduce((acc, f) => {
  (acc[f.actor] = acc[f.actor] || []).push(f);
  return acc;
}, {});

const admin = new Set(roleRights.get('admin') || []);
const allHeld = new Set();
for (const [, rights] of roleRights) (rights || []).forEach((r) => allHeld.add(r));

// ---------------------------------------------------------------------------
section('every jhatka right referenced by a route is held by SOME role');
// ---------------------------------------------------------------------------
{
  const orphaned = [];
  const seen = new Set();

  for (const f of files) {
    for (const right of rightsIn(f.src)) {
      if (seen.has(right)) continue;
      seen.add(right);
      if (!allHeld.has(right)) orphaned.push(`${right} (${f.file})`);
    }
  }

  ok(
    'no route references a right that no role holds',
    orphaned.length === 0,
    orphaned.join(', ')
  );
  console.log(`         (${seen.size} distinct rights referenced across ${files.length} route files)`);
}

// ---------------------------------------------------------------------------
section('every right an ADMIN route needs is held by `admin`');
// ---------------------------------------------------------------------------
// The 64-endpoint 403. This is the assertion that would have caught it.
{
  const required = new Set();
  for (const f of byActor.admin || []) {
    rightsIn(f.src).forEach((r) => required.add(r));
  }

  const missing = [...required].filter((r) => !admin.has(r));
  ok(
    'admin holds every right its routes require',
    missing.length === 0,
    `MISSING: ${missing.join(', ')}`
  );
  ok(
    'admin grants match the routes exactly (no drift in either direction)',
    required.size === JHATKA_ADMIN_RIGHTS.length &&
      JHATKA_ADMIN_RIGHTS.every((r) => required.has(r)),
    `routes=${required.size} granted=${JHATKA_ADMIN_RIGHTS.length}`
  );
  console.log(`         (${(byActor.admin || []).length} admin files, ${required.size} rights)`);
}

// ---------------------------------------------------------------------------
section('admin holds NO operational right');
// ---------------------------------------------------------------------------
// A console that can perform a physical act is a second path to the same write with
// weaker guardrails — the hazard the plan names for GET-only surfaces. More
// specifically: an admin who can confirm a weight is the fraud vector the whole
// variance console exists to detect.
{
  const OPERATIONAL = [
    'jhatka_weight_confirm',      // weighing is a physical act at the counter
    'jhatka_order_manage',
    'jhatka_order_pick',
    'jhatka_order_pack',
    'jhatka_order_dispatch',
    'jhatka_receipt_create',      // posting stock is the outlet's act
    'jhatka_session_outlet_switch',
    'jhatka_session_scope_read',
    'jhatka_driver_write',
    'jhatka_delivery_update',
    'jhatka_remittance_manage',
    'jhatka_quality_manage',
    'jhatka_promotion_write',
  ];

  const leaked = OPERATIONAL.filter((r) => admin.has(r));
  ok(
    'admin holds no operational jhatka right',
    leaked.length === 0,
    `LEAKED: ${leaked.join(', ')}`
  );
  ok(
    'and no admin route references an operational right either',
    (() => {
      const bad = [];
      for (const f of byActor.admin || []) {
        for (const r of rightsIn(f.src)) {
          if (OPERATIONAL.includes(r)) bad.push(`${r} in ${f.file}`);
        }
      }
      if (bad.length) console.log(`         ${bad.join('; ')}`);
      return bad.length === 0;
    })(),
    ''
  );
}

// ---------------------------------------------------------------------------
section('customer rights are disjoint from partner and driver rights');
// ---------------------------------------------------------------------------
// §15.1: a customer must not be able to reach an outlet route. The 13
// `jhatka_customer_*` strings exist for exactly the reason the plan says about
// `dairy_customer_*`: without them the whole customer surface 403s.
{
  const customer = new Set(
    [...allHeld].filter((r) => r.startsWith('jhatka_customer_'))
  );
  const partnerRights = new Set(roleRights.get('jhatkaPartner') || []);
  const overlap = [...customer].filter((r) => partnerRights.has(r));

  ok('customer rights exist', customer.size === 13, `found ${customer.size}`);
  ok('a customer right is never also a partner right', overlap.length === 0, overlap.join(', '));

  const customerRouteRights = rightsIn(
    (byActor.customer || []).map((f) => f.src).join('\n')
  );
  const notCustomer = customerRouteRights.filter(
    (r) => !r.startsWith('jhatka_customer_')
  );
  ok(
    'every customer route requires a customer right',
    notCustomer.length === 0,
    notCustomer.join(', ')
  );
}

// ---------------------------------------------------------------------------
section('the vertical scopes actors, not platforms');
// ---------------------------------------------------------------------------
// A platform right can never imply business authority over a chain the person does
// not belong to. If `jhatkaPartner` appeared as a route actor, or `jhatkaDriver`
// gated a partner route, tenancy would be bypassable.
{
  const actors = Object.keys(byActor).sort();
  ok(
    'actors are exactly the §15.1 set',
    JSON.stringify(actors) ===
      JSON.stringify(['admin', 'catalogue', 'customer', 'driver', 'partner', 'public']),
    actors.join(', ')
  );

  const partnerOnDriver = rightsIn(
    (byActor.driver || []).map((f) => f.src).join('\n')
  ).filter((r) => !r.startsWith('jhatka_') || r.startsWith('jhatka_customer_'));
  ok(
    'the driver surface requires no partner or customer right',
    partnerOnDriver.length === 0,
    partnerOnDriver.join(', ')
  );
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL RIGHTS CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);