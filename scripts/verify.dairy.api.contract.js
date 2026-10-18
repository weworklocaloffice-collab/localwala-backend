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
 * Cross-checks the Flutter app's endpoint constants against the routes the API
 * actually registers, and audits each route against its own validation.
 *
 * Why this exists: nothing caught the drift between the two. The Flutter app was
 * written against an intended shape while the routes were built later, and the
 * only symptom a user ever sees is a spinner that never resolves. Real mismatches
 * were found this way.
 *
 * Three things are checked:
 *
 *   1. Every endpoint the app calls has a matching route. A missing one is a
 *      warning, not a failure — several screens are built ahead of their
 *      endpoints, and that backlog is useful to see.
 *   2. **No route can require a parameter it does not declare.** This is the one
 *      that fails the run: a route whose validation demands `:id` while its path
 *      has no `:id` can never be satisfied by any caller, so the endpoint is
 *      dead however hard the app tries.
 *   3. No handler reads a param its route does not declare — `undefined` is a
 *      valid service argument right up until a query matches nothing, so this
 *      class of bug is invisible without a static check.
 *   4. Partner routes that scope themselves by a client-supplied business id.
 *      Reported as a warning, not a failure: see the note at the check.
 *   5. How many registered routes the app never calls, as information.
 *
 * Usage: node scripts/verify.dairy.api.contract.js
 */

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..', '..', 'DairyPartner_app');
const FLUTTER_ENDPOINTS = path.join(
  APP_ROOT,
  'lib',
  'app',
  'core',
  'config',
  'api_endpoints.dart'
);
/**
 * Routers the mobile app talks to, with the path each is mounted at.
 *
 * The dairy router's own paths are relative to its mount point, so comparing them
 * against the app's absolute URLs needs the prefix put back — without it every
 * endpoint looks like a 404 and the check is worthless.
 */
const ROUTERS = [
  { mount: '/v1/dairy', file: 'src/modules/dairy/routes/dairy.route' },
  { mount: '/v1/auth', file: 'src/routes/v1/auth.route' },
  { mount: '/v1/file', file: 'src/routes/v1/file.route' },
  // The public router serves the registration form's city and locality
  // dropdowns. It is shared with the restaurant vertical, which is why the
  // dairy app calls into it rather than duplicating the lookups.
  { mount: '/v1/public', file: 'src/routes/v1/public.route' },
];

/**
 * App endpoints with no server route **on purpose** — screens built ahead of
 * their backend, recorded in §0A.1 of the implementation plan.
 *
 * This list is the point of the exercise. Without it, "deliberately not built"
 * and "spelled wrong" both print the same warning, so a typo is indistinguishable
 * from a backlog item and the suite passes either way. Every entry here is a
 * deliberate decision; removing one turns it into a failure.
 */
const EXPECTED_PENDING = [
    // The app declares `partner/inventory/adjust`; the API adjusts stock through
    // `PATCH /partner/skus/:id/stock` (partnerInventoryUpdate). One intent, two
    // paths - the duplicate is retired rather than given a second endpoint.
    'partnerStockAdjust',
    // `partnerEarnings` is live and carries the commission figure; the separate
    // commission endpoint is superseded rather than awaiting a build.
    'partnerCommission',
    // Shared account surfaces. Notifications are live; live support chat is not
    // - the existing support models are restaurant-shaped and there is no admin
    // dairy surface to answer from, so it is left pending rather than half-built.
    'supportChat',
  ];

const DAIRY_ROUTE_FILE = path.join(
  __dirname,
  '..',
  'src',
  'modules',
  'dairy',
  'routes',
  'dairy.route.js'
);

/**
 * Validation modules to audit, keyed by the name the route file imports them
 * under. Every route's `validate(...)` argument is resolved through these.
 */
