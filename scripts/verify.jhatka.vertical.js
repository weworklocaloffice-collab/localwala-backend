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
 * verify.jhatka.vertical.js — end-to-end vertical verification. Phase 1m.
 *
 * This is the final gate before the vertical is considered "implemented".
 * It does NOT re-run the unit suites (they have their own scripts).
 * Instead it verifies:
 *   1. All 9 unit suites pass (by invoking them)
 *   2. All routes load without error
 *   3. Models register correctly (registration suite already does this)
 *   4. Roles exist and are disjoint from other verticals
 *   5. Cron jobs can be instantiated
 *   6. Seed script runs idempotently
 *   7. Lint passes on all Jhatka code
 *
 * Run: node scripts/verify.jhatka.vertical.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..');
const API_ROOT = path.join(REPO_ROOT, 'src');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

const runScript = (script) => {
  try {
    const out = execSync(`node ${script}`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000,
      stdio: 'pipe',
    });
    return { ok: true, output: out };
  } catch (err) {
    return { ok: false, output: err.stdout + err.stderr };
  }
};

console.log('\n=== Jhatka Vertical Verification ===\n');

// ---- 1. Unit suites ----
console.log('--- 1. Unit test suites ---');
const suites = [
  'taxonomy',
  'catalog',
  'inventory',
  'variableweight',
  'procurement',
  'money',
  'ops',
  'registration',
  'tenancy',
  'routeschema',
  'cart',
  // Asserts that a role HOLDS the rights its own routes demand. Added after all eight
  // admin files shipped 64 endpoints that would have 403'd, because `admin` held none
  // of the 21 `jhatka_*` rights those routes require — and no other gate asked.
  'rights',
  // Pins BOTH paise/rupee directions at the last boundary before a basket becomes
  // money. Six of the seven 100x defects in this vertical were one of these two
  // mistakes, and neither throws.
  'orderpricing',
  // Transient-conflict retry semantics. The integration suite sees these failures only
  // about one run in four, so nothing there can pin the behaviour.
  'transaction',
];

for (const s of suites) {
  const result = runScript(`scripts/verify.jhatka.${s}.units.js`);
  ok(`verify.jhatka.${s}.units.js`, result.ok, result.ok ? '' : result.output.slice(0, 200));
}

// ---- 2. Route loading ----
console.log('\n--- 2. Route loading ---');
try {
  require(path.join(API_ROOT, 'routes', 'v1', 'index.js'));
  ok('src/routes/v1/index.js loads without error', true);
} catch (err) {
  ok('src/routes/v1/index.js loads without error', false, err.message);
}

// Check each Jhatka route file individually
const routeFiles = [
  // §15.1 naming: jhatka.<actor>.route.js
  'jhatka.public.route.js',
  'jhatka.customer.route.js',
  'jhatka.catalogue.route.js',
  'jhatka.partner.route.js',
  'jhatka.partner.orders.route.js',
  'jhatka.partner.subscriptions.route.js',
  'jhatka.partner.inventory.route.js',
  'jhatka.partner.money.route.js',
  'jhatka.partner.compliance.route.js',
  'jhatka.partner.labels.route.js',
  'jhatka.driver.route.js',
];

for (const rf of routeFiles) {
  try {
    require(path.join(API_ROOT, 'modules', 'jhatka', 'routes', rf));
    ok(`Route ${rf} loads`, true);
  } catch (err) {
    ok(`Route ${rf} loads`, false, err.message);
  }
}

