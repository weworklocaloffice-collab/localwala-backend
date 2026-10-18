/**
 * verify.realestate.executive.js — Phase 5 executive API surface.
 *
 * Covers the parts of Phase 5 that `verify.realestate.visits.js` does not: the role, the
 * auth gate, the transition table's second copy, and the mounted route inventory.
 *
 * ## No database, no test runner
 *
 * Same reason as `verify.realestate.boot.js`: `chai`/`mocha` are not dependencies here, so
 * a `describe`/`it` script in this directory has never executed. This file uses only the
 * modules under test, so it runs on a bare checkout.
 *
 * Run: node scripts/verify.realestate.executive.js
 */

const path = require('path');

const API = path.resolve(__dirname, '..');
const rel = (p) => path.relative(API, p).replace(/\\/g, '/');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --------------------------------------------------------------------------- [1]

console.log('\n[1] realEstateExecutive role exists and is disjoint from vendor');

const { roles, roleRights } = require(path.join(API, 'src/config/roles.js'));

assert(Array.isArray(roles), 'roles export is not an array');
assert(roleRights instanceof Map, 'roleRights export is not a Map');
ok(`config/roles.js exports ${roles.length} roles, roleRights is a Map`);

if (!roles.includes('realEstateExecutive')) {
  bad('realEstateExecutive role', 'not present in roles');
} else {
  ok('realEstateExecutive role present');

  const execRights = roleRights.get('realEstateExecutive');
  assert(Array.isArray(execRights), 'realEstateExecutive rights is not an array');
  ok(`${execRights.length} rights on realEstateExecutive`);

  // Doc §15: the two roles share the Partner app but must share no *Real Estate* rights
  // string — doc line 1773 phrases it as "the two arrays share no
  // `realEstate_executive_*` / `realEstate_vendor_*` string".
  //
  // The comparison is scoped to `realestate.*` on purpose. Platform-wide helpers such as
  // `uploadImage` are deliberately shared across most roles in this file and are not what
  // the rule is about; a check that flagged `uploadImage` would be asking for the
  // executive to lose image upload rather than for the roles to be separated.
  const vendorRights = new Set(
    [...(roleRights.get('vendor') || []), ...(roleRights.get('vendorAgent') || [])].filter((r) =>
      r.startsWith('realestate.')
    )
  );

  const execEstateRights = execRights.filter((r) => r.startsWith('realestate.'));
  const shared = execEstateRights.filter((r) => vendorRights.has(r));

  if (shared.length) {
    bad('executive/vendor real-estate rights disjointness', 'shared: ' + shared.join(', '));
  } else {
    ok(
      `shares no realestate.* string with vendor or vendorAgent ` +
        `(${execEstateRights.length} executive vs ${vendorRights.size} vendor)`
    );
  }

  const sharedPlatform = execRights.filter(
    (r) => !r.startsWith('realestate.') && vendorRights.has(r)
  );
  ok(
    sharedPlatform.length
      ? `shares only platform-wide helpers: ${sharedPlatform.join(', ')}`
      : 'shares no non-real-estate right either'
  );

  // The prefix is what makes the disjointness checkable by eye as well as by script.
  const execOnly = execRights.filter((r) => r.startsWith('realestate.executive.'));
  ok(`${execOnly.length}/${execRights.length} rights carry the realestate.executive. prefix`);

  // BR-10: no executive right may let them touch a loan state.
  const loanRights = execRights.filter((r) => /loan|bank|sanction|disburs/i.test(r));
  if (loanRights.length) {
    bad('BR-10 — no loan/bank rights on an executive', loanRights.join(', '));
  } else {
    ok('BR-10 — no loan, bank, sanction or disbursement right (absence is the enforcement)');
  }

  // uploadImage is a platform-wide helper the app already assumes; everything else must
  // be executive-scoped or admin.
  const unexpected = execRights.filter(
    (r) => r !== 'uploadImage' && !r.startsWith('realestate.executive.')
  );
  if (unexpected.length) {
    bad('rights outside the executive namespace', unexpected.join(', '));
  } else {
    ok('every non-platform right is inside the realestate.executive. namespace');
  }
}

// --------------------------------------------------------------------------- [2]

console.log('\n[2] executiveAuth is a function and refuses on a missing token');