const VALIDATION_MODULES = [
  { alias: 'DairyProfileValidation', file: 'src/modules/dairy/validations/dairy.profile.validation' },
  { alias: 'DairyRegistrationValidation', file: 'src/modules/dairy/validations/dairy.registration.validation' },
  { alias: 'DairyCanValidation', file: 'src/modules/dairy/validations/dairy.can.validation' },
  { alias: 'DairyContainerValidation', file: 'src/modules/dairy/validations/dairy.container.validation' },
  { alias: 'DairyCatalogValidation', file: 'src/modules/dairy/validations/dairy.catalog.validation' },
  { alias: 'DairySubscriptionValidation', file: 'src/modules/dairy/validations/dairy.subscription.validation' },
  { alias: 'DairyOrderValidation', file: 'src/modules/dairy/validations/dairy.order.validation' },
  { alias: 'DairyProcurementValidation', file: 'src/modules/dairy/validations/dairy.procurement.validation' },
  { alias: 'DairySettlementValidation', file: 'src/modules/dairy/validations/dairy.settlement.validation' },
  { alias: 'DeliveryRunValidation', file: 'src/kernel/delivery/validations/delivery.run.validation' },
  { alias: 'AuthValidation', file: 'src/validations/auth.validation' },
];

const normalise = (p) => {
  const trimmed = String(p).trim().replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

/**
 * Compares an app endpoint against one API route, segment by segment.
 *
 * The earlier version built a regex where every `:param` became `[^/]+`. That
 * matched `{id}` against `:id` — but it would just as happily have matched
 * `{rung}`, and it could not tell "the app forgot the placeholder" from "the app
 * invented one".
 *
 * A Dart endpoint writes a path parameter as `{name}`; Express declares it as
 * `:name`. The comparison models what Express actually matches at runtime:
 *
 *   - segment counts must agree — this is what catches a forgotten `:id`
 *   - two literals must be equal
 *   - a placeholder against a param always matches, whatever each is named
 *
 * Two deliberate leniencies, both because Express genuinely accepts them:
 *
 *   - **A literal where the API has `:param`.** `/orders/confirmed/:order`
 *     matches `/orders/:status/:order`. The app pins a value the API would
 *     otherwise take from the path — used for accept / reject / ready, which are
 *     one route with three fixed statuses.
 *   - **Placeholder names are not compared.** At runtime `{rung}` and `:id` are
 *     the same thing, so a name difference is a naming preference rather than a
 *     404. Enforcing it produced false failures on correct endpoints.
 *
 * @returns {{ok: boolean, reason: string}}
 */
const compareEndpoint = (appPath, apiPath) => {
  const app = normalise(appPath).split('/');
  const api = normalise(apiPath).split('/');

  if (app.length !== api.length) {
    return {
      ok: false,
      reason: `${app.length} segments vs ${api.length} (${apiPath})`,
    };
  }

  for (let i = 0; i < app.length; i += 1) {
    const a = app[i];
    const b = api[i];
    const appIsParam = a.startsWith('{') && a.endsWith('}');
    const apiIsParam = b.startsWith(':');

    if (appIsParam && apiIsParam) {
      // Position is all that matters at runtime.
      continue;
    }
    if (!appIsParam && apiIsParam) {
      // A pinned value where the API takes one from the path. Fine.
      continue;
    }
    if (appIsParam && !apiIsParam) {
      // A dynamic segment where the API expects a fixed word. This one really
      // does 404: `/products/{id}` cannot reach `/products/list`.
      return {
        ok: false,
        reason: `app sends {${a.slice(1, -1)}} where the API has the fixed segment "${b}"`,
      };
    }
    if (a !== b) {
      return { ok: false, reason: `"${a}" vs "${b}"` };
    }
  }

  return { ok: true, reason: '' };
};

/**
 * True when one path is a segment-wise prefix of the other — the signature of
 * "the same feature at a slightly different shape", which is a typo rather than
 * an unbuilt endpoint.
 */
const isPrefixOf = (shorter, longer) => {
  const a = normalise(shorter).split('/');
  const b = normalise(longer).split('/');
  if (a.length >= b.length) return false;
  return a.every((segment, i) => {
    if (segment.startsWith('{') || b[i].startsWith(':')) return true;
    return segment === b[i];
  });
};

const readFlutterEndpoints = () => {
  if (!fs.existsSync(FLUTTER_ENDPOINTS)) {
    throw new Error(`Flutter endpoint file not found at ${FLUTTER_ENDPOINTS}`);
  }
  const source = fs.readFileSync(FLUTTER_ENDPOINTS, 'utf8');
  const endpoints = [];
  const re = /static const String (\w+)\s*=\s*'([^']+)'/g;
  let match = re.exec(source);
  while (match !== null) {
    endpoints.push({ name: match[1], path: normalise(match[2]) });
    match = re.exec(source);
  }
  return endpoints;
};

