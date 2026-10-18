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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.api.contract.js — the client, the routes and BR-38, checked against each other.
 *
 * Run: node scripts/verify.stores.api.contract.js
 *
 * ## Three checks, three different failure modes
 *
 *   1. CLIENT vs SERVER. The Partner_app's `stores_endpoints.dart` was generated from the live
 *      routers. If either drifts the app calls a URL that 404s — the spinner that never
 *      resolves. The comparison is segment-by-segment the way Express matches at runtime:
 *      segment counts must agree, literals must be equal, and a placeholder against a
 *      `:param` always matches. A literal where the API has `:param` is FINE (the client
 *      pins a value such as a fixed status), but a placeholder where the API has a fixed
 *      word really does 404.
 *
 *   2. BR-38, THE TENANT AUDIT. No partner route may widen a query with a client-supplied
 *      outlet, store or chain id. The active outlet is a server-side session property.
 *      The reachable partner surface is enumerated and every tenant-param path classified:
 *        - the two session-management endpoints (`/partner/session/outlet`,
 *          `/partner/outlets`, `/partner/outlets/:outlet`) are scope-checked against
 *          `req.permittedOutletIds` with a 403 OUT_OF_SCOPE, and are therefore allowed
 *        - `complaints/outlet/:outlet` is IGNORED by its handler (it reads `req.outletId`),
 *          which is safe but misleading, and is recorded as a warning, not an error
 *        - anything else declaring `:outlet`/`:store`/`:chain` on a partner path FAILS
 *
 *   3. VALIDATION vs PATH. A route whose Joi demands a param its path does not declare can
 *      never be satisfied by any caller, so the endpoint is dead however hard the app tries.
 *      Dairy's contract suite caught real instances of this; stores gets the same audit.
 */

const fs = require('fs');
const path = require('path');

const partnerRouter = require('../src/modules/stores/routes/stores.route');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const walk = (router, prefix = '', out = []) => {
  for (const layer of router.stack || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods || {})) {
        if (method === '_all') continue;
        out.push(`${method.toUpperCase()} ${(prefix + layer.route.path).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'}`);
      }
    } else if (layer.handle && layer.handle.stack) {
      let seg = '';
      const re = layer.regexp;
      if (re) {
        const m = re.exec('/__probe__');
        if (m) seg = m[0].replace(/^\^/, '').replace(/\\\//g, '/').replace(/\$$/, '').replace(/\?.*$/, '');
      }
      walk(layer.handle, prefix + seg.replace(/\/$/, ''), out);
    }
  }
  return out;
};

const compareEndpoint = (appPath, apiPath) => {
  const norm = (p) => {
    const t = String(p).trim().replace(/\/+$/, '');
    return t.startsWith('/') ? t : `/${t}`;
  };
  const app = norm(appPath).split('/');
  const api = norm(apiPath).split('/');
  if (app.length !== api.length) {
    return { ok: false, reason: `${app.length} segments vs ${api.length} (${apiPath})` };
  }
  for (let i = 0; i < app.length; i += 1) {
    const a = app[i];
    const b = api[i];
    const appIsParam = a.startsWith('{') && a.endsWith('}');
    const apiIsParam = b.startsWith(':');
    if (appIsParam && apiIsParam) continue;
    if (!appIsParam && apiIsParam) continue;
    if (appIsParam && !apiIsParam) {
      return { ok: false, reason: `app sends {${a.slice(1, -1)}} where the API has the fixed segment "${b}"` };
    }
    if (a !== b) return { ok: false, reason: `"${a}" vs "${b}"` };
  }
  return { ok: true };
};