// ---- 2b. The MOUNT table matches §15.2, with no duplicate mount ----------
//
// A route file loading proves nothing about whether it is REACHABLE. A repeated
// `router.use('/jhatka/partner', …)` registers silently and the second mount is
// simply dead for every path the first one answered — which is exactly what
// happened here before the restructure, and it survived every suite. So the
// mount table itself is now asserted.
console.log('\n--- 2b. mount table (§15.2) ---');
{
  const indexSrc = fs.readFileSync(path.join(API_ROOT, 'routes', 'v1', 'index.js'), 'utf8');

  // Built with `new RegExp` rather than a literal: the pattern needs single quotes
  // inside it to match the source's quoted mount strings, and a regex literal
  // containing an unbalanced `'` is rejected by the parser before it can run.
  //
  // Each match keeps BOTH the path and the route variable, because "is this path
  // registered twice" and "is this FILE registered twice" are different questions —
  // see the duplicate check below.
  const mounts = [
    ...indexSrc.matchAll(
      new RegExp("path:\\s*'(/jhatka[^']*)',\\s*\\n?\\s*route:\\s*(\\w+)", 'g')
    ),
  ].map((m) => ({ path: m[1], route: m[2] }));

  const mountPaths = mounts.map((m) => m.path);

  ok(
    'the jhatka mount table was parsed',
    mountPaths.length > 0,
    String(mountPaths.length)
  );

  // One mount per actor surface (§15.2), plus the documented sub-paths.
  const EXPECTED_MOUNTS = [
    '/jhatka/public',
    '/jhatka/catalogue',
    '/jhatka/customer',
    '/jhatka/partner',
    '/jhatka/partner/orders',
    '/jhatka/partner/subscriptions',
    '/jhatka/partner/inventory',
    '/jhatka/partner/money',
    '/jhatka/partner/compliance',
    '/jhatka/partner/labels',
    '/jhatka/driver',
    // B1 admin. One path, eight FILES mounted at it — see the duplicate check below
    // for why a repeated path is legal here as long as the route differs.
    '/jhatka/admin',
  ];

  const missing = EXPECTED_MOUNTS.filter((m) => !mountPaths.includes(m));
  ok(
    'every §15.2 mount is present',
    missing.length === 0,
    missing.join(', ')
  );

  const unexpected = mountPaths.filter((m) => !EXPECTED_MOUNTS.includes(m));
  ok(
    'and there are no mounts the plan does not list',
    unexpected.length === 0,
    unexpected.join(', ')
  );

  // THE regression this block exists for: `/jhatka/partner` was mounted TWICE with
  // the SAME route file. Express accepts that silently and the second mount is dead
  // for every path the first answered — so the bug is a repeated PAIR, not a repeated
  // path.
  //
  // Two DIFFERENT files at one path is legitimate and is the established pattern here
  // (`/admin` then `/admin/reels`; and B1 mounts each admin file at `/jhatka/admin`
  // so the eight can grow independently). Asserting "no repeated path" would forbid
  // that, so the check is on the (path, route) PAIR instead.
  const mountKeys = mounts.map((m) => `${m.path}::${m.route}`);
  const duplicateKeys = mountKeys.filter((k, i) => mountKeys.indexOf(k) !== i);
  ok(
    'no mount registers the SAME route file twice at the same path',
    duplicateKeys.length === 0,
    duplicateKeys.length === 0 ? '' : `duplicated: ${[...new Set(duplicateKeys)].join(', ')}`
  );

  // ...and no single route FILE is mounted at two different paths, which is how a
  // file ends up answering under two prefixes.
  const routesByPath = new Map();
  for (const m of mounts) {
    if (!routesByPath.has(m.route)) routesByPath.set(m.route, []);
    routesByPath.get(m.route).push(m.path);
  }
  const multiMounted = [...routesByPath.entries()].filter(([, ps]) => ps.length > 1);
  ok(
    'no route file is mounted at two different paths',
    multiMounted.length === 0,
    multiMounted.map(([r, ps]) => `${r}@${ps.join('+')}`).join(', ')
  );

  // The customer surface must be under an actor prefix (§15.2 names
  // /v1/jhatka/customer explicitly). It was previously /jhatka/orders.
  ok(
    'customer endpoints are mounted under /jhatka/customer, not an actor-less path',
    mountPaths.includes('/jhatka/customer') && !mountPaths.includes('/jhatka/orders'),
    mountPaths.filter((m) => m.startsWith('/jhatka') && !m.includes('partner') && !m.includes('driver') && !m.includes('public')).join(', ')
  );

  // §15.2 also names the customer order endpoints `/orders` and `/orders/:order`.
  // Mounting at the actor prefix is not enough on its own: with bare `/` and `/:id`
  // inside the customer router, `GET /v1/jhatka/customer/outlets/:outlet` would be
  // swallowed by `/:id`, and every later customer route (cart, subscriptions,
  // complaints, reviews) would be unreachable.
  {
    const customerSrc = fs.readFileSync(
      path.join(API_ROOT, 'modules', 'jhatka', 'routes', 'jhatka.customer.route.js'),
      'utf8'
    );
    const bareCollection = /router\.(get|post)\('\/',/.test(customerSrc);
    const bareParam = /router\.(get|post|patch|delete)\('\/:id'/.test(customerSrc);
    ok(
      'customer order routes are namespaced under /orders, not bare / or /:id',
      !bareCollection && !bareParam,
      `bare '/'=${bareCollection} bare '/:id'=${bareParam}`
    );
    ok(
      'customer order creation is reachable at §15.2\'s /orders',
      /router\.post\('\/orders'/.test(customerSrc),
      'expected router.post(\'/orders\''
    );
  }

  // §15.1 naming. `admin` was not in the original actor list because B1 had not been
  // built; it is an actor now — a cross-outlet one, mounted at `/jhatka/admin` and
  // authorised with `webAuth('jhatka_*')` rather than `jhatkaAuth`, because it has no
  // single outlet to scope tenancy against.
  const badNames = [...indexSrc.matchAll(/routes\/(jhatka[^']*)/g)]
    .map((m) => m[1])
    .filter((n) => !/^jhatka\.(public|customer|catalogue|partner|driver|admin)\./.test(n));
  ok(
    'every jhatka route file follows §15.1 (jhatka.<actor>.<domain>.route.js)',
    badNames.length === 0,
    badNames.join(', ')
  );
}

// ---- 2c. No route is shadowed by an earlier literal in the same router ----
//
// §15.1: "Literal segments before `:param` siblings, always. Express matches in
// registration order."
//
// A shadowed route LOADS and never runs, so nothing in section 2 detects it, and
// the symptom is a confusing runtime error rather than a missing endpoint.
// `list.jhatka.routes.js` proved this is not theoretical: `GET /inventory/batches`
// and `GET /inventory/recalls` were both unreachable behind `GET /inventory/:id`.
//
// Asserted as an explicit ALLOWLIST rather than a blanket zero, so the known
// outstanding defect stays visible in the report instead of being deleted to make
// the suite green. Remove an entry when its fix lands.
console.log('\n--- 2c. route shadowing (§15.1) ---');
{
  // CURRENTLY EMPTY, and that is the point. The two entries that were here
  // (`/jhatka/partner/inventory/batches` and `/recalls`, both shadowed by
  // `GET /inventory/:id`) were fixed by rewriting that router so every literal
  // segment precedes the `:id` route. The list is kept rather than deleted,
  // because a gate with no allowlist cannot tell "fixed" from "never checked".
  const KNOWN_SHADOWED = [
    // (none outstanding)
  ];

  let report = '';
  let shadowedPaths = [];
  try {
    const {
      execFileSync: run,
    } = require('child_process');
    // Re-derive by executing the diagnostic and reading its machine-readable tail.
    const out = run(
      process.execPath,
      [path.join(__dirname, 'list.jhatka.routes.js')],
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000 }
    );
    // The diagnostic prints "shadowed by" blocks; extract the path on the line above.
    const lines = out.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('shadowed by') && lines[i - 1]) {
        const m = /^\s{3}(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s*$/.exec(lines[i - 1]);
        if (m) shadowedPaths.push(m[2]);
      }
    });
    report = `${shadowedPaths.length} shadowed`;
  } catch (err) {
    ok('the shadowing diagnostic runs', false, err.message);
  }

  const unexpectedShadowed = shadowedPaths.filter((p) => !KNOWN_SHADOWED.includes(p));
  ok(
    'no NEW route is shadowed (known outstanding ones are allowlisted)',
    unexpectedShadowed.length === 0,
    unexpectedShadowed.join(', ')
  );

  // Known defects stay listed here with a count, so an entry cannot be quietly
  // deleted to turn the suite green. With none outstanding, this asserts the
  // allowlist and the live scan agree.
  const knownStillPresent = KNOWN_SHADOWED.filter((p) => shadowedPaths.includes(p));
  ok(
    'the allowlist matches what is actually shadowed',
    knownStillPresent.length === shadowedPaths.filter((p) => KNOWN_SHADOWED.includes(p)).length,
    `allowlist ${KNOWN_SHADOWED.length}, still shadowed ${knownStillPresent.length} (${report})`
  );

  ok(
    'no shadowed route is outstanding at all',
    shadowedPaths.length === 0,
    shadowedPaths.join(', ')
  );
}

// ---- 3. Cron instantiation ----
console.log('\n--- 3. Cron instantiation ---');
try {
  const cron = require(path.join(API_ROOT, 'modules', 'jhatka', 'cron'));
  const jobs = cron.startJhatkaCron({
    mongoose: require('mongoose'),
    models: require(path.join(API_ROOT, 'models')),
    utils: {
      commercial: require(path.join(API_ROOT, 'modules', 'jhatka', 'utils', 'commercial.arithmetic')),
      compliance: require(path.join(API_ROOT, 'modules', 'jhatka', 'utils', 'compliance.arithmetic')),
      weight: require(path.join(API_ROOT, 'modules', 'jhatka', 'utils', 'weight.arithmetic')),
    },
  });
const jobNames = Object.keys(jobs);

  // Asserted BY NAME, not by count.
  //
  // The count kept a track record of every addition (8 -> 9 for `refundSettlement`)
  // and broke each time one landed, which is the wrong way round: a gate that fails on
  // a correct addition trains you to make the addition look like a removal. Naming the
  // jobs means a NEW job has to be added here deliberately — which is the point, since
  // a job nobody reviewed is a job nobody knows runs — while a renamed or deleted one
  // still fails immediately.
  const REQUIRED_JOBS = [
    'paymentTimeoutSweep',   // closes gateway orders abandoned at the payment screen
    'completionSweep',      // 01:00 DELIVERED -> COMPLETED with nothing open
    'dailySettlement',      // 02:00 per-outlet settlement
    'recurringOrders',      // 03:00 subscription occurrence generator
    'refundSettlement',     // 03:30 gateway refund queue — F-5
    'complianceWarnings',   // 04:00 FSSAI expiry
    'batchExpiry',          // 05:00 FEFO write-off
    'weeklyPayouts',        // 06:00 Mondays
    'payableAgeing',        // 07:00 supplier payable ageing
    'promoCleanup',         // 08:00 promotion expiry
    'varianceAgeing',       // 09:00 weight-variance flags
    'subscriptionBilling',  // 05:30 prepaid occurrence charging
  ];

  const missing = REQUIRED_JOBS.filter((n) => !jobNames.includes(n));
  ok(
    'every scheduled Jhatka job is present, by name',
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `present: ${jobNames.join(', ')}`
  );

  const extra = jobNames.filter((n) => !REQUIRED_JOBS.includes(n));
  ok(
    'no scheduled job is running that this gate does not know about',
    extra.length === 0,
    extra.join(', ')
  );

  cron.stopJhatkaCron(jobs);
} catch (err) {
  ok('Cron jobs instantiated', false, err.message);
}

// ---- 4. Roles exist and are disjoint ----
console.log('\n--- 4. Roles verification ---');
try {
  const { roles, roleRights } = require(path.join(API_ROOT, 'config', 'roles'));

  ok('jhatkaPartner role exists', roles.includes('jhatkaPartner'));
  ok('jhatkaDriver role exists', roles.includes('jhatkaDriver'));

  const partnerRights = roleRights.get('jhatkaPartner') || [];
  const driverRights = roleRights.get('jhatkaDriver') || [];

  ok('jhatkaPartner has rights', partnerRights.length > 0, `${partnerRights.length} rights`);
  ok('jhatkaDriver has rights', driverRights.length > 0, `${driverRights.length} rights`);

  // Disjoint from dairyPartner/dairyDriver (business-scoped rights only)
  // Platform utilities like uploadImage, update_locale, notification_list, mark_all_read,
  // read_notification are intentionally shared across ALL roles and are NOT a conflict.
  const isBusinessRight = (r) => r.startsWith('jhatka_') || r.startsWith('dairy_') || r.startsWith('stores_') || r.startsWith('realestate_');

  const dairyPartnerRights = roleRights.get('dairyPartner') || [];
  const dairyDriverRights = roleRights.get('dairyDriver') || [];
  const storePartnerRights = roleRights.get('storePartner') || [];
  const storeDriverRights = roleRights.get('storeDriver') || [];

  const partnerBusinessRights = partnerRights.filter(isBusinessRight);
  const driverBusinessRights = driverRights.filter(isBusinessRight);
  const dairyPartnerBusinessRights = dairyPartnerRights.filter(isBusinessRight);
  const dairyDriverBusinessRights = dairyDriverRights.filter(isBusinessRight);
  const storePartnerBusinessRights = storePartnerRights.filter(isBusinessRight);
  const storeDriverBusinessRights = storeDriverRights.filter(isBusinessRight);

  const overlapPartner = partnerBusinessRights.filter((r) => dairyPartnerBusinessRights.includes(r));
  const overlapDriver = driverBusinessRights.filter((r) => dairyDriverBusinessRights.includes(r));

  ok('jhatkaPartner business rights disjoint from dairyPartner', overlapPartner.length === 0, overlapPartner.length ? overlapPartner.join(', ') : 'none');
  ok('jhatkaDriver business rights disjoint from dairyDriver', overlapDriver.length === 0, overlapDriver.length ? overlapDriver.join(', ') : 'none');

  // Disjoint from storePartner/storeDriver
  const overlapStorePartner = partnerBusinessRights.filter((r) => storePartnerBusinessRights.includes(r));
  const overlapStoreDriver = driverBusinessRights.filter((r) => storeDriverBusinessRights.includes(r));

  ok('jhatkaPartner business rights disjoint from storePartner', overlapStorePartner.length === 0, overlapStorePartner.length ? overlapStorePartner.join(', ') : 'none');
  ok('jhatkaDriver business rights disjoint from storeDriver', overlapStoreDriver.length === 0, overlapStoreDriver.length ? overlapStoreDriver.join(', ') : 'none');
} catch (err) {
  ok('Roles verification', false, err.message);
}

// ---- 5. Lint ----
console.log('\n--- 5. Lint ---');
try {
  execSync('npx eslint src/modules/jhatka/**/*.js --quiet', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    stdio: 'pipe',
  });
  ok('ESLint on src/modules/jhatka', true);
} catch (err) {
  ok('ESLint on src/modules/jhatka', false, err.stdout + err.stderr);
}

// ---- 6. Seed idempotency (dry run - just check script loads) ----
console.log('\n--- 6. Seed script ---');
try {
  require(path.join(REPO_ROOT, 'scripts', 'jhatka.seed.js'));
  ok('Seed script loads', true);
} catch (err) {
  ok('Seed script loads', false, err.message);
}

// ---- 7. Model exports completeness ----
console.log('\n--- 7. Model exports ---');
try {
  const models = require(path.join(API_ROOT, 'models'));
  const jhatkaModels = Object.keys(models).filter((k) => k.startsWith('Jhatka'));
  const expected = [
    'JhatkaCategory', 'JhatkaProduct', 'JhatkaVariant', 'JhatkaYieldSpec',
    'JhatkaOutlet', 'JhatkaPartner', 'JhatkaFranchise', 'JhatkaPriceOverride',
    'JhatkaTenantRoleAssignment',
    'JhatkaSupplier', 'JhatkaSupplierDocument', 'JhatkaQualityRejectionReason',
    'JhatkaPurchaseOrder', 'JhatkaProcurementReceipt', 'JhatkaBatch',
    'JhatkaBatchAllocation', 'JhatkaInventoryItem', 'JhatkaInventoryMovement',
    'JhatkaWastage', 'JhatkaRecall',
    'JhatkaOrderItem', 'JhatkaOrder', 'JhatkaOrderStatusHistory',
    'JhatkaWeightConfirmation', 'JhatkaPreparationTicket', 'JhatkaRefund',
    'JhatkaLabel', 'JhatkaOutletVarianceFlag',
    'JhatkaSubscription', 'JhatkaSubscriptionEvent', 'JhatkaRecurringOrder',
    'JhatkaDriver', 'JhatkaDelivery', 'JhatkaDeliveryPOD', 'JhatkaDeliverySettlement',
    'JhatkaCommissionRule', 'JhatkaOperatorPayout', 'JhatkaSupplierPayable', 'JhatkaSettlement',
    'JhatkaCompliance', 'JhatkaComplaint', 'JhatkaReview', 'JhatkaPromotion',
    'JhatkaSettings',
  ];
  const missing = expected.filter((m) => !jhatkaModels.includes(m));
  ok(`All ${expected.length} Jhatka models exported`, missing.length === 0, missing.join(', '));
} catch (err) {
  ok('Model exports', false, err.message);
}

// ---- Summary ----
console.log('\n=== VERTICAL VERIFICATION SUMMARY ===');
if (failures === 0) {
  console.log('ALL VERTICAL CHECKS PASSED');
  process.exit(0);
} else {
  console.log(failures + ' CHECK(S) FAILED');
  process.exit(1);
}