const readRegisteredRoutes = () => {
  const routes = [];
  ROUTERS.forEach(({ mount, file }) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const router = require(path.join(__dirname, '..', file));
    router.stack.forEach((layer) => {
      if (!layer.route) return;
      // Express exposes `methods` as a `{ get: true }` map on some versions and a
      // plain array on others, so both shapes are handled rather than assumed.
      const raw = layer.route.methods;
      const methods = Array.isArray(raw) ? raw : Object.keys(raw || {});
      methods.forEach((method) => {
        routes.push({
          method: String(method).toUpperCase(),
          path: normalise(mount + layer.route.path),
        });
      });
    });
  });
  return routes;
};

/**
 * Maps `Alias.exportName` to the exported validation object, by requiring the
 * module and reading the property.
 */
/**
 * Resolves each validation alias to its module's exports.
 *
 * Resolution uses `require.resolve`, not `fs.existsSync`. `existsSync` does not
 * try extensions, so every extensionless path here reported "missing" and each
 * validation was quietly skipped — the audit then passed while checking nothing.
 * An alias that genuinely cannot be resolved is now returned as a problem rather
 * than dropped, so a typo in this file can never hide a broken route again.
 *
 * @returns {{modules: Object, unresolved: string[]}}
 */
const resolveValidations = () => {
  const modules = {};
  const unresolved = [];

  VALIDATION_MODULES.forEach(({ alias, file }) => {
    const base = path.join(__dirname, '..', file);
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require, import/no-unresolved
      modules[alias] = require(require.resolve(base));
    } catch (error) {
      unresolved.push(`${alias} (${file})`);
    }
  });

  return { modules, unresolved };
};

/** Required path params declared by a Joi validation object. */
const requiredParams = (schema) => {
  if (!schema || !schema.params) return [];
  const described = schema.params.describe();
  return Object.keys(described.keys).filter(
    (key) => described.keys[key].flags && described.keys[key].flags.presence === 'required'
  );
};

/**
 * Maps each controller alias used in the route file to its file on disk.
 *
 * Read from the route file's own `require` lines rather than guessed from the
 * alias: `DairyOrderController` resolves to `dairy.order.controller.js`, and
 * deriving that by naming convention silently matched nothing — which made the
 * check below pass without inspecting a single handler.
 */
const readControllerAliases = () => {
  const source = fs.readFileSync(DAIRY_ROUTE_FILE, 'utf8');
  const aliases = {};
  const re = /const (\w+)\s*=\s*require\('([^']*controllers\/[^']+)'\)/g;
  let match = re.exec(source);
  while (match !== null) {
    const absolute = path.resolve(path.dirname(DAIRY_ROUTE_FILE), match[2]);
    aliases[match[1]] = fs.existsSync(absolute) ? absolute : `${absolute}.js`;
    match = re.exec(source);
  }
  return aliases;
};

/**
 * Extracts, per controller file, which handlers read `req.params.id`.
 *
 * A handler that reads a param the route does not declare gets `undefined` at
 * runtime — silently, because `undefined` is a valid value for most service
 * arguments until a query matches nothing. This walks the source so the mistake
 * is caught here rather than by a user staring at an empty cart.
 *
 * @returns {Object<string, Set<string>>} file path -> handler names
 */