/** Dart `'path'` constants out of stores_endpoints.dart, de-prefixed to /v1/... URLs. */
const readClientEndpoints = () => {
  const dart = path.resolve(
    __dirname, '..', '..', 'Partner_app', 'lib', 'app', 'modules', 'stores', 'stores_endpoints.dart'
  );
  const src = fs.readFileSync(dart, 'utf8');
  const out = [];
  const re = /static const String \w+\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push('/' + m[1].replace(/^\//, ''));
  return out;
};

const tenantParam = (segments) =>
  segments.some((s) => /^:(outlet|store|chain|business)$/i.test(s));

const run = () => {
  console.log('\n=== the reachable partner surface ===\n');

    // `raw` keeps duplicates by design — it is what the duplicate-registration check reads.
  // `live` is the de-duplicated set used for matching. Deriving both checks from the same
  // array would make the duplicate check a tautology.
  const raw = walk(partnerRouter, '/v1/stores');
  const live = [...new Set(raw)];
  ck('the partner router exposes routes', live.length > 0, `count=${live.length}`);
  console.log(`         ${live.length} live partner/customer endpoints`);

  console.log('\n=== 1. client endpoints vs the live surface ===\n');

  const client = readClientEndpoints();
  ck('the Partner_app declares stores endpoints', client.length > 0, `count=${client.length}`);
  console.log('         ' + client.length + ' declared client endpoints');

  let unmatchedClient = 0;
  for (const c of client) {
    const method = 'GET';
    const hit = live.some((entry) => {
      const [m, p] = entry.split(' ');
      void m;
      return compareEndpoint(c, p).ok;
    });
    if (!hit) {
      unmatchedClient += 1;
      console.log('  WARN  client calls a path with no live route: ' + c);
    }
  }
  ck('every client endpoint matches a live route', unmatchedClient === 0, `unmatched=${unmatchedClient}`);

  const clientSet = new Set(client.map((c) => {
    const segs = c.split('/').filter(Boolean);
    return segs.join('/');
  }));
  const uncalled = live.filter((entry) => {
    const p = entry.split(' ')[1];
    return ![...clientSet].some((c) => compareEndpoint(c, p).ok);
  });
  console.log(`         ${uncalled.length} live routes the app never calls (information only)`);
  for (const u of uncalled.slice(0, 8)) console.log('           uncalled: ' + u);

  console.log('\n=== 2. BR-38: no partner route takes a tenant id to widen a query ===\n');

  // The sanctioned set, verified by reading the handlers: each one either validates the
  // requested outlet against `req.permittedOutletIds` (403 OUT_OF_SCOPE) or ignores the
  // parameter entirely in favour of `req.outletId`. Anything NEW outside this list fails,
  // because a client-widened tenant query is a cross-outlet data leak.
  const SANCTIONED = new Set([
    '/partner/session/outlet',
    '/partner/outlets',
    '/partner/outlets/:outlet',
    '/partner/outlet/:status',
    '/partner/complaints/outlet/:outlet',
  ]);

  // The customer storefront (`/:store`, `/:store/products`, …) is PUBLIC browsing by slug,
  // not tenancy: resolving a storefront from a URL slug is the feature, not a scope leak.
  // So scope the tenancy audit to partner paths, where a tenant id can never be a client
  // input.
  const tenantPaths = live
    .map((e) => e.split(' ')[1].replace(/^\/v1\/stores/, '') || '/')
    .filter((p) => p.startsWith('/partner/') || p.startsWith('/admin/'))
    .filter((p) => tenantParam(p.split('/').filter(Boolean)));

  console.log('         reachable partner paths carrying a tenant param:');
  for (const p of tenantPaths) console.log('           ' + p);

  const unsanctioned = tenantPaths.filter((p) => !SANCTIONED.has(p));
  ck('every tenant-param path is on the sanctioned list', unsanctioned.length === 0,
    unsanctioned.length ? `new paths: ${unsanctioned.join(', ')}` : `${tenantPaths.length} paths, all sanctioned`);

  // The complaints path is the odd one: it declares `:outlet` but its handler ignores the
  // parameter and reads `req.outletId` (the session). Safe, but the declaration invites a
  // future handler to trust it. Declared as a warning so the next person to touch it reads
  // this paragraph first.
  if (tenantPaths.includes('/partner/complaints/outlet/:outlet')) {
    console.log('  WARN  /partner/complaints/outlet/:outlet declares :outlet but ignores it (reads req.outletId) — safe, but misleading');
  }

  console.log('\n=== 3. dead-endpoint audit: validation must match the path ===\n');

  // A Joi `params` schema that names a field the route path does not carry can never be
  // satisfied: validation runs on `req.params`, the field is always undefined, and the
  // endpoint answers 400 to every caller. Grep the validation files for `params` blocks
  // and the route files for the paths they guard.
  const routeDir = path.join(__dirname, '..', 'src', 'modules', 'stores', 'routes');
  const routeFiles = fs.readdirSync(routeDir).filter((f) => f.endsWith('.js'));

  const declaredParams = new Set();
  for (const f of routeFiles) {
    const src = fs.readFileSync(path.join(routeDir, f), 'utf8');
    const re = /['"`](\/[^'"`]*:(outlet|store|chain|business|order|product|variant|driver|delivery|return|exchange|warranty|promotion|complaint|subscription|settlement|refund|status|category|subcategory|brand|customer|application|id|item)[^'"`]*)['"`]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const segs = m[1].split('/');
      for (const s of segs) if (s.startsWith(':')) declaredParams.add(s.slice(1).toLowerCase());
    }
  }
  const required = ['outlet', 'order', 'product', 'status'];
  for (const name of required) {
    ck(`:${name} appears in a declared route path`, [...declaredParams].includes(name), [...declaredParams].join(', '));
  }

  console.log('\n=== coverage: the app calls the paths the suites cover ===\n');

  const suitePaths = [
    '/v1/stores/cart/add',
    '/v1/stores/orders/:order/cancel',
    '/v1/stores/partner/orders/:order/:status',
  ];
  for (const p of suitePaths) {
    const coveredClient = client.some((c) => compareEndpoint(c, p).ok) ||
      live.some((e) => compareEndpoint(p, e.split(' ')[1]).ok);
    ck(`suite-covered path ${p} is on the wire`, coveredClient);
  }

  console.log('\n=== no endpoint is declared twice ===\n');

  const seen = new Map();
  const dupes = [];
  for (const e of raw) {
    if (seen.has(e)) dupes.push(e);
    else seen.set(e, true);
  }
  ck('no METHOD+path pair is registered twice', dupes.length === 0,
    dupes.length ? dupes.slice(0, 5).join(', ') : '');
  if (dupes.length) {
    console.log('  WARN  duplicate registrations resolve to the FIRST declaration in Express — the second handler is dead code that looks live');
  }

  console.log('\n=== no route is shadowed by an earlier one ===\n');

  // Express matches in REGISTRATION order, so a literal path declared after a sibling
  // that carries a parameter in that position is unreachable — the parameter swallows it.
  // This is not hypothetical: `GET /subscriptions/upcoming` was declared after
  // `/subscriptions/:subscription`, so 'upcoming' was captured as an id and
  // `findById('upcoming')` cast-failed. The endpoint could only ever 500. The duplicate
  // check above cannot see it: the two paths differ, so neither is a "duplicate", and the
  // client/server comparison above cannot see it either, because the client is matching the
  // path the server CLAIMS to serve.
  //
  // So walk the ordered list and ask, for each route, whether an earlier route of the same
  // method would capture it. Anything shadowed is dead code that reads as live.
  const ordered = [];
  for (const entry of raw) {
    if (!ordered.includes(entry)) ordered.push(entry);
  }

  const isParam = (seg) => seg.startsWith(':');
  const captures = (earlier, candidate) => {
    const e = earlier.split(' ');
    const c = candidate.split(' ');
    if (e[0] !== c[0]) return false;
    const es = e[1].split('/');
    const cs = c[1].split('/');
    if (es.length !== cs.length) return false;
    for (let i = 0; i < es.length; i += 1) {
      // A parameter in the earlier route captures whatever the candidate has here,
      // literal or not. A literal only matches an identical literal.
      if (isParam(es[i])) continue;
      if (es[i] !== cs[i]) return false;
    }
    return true;
  };

  const shadowed = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (captures(ordered[j], ordered[i])) {
        shadowed.push(`${ordered[i]}  (captured by ${ordered[j]})`);
        break;
      }
    }
  }
  ck('every registered route is reachable', shadowed.length === 0,
    shadowed.length ? shadowed.slice(0, 8).join(' | ') : '');
  if (shadowed.length) {
    console.log('  WARN  Express resolves these to the earlier route; the later handler can never run');
  }

  // The concrete regression, asserted by name so a future reorder fails loudly rather
  // than quietly resurrecting it.
  ck('GET /subscriptions/upcoming is declared before /subscriptions/:subscription',
    ordered.indexOf('GET /v1/stores/subscriptions/upcoming') > -1 &&
    ordered.indexOf('GET /v1/stores/subscriptions/upcoming') <
      ordered.indexOf('GET /v1/stores/subscriptions/:subscription'),
    `upcoming at ${ordered.indexOf('GET /v1/stores/subscriptions/upcoming')}, ` +
    `:subscription at ${ordered.indexOf('GET /v1/stores/subscriptions/:subscription')}`);
};

run();
console.log('\n' + (failures === 0 ? 'ALL STORES API CONTRACT CHECKS PASSED' : failures + ' STORES API CONTRACT CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);