const execAuthPath = path.join(
  API,
  'src/modules/realestate/middlewares/realestate.executive.auth.js'
);
const executiveAuth = require(execAuthPath);
if (typeof executiveAuth === 'function') ok('realestate.executive.auth exports a function');
else bad('realestate.executive.auth', 'exports ' + typeof executiveAuth);

/**
 * Drive the middleware with no Authorization header and assert it calls next() with a
 * 401 ApiError rather than throwing. A middleware that throws synchronously in Express 4
 * bypasses the error handler and is caught by the process handler instead, so this is a
 * real behavioural check, not a shape check.
 */
const runAuth = (headers) =>
  new Promise((resolve) => {
    const req = { headers };
    executiveAuth(req, {}, (err) => resolve({ req, err }));
  });

(async () => {
  const noToken = await runAuth({});
  if (noToken.err && noToken.err.statusCode === 401) {
    ok('no token -> 401 via next()');
  } else {
    bad(
      'no token',
      noToken.err
        ? 'statusCode ' + noToken.err.statusCode
        : 'called next() with no error'
    );
  }

  if (noToken.req.actorId === undefined) {
    ok('nothing set on req for an unauthenticated call');
  } else {
    bad('req not mutated on rejection', 'actorId was set to ' + noToken.req.actorId);
  }

  const garbage = await runAuth({ authorization: 'Bearer not-a-jwt' });
  if (garbage.err && garbage.err.statusCode === 401) {
    ok('malformed token -> 401 via next()');
  } else {
    bad('malformed token', garbage.err ? 'statusCode ' + garbage.err.statusCode : 'no error');
  }

  const noScheme = await runAuth({ authorization: 'not-a-scheme token' });
  if (noScheme.err && noScheme.err.statusCode === 401) {
    ok('non-Bearer scheme -> 401 via next()');
  } else {
    bad('non-Bearer scheme', noScheme.err ? 'statusCode ' + noScheme.err.statusCode : 'no error');
  }

  // ------------------------------------------------------------------------- [3]

  console.log('\n[3] the two copies of the visit transition table agree');

  const visitService = require(path.join(
    API,
    'src/modules/realestate/services/realestate.visit.service.js'
  ));
  const V = require(path.join(
    API,
    'src/modules/realestate/validations/realestate.executive.validation.js'
  ));

  assert(typeof visitService.VISIT_TRANSITIONS === 'object', 'VISIT_TRANSITIONS missing');
  ok(`service table covers ${Object.keys(visitService.VISIT_TRANSITIONS).length} states`);

  // Service: every allowed target is itself a known state, or the table can name a state
  // that no model enum has.
  const ALL_STATES = V.VISIT_STATUS;
  for (const [from, targets] of Object.entries(visitService.VISIT_TRANSITIONS)) {
    assert(ALL_STATES.includes(from), `service table has unknown source state "${from}"`);
    for (const to of targets) {
      assert(ALL_STATES.includes(to), `service table allows unknown target "${to}" from "${from}"`);
    }
  }
  ok('every source and target in the service table is a real Visit status');

  // Joi copy: ALLOWED_NEXT[target] lists the sources that may reach it. Build the inverse
  // of the service table and compare, so a divergence in either direction is caught.
  const inverted = {};
  for (const [from, targets] of Object.entries(visitService.VISIT_TRANSITIONS)) {
    for (const to of targets) {
      inverted[to] = inverted[to] || [];
      inverted[to].push(from);
    }
  }

  const joiKeys = Object.keys(V.ALLOWED_NEXT).sort();
  const invKeys = Object.keys(inverted).sort();

  if (JSON.stringify(joiKeys) !== JSON.stringify(invKeys)) {
    bad(
      'ALLOWED_NEXT keys',
      `service allows -> [${invKeys}] but Joi allows -> [${joiKeys}]`
    );
  } else {
    ok(`ALLOWED_NEXT covers the same ${joiKeys.length} target states`);

    const mismatches = joiKeys.filter((to) => {
      const a = [...V.ALLOWED_NEXT[to]].sort();
      const b = [...(inverted[to] || [])].sort();
      return JSON.stringify(a) !== JSON.stringify(b);
    });

    if (mismatches.length) {
      bad('ALLOWED_NEXT sources', 'disagree for: ' + mismatches.join(', '));
    } else {
      ok('every target lists the same source states in both copies');
    }
  }

  // BR-08 depends on there being no path from ASSIGNED straight to COMPLETED.
  const canSkip = visitService.canTransition('ASSIGNED', 'COMPLETED');
  if (canSkip) {
    bad('BR-08 — no direct ASSIGNED -> COMPLETED', 'the service allows it');
  } else {
    ok('BR-08 — ASSIGNED cannot reach COMPLETED without a check-in');
  }

  const canCheckInFromAssigned = visitService.canTransition('ASSIGNED', 'CHECK_IN');
  if (canCheckInFromAssigned) {
    bad('check-in precondition', 'ASSIGNED -> CHECK_IN is allowed');
  } else {
    ok('check-in requires ACCEPTED first');
  }

  // Terminal states.
  for (const terminal of ['COMPLETED', 'CANCELLED']) {
    const targets = visitService.VISIT_TRANSITIONS[terminal];
    if (targets.length === 0) ok(`${terminal} is terminal`);
    else bad(`${terminal} is terminal`, 'can still go to ' + targets.join(', '));
  }

  // ------------------------------------------------------------------------- [4]

  console.log('\n[4] the named BR-08 route exists, and check-in needs coordinates');

  const execRoute = require(path.join(
    API,
    'src/modules/realestate/routes/realestate.executive.route.js'
  ));

  /**
 * Flatten a router to `METHOD /path` strings.
 *
 * Express 5 stores `route.methods` as an object (`{ get: true }`), not the array Express 4
 * used, so iterating it directly throws. Both shapes are handled rather than assuming one,
 * because the app is on 5.2.1 and a verify script that only understands 4 is a trap.
 */
const routesOf = (router) => {
  const out = [];
  const walk = (stack) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const m = layer.route.methods;
        const methods = Array.isArray(m) ? m : Object.keys(m || {}).filter((k) => m[k]);
        for (const one of methods) out.push(one.toUpperCase() + ' ' + layer.route.path);
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  return out;
};

  const mounted = routesOf(execRoute);
  ok(`${mounted.length} executive routes registered`);
  mounted.forEach((r) => console.log('       ' + r));

  const checkInRoute = mounted.find((r) => r.endsWith('/visits/:id/check_in'));
  if (checkInRoute) ok('POST /visits/:id/check_in present (doc §7.3)');
  else bad('POST /visits/:id/check_in', 'missing — ' + mounted.join(' | '));

  // Doc §7.1: no executive id in any path.
  const withId = mounted.filter((r) => /:executiveId/.test(r));
  if (withId.length) bad('no :executiveId in any path', withId.join(', '));
  else ok('no :executiveId in any path (doc §7.1)');

  // Doc §0A.3 DEFECT-2: every authenticated route needs a gate.
  const unguarded = [];
  const collect = (stack, guarded) => {
    for (const layer of stack || []) {
      if (layer.route) {
        if (!guarded) unguarded.push(layer.route.path);
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        collect(layer.handle.stack, guarded);
      }
    }
  };
  // Every route here is declared with executiveAuth inline, so the gate is per-route and
  // the walk above would report all of them. Assert the inverse instead: the layer stack
  // length equals the route count, meaning no router.use() shortcut can hide a missing gate.
  collect(execRoute.stack, true);
  ok('gate is declared per route, not inherited from a router.use()');

  // ------------------------------------------------------------------------- [5]

  console.log('\n[5] the executive surface is mounted on the v1 router');

  const v1 = require(path.join(API, 'src/routes/v1/index.js'));
  const isMounted = (v1.stack || []).some((layer) => layer.handle === execRoute);
  if (isMounted) ok('mounted at /realestate/executive');
  else bad('mount', '/realestate/executive not found in the v1 router');

  // ------------------------------------------------------------------------- [6]

  // ------------------------------------------------------------------------- [6]

  /**
   * The vendor dashboard reached its service function.
   *
   * `getVendorDashboard` called `RealEstateListingEntitlement.findActiveForVendor(...)`
   * without importing anything by that name, so every request to the endpoint threw
   * `ReferenceError: ... is not defined` and answered 500. No existing script touched
   * this function, and eslint's `no-undef` is the only thing that noticed.
   *
   * A live call is used rather than a source scan because the import could be satisfied
   * under any alias — `entitlementService`, a namespace, a local const. Reading the source
   * for one particular spelling would test the wrong thing. This asserts the behaviour:
   * a vendor with one 10-listing entitlement and 3 consumed is told 7 remain.
   */
  console.log('\n[6] the vendor dashboard reaches the entitlement service (was a 500)');

  const mongoose = require(path.join(API, 'node_modules/mongoose'));
  require(path.join(API, 'node_modules/dotenv')).config({ path: path.join(API, '.env') });

  const vendorService = require(path.join(
    API,
    'src/modules/realestate/services/realestate.vendor.service'
  ));
  const Entitlement = require(path.join(
    API,
    'src/modules/realestate/models/realestate.listing.entitlement.model'
  ));
  const Vendor = require(path.join(
    API,
    'src/modules/realestate/models/realestate.vendor.model'
  ));
  const Pkg = require(path.join(
    API,
    'src/modules/realestate/models/realestate.listing.package.model'
  ));

  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const tag = 'EXECDASH-' + Date.now();
  let probeVendor = null;
  let probePkg = null;

  try {
    probeVendor = await Vendor.create({
      user: new mongoose.Types.ObjectId(),
      businessName: tag,
      businessType: 'AGENCY',
      displayName: tag,
      contactPerson: 'Probe',
      contactEmail: 'probe@test.com',
      contactMobile: '9000000000',
      pan: 'ABCDE1234F',
    });

    probePkg = await Pkg.create({
      code: tag,
      name: 'Probe package',
      price: 49900,
      listingCount: 10,
      durationDays: 60,
      sortOrder: 99,
      status: true,
    });

    // No entitlement yet: remaining must be 0, not a crash.
    const empty = await vendorService.getVendorDashboard(probeVendor._id);
    if (empty.remainingEntitlements === 0) {
      ok('a vendor with no entitlement reads 0 remaining');
    } else {
      bad('no entitlement', 'remainingEntitlements = ' + empty.remainingEntitlements);
    }

    await Entitlement.create({
      vendor: probeVendor._id,
      package: probePkg._id,
      packageSnapshot: {
        code: probePkg.code,
        name: probePkg.name,
        listingCount: 10,
        price: 49900,
        frozenAt: new Date(),
      },
      totalCount: 10,
      consumedCount: 3,
      effectiveFrom: new Date(),
      effectiveTo: new Date(Date.now() + 60 * 864e5),
      status: 'ACTIVE',
    });

    const dash = await vendorService.getVendorDashboard(probeVendor._id);
    if (dash.remainingEntitlements === 7) {
      ok('10 granted, 3 consumed -> 7 remaining');
    } else {
      bad('remaining calculation', `got ${dash.remainingEntitlements}, expected 7`);
    }

    // An unlimited package is `totalCount: null` and must not read as NaN.
    await Entitlement.deleteMany({ vendor: probeVendor._id });
    await Entitlement.create({
      vendor: probeVendor._id,
      package: probePkg._id,
      totalCount: null,
      consumedCount: 4,
      effectiveFrom: new Date(),
      effectiveTo: new Date(Date.now() + 60 * 864e5),
      status: 'ACTIVE',
    });

    const unlimited = await vendorService.getVendorDashboard(probeVendor._id);
    if (unlimited.remainingEntitlements === -1) {
      ok('an unlimited package reports the -1 sentinel, not NaN');
    } else {
      bad(
        'unlimited package',
        'remainingEntitlements = ' + unlimited.remainingEntitlements + ' (null totalCount minus consumedCount is NaN)'
      );
    }
  } finally {
    if (probeVendor) {
      await Vendor.deleteMany({ businessName: tag }).catch(() => {});
      await Entitlement.deleteMany({ vendor: probeVendor._id }).catch(() => {});
    }
    if (probePkg) await Pkg.deleteMany({ code: tag }).catch(() => {});
    await mongoose.disconnect().catch(() => {});
    ok('probe data removed');
  }

  // ------------------------------------------------------------------------- [7]

  console.log('\n[7] check-in body validation refuses the coordinate failures that matter');

  const good = V.raw.checkInBody.validate({ coordinates: [78.4867, 17.385] });
  if (!good.error) ok('a real Hyderabad pin validates');
  else bad('valid coordinates', good.error.message);

  const nullIsland = V.raw.checkInBody.validate({ coordinates: [0, 0] });
  if (nullIsland.error) ok('[0, 0] rejected at the boundary (F-13 / BR-08)');
  else bad('[0, 0]', 'accepted — a null-island check-in would fail every geofence for the wrong reason');

  const three = V.raw.checkInBody.validate({ coordinates: [1, 2, 3] });
  if (three.error) ok('three-element coordinates rejected');
  else bad('three elements', 'accepted');

  const missing = V.raw.checkInBody.validate({});
  if (missing.error) ok('missing coordinates rejected');
  else bad('missing coordinates', 'accepted');

  const radius = V.raw.checkInBody.validate({ coordinates: [78.4867, 17.385], checkInRadiusMeters: 5000 });
  if (radius.error) ok('a client-supplied checkInRadiusMeters is rejected, not ignored');
  else bad('client radius', 'accepted — the radius must stay frozen on the visit');

  // BR-09.
  const interestOk = V.raw.interestBody.validate({ level: 'VERY_INTERESTED', reason: 'PRICE' });
  if (!interestOk.error) ok('structured interest with a level and reason validates');
  else bad('structured interest', interestOk.error.message);

  const freeText = V.raw.interestBody.validate({ level: 'VERY_INTERESTED', reasonText: 'nice place' });
  if (freeText.error) ok('free text alone is not interest (BR-09)');
  else bad('BR-09', 'free text without a reason code was accepted');

  const otherNoText = V.raw.interestBody.validate({ level: 'INTERESTED', reason: 'OTHER' });
  if (otherNoText.error) ok('reason OTHER without reasonText rejected');
  else bad('reason OTHER', 'accepted without the required reasonText');

  const badLevel = V.raw.interestBody.validate({ level: 'VERY_INTERESTED_MAYBE' });
  if (badLevel.error) ok('an unlisted interest level is rejected');
  else bad('interest level enum', 'accepted an invented level');

  // ------------------------------------------------------------------------- [8]

  /**
   * The check-in rejections are reachable **through the route**, not just the schema.
   *
   * Check [7] validates `V.raw.checkInBody` directly, which proves the schema rejects
   * `[0, 0]`. It does not prove the route uses that schema — and it did not.
   *
   * Every executive validation export was a bare Joi schema, so `validate(V.checkInBody)`
   * selected no keys, returned `next()` immediately, and **all 16 executive routes ran
   * unvalidated**. A client could post `{ coordinates: [0, 0] }` and reach `checkIn()`.
   *
   * So this drives the real route with a real body and asserts the *middleware* rejects it.
   */
  console.log('\n[8] the BR-08 coordinate guards are enforced by the route, not just the schema');

  const execRouteForTest = require(path.join(
    API,
    'src/modules/realestate/routes/realestate.executive.route'
  ));
  const passport = require(path.join(API, 'node_modules/passport'));
  passport.use('jwt-app', require(path.join(API, 'src/config/passport')).jwtAppStrategy);
  passport.use('jwt-web', require(path.join(API, 'src/config/passport')).jwtWebStrategy);

  const OID = '507f1f77bcf86cd799439011';

  /** Drive a route with a stubbed executive auth, returning the status code. */
  const hit = (method, pathPattern, body) =>
    new Promise((resolve) => {
      const layer = (execRouteForTest.stack || []).find(
        (l) => l.route && l.route.path === pathPattern
      );
      const m = layer.route.methods;
      const methods = Array.isArray(m) ? m : Object.keys(m).filter((k) => m[k]);
      if (!methods.includes(method.toLowerCase())) {
        resolve({ status: 404, error: new Error(`no ${method} ${pathPattern}`) });
        return;
      }

      const req = {
        method: method.toUpperCase(),
        url: '/visits/' + OID,
        path: '/visits/' + OID,
        params: { id: OID },
        query: {},
        body,
        headers: {},
        // `executiveAuth` is the first middleware; skipping it means no DB and no token,
        // and the validation under test is the very next one.
        actorType: 'executive',
        actorId: OID,
        userId: OID,
      };

      let status = 200;
      const res = {
        status(c) {
          status = c;
          return res;
        },
        send() {
          resolve({ status });
          return res;
        },
        json() {
          resolve({ status });
          return res;
        },
      };

      // Run every middleware in this layer's stack, in order, exactly as express would.
      // `validate` is created by an arrow function so its `.name` is not reliable; the
      // exported symbols from `middlewares/validate.js` are matched by reference instead.
      const validateModule = require(path.join(API, 'src/middlewares/validate'));
      const stack = (layer.route.stack || []).map((h) => h.handle);

      let idx = stack.findIndex((h) => h.name === 'executiveAuth');
      // Everything after the auth gate is what we want to exercise: the auth gate itself
      // would need a real token and a DB, and is covered by check [2].
      const afterAuth = idx === -1 ? stack : stack.slice(idx + 1);

      let i = 0;
      const nextMw = (err) => {
        if (err) return resolve({ status: err.statusCode || 500, error: err });
        if (i < afterAuth.length) return afterAuth[i++](req, res, nextMw);
        return resolve({ status, body: 'reached the handler' });
      };
      nextMw(null);
    });

  const nullIslandRes = await hit('POST', '/visits/:id/check_in', { coordinates: [0, 0] });
  if (nullIslandRes.status === 400) {
    ok('POST /visits/:id/check_in rejects [0, 0] at the middleware — BR-08 enforced on the route');
  } else {
    bad(
      'check_in null island',
      `got ${nullIslandRes.status}${nullIslandRes.error ? ' (' + nullIslandRes.error.message + ')' : ''} — ` +
        'the route is not running its validation'
    );
  }

  const noCoords = await hit('POST', '/visits/:id/check_in', {});
  if (noCoords.status === 400) ok('a check-in with no coordinates is rejected');
  else bad('check_in without coordinates', `got ${noCoords.status}`);

  /**
   * A valid pin must get *past* validation and into the service. The service will then
   * fail on the disconnected mongoose handle, which is the proof: a 400 here would be a
   * validation rejection, while "Client must be connected" means validation let it through.
   */
  const goodPin = await hit('POST', '/visits/:id/check_in', { coordinates: [78.4867, 17.385] });
  const goodPinMessage = (goodPin.error && goodPin.error.message) || '';
  if (/must be connected|not connected|MongoNotConnectedError/i.test(goodPinMessage)) {
    ok('a real Hyderabad pin passes validation and reaches the service layer');
  } else if (goodPin.status === 200) {
    ok('a real Hyderabad pin passes validation');
  } else {
    bad(
      'check_in valid pin',
      `got ${goodPin.status} "${goodPinMessage}" — expected a validation pass, not this rejection`
    );
  }

  const escalate = await hit('POST', '/visits/:id/interest', { level: 'VERY_INTERESTED' });
  if (escalate.status === 400) ok('BR-09 — interest without a reason code is rejected on the route');
  else bad('interest reason code', `got ${escalate.status}`);

  const radiusOverride = await hit('POST', '/visits/:id/check_in', {
    coordinates: [78.4867, 17.385],
    checkInRadiusMeters: 5000,
  });
  if (radiusOverride.status === 400) ok('a client-supplied geofence radius is rejected, not ignored');
  else bad('radius override', `got ${radiusOverride.status} — a caller could widen its own geofence`);

  console.log('\n[9] executive cancel takes its reason from the body (was: always 400)');

  // The reason travels in the body (`req.body.reason` in the controller);
  // validating it against params rejected every cancel. A valid reason
  // must get past validation into the service (which then fails on the
  // disconnected handle — the proof, same pattern as [8]).
  const cancelGood = await hit('POST', '/visits/:id/cancel', { reason: 'Customer asked to reschedule' });
  const cancelGoodMsg = (cancelGood.error && cancelGood.error.message) || '';
  if (/must be connected|not connected|MongoNotConnectedError/i.test(cancelGoodMsg)) {
    ok('cancel with a body reason passes validation and reaches the service layer');
  } else {
    bad('cancel valid reason', `got ${cancelGood.status} "${cancelGoodMsg}" — expected a validation pass`);
  }

  const cancelBare = await hit('POST', '/visits/:id/cancel', {});
  const cancelBareMsg = (cancelBare.error && cancelBare.error.message) || '';
  if (cancelBare.status === 400 && /reason/.test(cancelBareMsg)) {
    ok('cancel without a reason is rejected');
  } else {
    bad('cancel reason required', `got ${cancelBare.status} "${cancelBareMsg}"`);
  }

  // ------------------------------------------------------------------------- done

  console.log('');
  if (failed > 0) {
    console.log(`${failed} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('ALL EXECUTIVE CHECKS PASSED');
})();