const readHandlersUsingParamId = () => {
  const result = {};

  Object.values(readControllerAliases()).forEach((file) => {
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, 'utf8');
    // Each handler is `const name = catchAsync(async (req, res) => { ... });`
    // Indentation before the closing paren varies between handlers in this file,
    // so it is matched loosely. Anchoring the end to a bare `\n});` made a
    // handler indented by two spaces run on into the next one, which reported a
    // clean handler as reading an id it never touches.
    const re = /const (\w+) = catchAsync\(async \(req, res\) => \{([\s\S]*?)\n\s*\}\);/g;
    let match = re.exec(source);
    while (match !== null) {
      if (/req\.params\.id/.test(match[2])) {
        if (!result[file]) result[file] = new Set();
        result[file].add(match[1]);
      }
      match = re.exec(source);
    }
  });

  return result;
};
/**
 * Same shape as readHandlersUsingParamId, but for handlers that pin the outlet
 * from `req.outletId` (the token-derived outlet) rather than a path param.
 *
 * @returns {Object<string, Set<string>>} file path -> handler names
 */
const readHandlersUsingOutletId = () => {
  const result = {};

  Object.values(readControllerAliases()).forEach((file) => {
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, 'utf8');
    // Loose on the closing paren for the same reason as readHandlersUsingParamId.
    const re = /const (\w+) = catchAsync\(async \(req, res\) => \{([\s\S]*?)\n\s*\}\);/g;
    let match = re.exec(source);
    while (match !== null) {
      if (/req\.outletId/.test(match[2])) {
        if (!result[file]) result[file] = new Set();
        result[file].add(match[1]);
      }
      match = re.exec(source);
    }
  });

  return result;
};

/**
 * Pulls `router.<method>('<path>' ... validate(<Alias>.<name>) ... <Handler>)`
 * out of the route source, so each route can be tied to the validation and the
 * controller handler it actually uses.
 */
const readRouteDeclarations = () => {
  const source = fs.readFileSync(DAIRY_ROUTE_FILE, 'utf8');
  const declarations = [];
  // Stops at the first `);`, which is the registration's own closing paren for
  // both styles in use: the multi-line ones and the single-line ones. Matching
  // only `\n);` made a single-line route swallow the *following* registration
  // and inherit its validation, which reported a perfectly good route as broken.
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'([\s\S]*?)\);/g;
  let match = re.exec(source);
  while (match !== null) {
    const [, method, routePath, body] = match;
    const validateMatch = /validate\(\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\)/.exec(body);
    // The handler is the last argument, e.g. `DairyOrderController.getCart`.
    const handlerMatch = /([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*$/.exec(body.trim());
    declarations.push({
      method: method.toUpperCase(),
      path: normalise(routePath),
      validation: validateMatch ? { alias: validateMatch[1], name: validateMatch[2] } : null,
      handler: handlerMatch ? { alias: handlerMatch[1], name: handlerMatch[2] } : null,
    });
    match = re.exec(source);
  }
  return declarations;
};

const run = () => {
  const flutter = readFlutterEndpoints();
  const registered = readRegisteredRoutes();
  const declarations = readRouteDeclarations();
  const { modules: validations, unresolved: unresolvedAliases } = resolveValidations();

  let failures = 0;
  const fail = (label, detail) => {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  const warn = (label, detail) => console.log(`  WARN  ${label}${detail ? ` — ${detail}` : ''}`);
  const pass = (label) => console.log(`  PASS  ${label}`);

  console.log(`\nFlutter endpoints: ${flutter.length}   Registered dairy routes: ${registered.length}`);

// ---- 1. App endpoints exist ----
  console.log('\n1. Endpoints the app calls');
  const matched = new Set();
  let matchedCount = 0;
  const mismatched = [];
  const pending = [];
  const unexpected = [];

  flutter.forEach((endpoint) => {
    // An exact structural match against any route.
    const hit = registered.find(
      (route) => compareEndpoint(endpoint.path, route.path).ok
    );
    if (hit) {
      matched.add(`${hit.method} ${hit.path}`);
      matchedCount += 1;
      return;
    }

    // No exact match. If some route is a near miss, this is a typo in the app's
    // URL — a failure, because the endpoint exists and the app will 404 on it.
    const nearMisses = registered
      .filter((route) => isPrefixOf(endpoint.path, route.path) || isPrefixOf(route.path, endpoint.path))
      .map((route) => {
        const result = compareEndpoint(endpoint.path, route.path);
        return `${route.method} ${route.path} — ${result.reason}`;
      });

    if (nearMisses.length > 0) {
      mismatched.push(`${endpoint.name} -> ${endpoint.path} :: ${nearMisses[0]}`);
      return;
    }

    const record = `${endpoint.name} -> ${endpoint.path}`;
    if (EXPECTED_PENDING.includes(endpoint.name)) {
      pending.push(record);
    } else {
      unexpected.push(record);
    }
  });

  console.log(`  INFO  ${matchedCount}/${flutter.length} app endpoints match a route exactly`);

  if (mismatched.length === 0) {
    pass('every endpoint the app calls exists with the shape it declares');
  } else {
    mismatched.forEach((problem) => fail('endpoint path does not match the API', problem));
  }

  if (unexpected.length === 0) {
    pass('no unlisted endpoint is missing from the API');
  } else {
    unexpected.forEach((problem) => fail(
      'endpoint has no route and is not on the pending list',
      problem
    ));
  }

  console.log(`  INFO  ${pending.length} endpoints deliberately await their backend (EXPECTED_PENDING)`);

  // ---- 2. Routes consistent with their validation ----
  console.log('\n2. Route paths vs their own validation');

  // A validation this script could not load means the routes using it go
  // unchecked. That is a defect in the audit, so it fails the run rather than
  // quietly reducing coverage to zero.
  if (unresolvedAliases.length > 0) {
    unresolvedAliases.forEach((alias) => fail('validation module not loadable', alias));
  }

  let audited = 0;
  const broken = [];
  declarations.forEach((declaration) => {
    if (!declaration.validation) return;
    const moduleExports = validations[declaration.validation.alias];
    if (!moduleExports) return;

    const schema = moduleExports[declaration.validation.name];
    if (!schema) return;

    const params = requiredParams(schema);
    if (params.length === 0) return;
    audited += 1;

    params.forEach((param) => {
      // A param the path does not declare can never arrive, so the route is dead.
      if (!declaration.path.includes(`:${param}`)) {
        broken.push(
          `${declaration.method} ${declaration.path} requires ":${param}" ` +
          `via ${declaration.validation.alias}.${declaration.validation.name}`
        );
      }
    });
  });

  console.log(`  INFO  ${audited} routes carry a path-param requirement to audit`);

  if (broken.length === 0) {
    pass('every route declares the params its validation requires');
  } else {
    broken.forEach((problem) => fail('route can never be reached', problem));
  }

  // ---- 3. Handlers reading a param their route never declares ----
  console.log('\n3. Handlers reading `req.params.id` with no `:id` in the path');
  const paramIdHandlers = readHandlersUsingParamId();
  const controllerAliases = readControllerAliases();
  const undefinedParamId = [];

  declarations.forEach((declaration) => {
    if (!declaration.handler) return;
    if (declaration.path.includes('/:')) return;

    const file = controllerAliases[declaration.handler.alias];
    if (!file) return;

    const handlers = paramIdHandlers[file];
    if (!handlers || !handlers.has(declaration.handler.name)) return;

    undefinedParamId.push(
      `${declaration.method} ${declaration.path} -> ${declaration.handler.alias}.${declaration.handler.name} ` +
      'reads req.params.id, which this path does not declare (it is always undefined)'
    );
  });

  if (undefinedParamId.length === 0) {
    pass('no handler reads an :id its route does not declare');
  } else {
    undefinedParamId.forEach((problem) => fail('handler receives an undefined id', problem));
  }

  // ---- 4. Client-supplied scope on partner routes ----
  //
  // Partner routes no longer take an outlet id. The server derives the outlet
  // from the token (`req.outletId`), so `/:id` on a partner route is legitimate
  // only when it names a *resource* inside that outlet — a product, SKU,
  // provider or payable.
  //
  // Each such route is listed below with the resource it identifies. This is a
  // deliberate allowlist rather than a blanket pass: a new `/:id` partner route
  // fails until it is classified, and the check additionally asserts that the
  // handler still scopes by `req.outletId`. That is what stops an allowlisted
  // route from quietly answering for the whole catalogue.
  console.log('\n4. Partner routes taking a business id from the client');

  const RESOURCE_ID_ROUTES = new Set([
    'PATCH /partner/products/:id',
    'DELETE /partner/products/:id',
    'PATCH /partner/skus/:id',
    'PATCH /partner/skus/:id/stock',
    'GET /partner/providers/:id',
    'GET /partner/payables/:id',
    'POST /partner/payables/:id/adjustments',
    'PATCH /partner/payables/:id/:status',
    'PATCH /partner/payables/:id/void',
    'POST /partner/payables/:id/pay',
  ]);

  const outletIdHandlers = readHandlersUsingOutletId();
  const partnerScoped = [];
  const unclassified = [];
  const notScoped = [];

  declarations.forEach((declaration) => {
    if (!declaration.handler) return;
    if (!declaration.path.startsWith('/partner')) return;
    if (!declaration.path.includes('/:id')) return;

    const file = controllerAliases[declaration.handler.alias];
    if (!file) return;
    const handlers = paramIdHandlers[file];
    if (!handlers || !handlers.has(declaration.handler.name)) return;

    const route = `${declaration.method} ${declaration.path}`;

    if (!RESOURCE_ID_ROUTES.has(route)) {
      unclassified.push(route);
      return;
    }

    // Allowlisted as a resource route — so the outlet must come from the token.
    const scoped = outletIdHandlers[file];
    if (!scoped || !scoped.has(declaration.handler.name)) {
      notScoped.push(
        `${route} -> ${declaration.handler.alias}.${declaration.handler.name} ` +
        'reads req.params.id but never scopes the request to req.outletId'
      );
      return;
    }

    partnerScoped.push(route);
  });

  if (unclassified.length > 0) {
    unclassified.forEach((route) =>
      fail(
        'partner route takes an :id that is not a classified resource id',
        `${route} — add it to RESOURCE_ID_ROUTES in this checker if it really is a resource`
      )
    );
  }

  if (notScoped.length > 0) {
    notScoped.forEach((route) =>
      fail('allowlisted partner route is not scoped to the token outlet', route)
    );
  }

  if (unclassified.length === 0 && notScoped.length === 0) {
    pass(
      `${partnerScoped.length} partner route(s) take a resource :id, ` +
      'and every one still scopes the outlet to req.outletId'
    );
    partnerScoped.forEach((route) => console.log(`          ${route}`));
  }

  // ---- 5. Orphan routes ----
  console.log('\n5. Registered routes the app never calls');
  const orphans = registered.filter((route) => !matched.has(`${route.method} ${route.path}`));
  console.log(`  INFO  ${orphans.length} of ${registered.length} routes are not called by the app`);
  console.log('        Expected: admin, cron and web surfaces are not mobile endpoints.');

  console.log(
    failures === 0
      ? '\nALL API CONTRACT CHECKS PASSED (pending endpoints are recorded in EXPECTED_PENDING)'
      : `\n${failures} CONTRACT CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
};

run();
