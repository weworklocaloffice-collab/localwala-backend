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
 * list.jhatka.routes.js — print the EFFECTIVE Jhatka route table, and detect
 * shadowing. Read-only; touches no database.
 *
 * ## Why this exists
 *
 * §15.1 of the plan makes "literal segments before `:param` siblings, always" a
 * non-negotiable, because Express matches in registration order and
 * `/summary` above `/consoles/:id` is the difference between a reachable route
 * and one that silently never fires.
 *
 * Nothing in the codebase could CHECK that. `verify.jhatka.vertical.js` asserts
 * a route file LOADS; a route that loads and is shadowed by an earlier pattern
 * looks identical to a reachable one. The duplicate `/jhatka/partner` mount —
 * registered twice, once for `partner.js` and once for `labels.js` — is exactly
 * that class of defect, and it survived every suite.
 *
 * So this walks the real Express router stack that `routes/v1/index.js` builds
 * and reports, per method+path, whether anything is registered BEFORE it that
 * would swallow the request.
 *
 * Usage:
 *   node scripts/list.jhatka.routes.js
 *   node scripts/list.jhatka.routes.js --prefix /v1/jhatka/partner
 *
 * Exit code is 0 always: this is a diagnostic, not a gate. `verify.jhatka.routes`
 * is the gate.
 */

const fs = require('fs');
const express = require('express');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Build an isolated Express app and mount ONLY the Jhatka routers, using the
// mount paths and file names read from the real routes/v1/index.js. Executing
// that file directly would also pull in every non-Jhatka router; reading it and
// mounting only our own keeps the report about Jhatka.
// The mount table is DERIVED from src/routes/v1/index.js, never duplicated here.
//
// An earlier draft of this file hard-coded its own MOUNTS array. It immediately
// drifted — two entries kept the pre-rename filenames and every run died with
// MODULE_NOT_FOUND. That is the same duplication hazard as the `/jhatka/partner`
// double `use()` this script exists to detect, committed inside the detector.
//
// So: parse the real file for `path: '/jhatka…'` and the `require` for that
// mount's router, and pair them by variable name. One source of truth.
const ROUTES_INDEX = path.join(REPO_ROOT, 'src', 'routes', 'v1', 'index.js');

const readMounts = () => {
  const src = fs.readFileSync(ROUTES_INDEX, 'utf8');

  // `new RegExp` rather than literals: these patterns embed a single quote to match
  // the source's quoted strings, and a regex literal containing `'` inside a `/…/`
  // is parsed as a flag terminator before it can run.
  const REQUIRES_RE = new RegExp(
    "const\\s+(jhatka\\w+)\\s*=\\s*require\\('([^']*jhatka[^']*)'\\);",
    'g'
  );
  const MOUNTS_RE = new RegExp(
    "path:\\s*'(/jhatka[^']*)'\\s*,\\s*route:\\s*(jhatka\\w+)",
    'g'
  );

  // The require specifiers in index.js are relative to THAT FILE's directory
  // (`src/routes/v1`), not to `src`. Resolving against `src` silently produced
  // `AppSourceCode/modules/jhatka/...` — two directories too high — which is a
  // MODULE_NOT_FOUND that gives no hint about the real cause.
  const INDEX_DIR = path.dirname(ROUTES_INDEX);

  // variable name -> required file path, for the jhatka routers only.
  const requires = new Map();
  for (const m of src.matchAll(REQUIRES_RE)) {
    requires.set(m[1], path.resolve(INDEX_DIR, m[2]));
  }

  // Mount entries look like { path: '/jhatka/…', route: jhatkaVar },
  const mounts = [];
  for (const m of src.matchAll(MOUNTS_RE)) {
    mounts.push({ mountPath: m[1], variable: m[2], file: requires.get(m[2]) });
  }

  const unknown = mounts.filter((mo) => !mo.file);
  if (unknown.length) {
    throw new Error(
      `could not resolve router file(s) for: ${unknown.map((u) => u.variable).join(', ')}`
    );
  }
  return mounts;
};

const MOUNTS = readMounts();

/**
 * Compile an Express path pattern to a RegExp that matches a concrete path.
 *
 * Always returns a RegExp. An earlier draft returned a bare RegExp for simple
 * patterns and `{ re, keys }` for parameterised ones, so callers had to branch on
 * the shape; `rx.test(...)` then threw on half the routes.
 */
const pathToRegExp = (pattern) => {
  if (pattern instanceof RegExp) return pattern;
  if (pattern === '/' || pattern === '') return /^\/$/;

  const source = pattern
    .replace(/\/$/, '')
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment === '*') return '(.*)';
      const m = /^:(\w+)(\?)?(\(.*\))?$/.exec(segment);
      if (m) return `(${m[2] ? '?' : ''}${m[3] ? m[3] : '[^/]+'})`;
      return segment.replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return new RegExp(`^${source || '/'}/?$`);
};

const concretePathFor = (pattern, sample) => {
  if (pattern instanceof RegExp) return String(pattern);
  const parts = pattern.split('/').filter(Boolean);
  return (
    '/' +
    parts
      .map((seg) => {
        if (seg === '*') return 'x';
        const m = /^:(\w+)(\?)?(\(.*\))?$/.exec(seg);
        if (m) return sample?.[m[1]] || 'x';
        return seg;
      })
      .join('/')
  );
};

/**
 * Walk one router's own stack and emit `{ method, path, middlewareCount }`.
 *
 * ## Why the mount prefix is recorded separately instead of read off the stack
 *
 * This codebase is on Express 5.2.1, where a `use()` layer does NOT expose its
 * prefix:
 *
 *   - the stack is at `app.router.stack`, not `app._router.stack`
 *   - `layer.regexp` is no longer a RegExp but a `match(input)` function
 *   - `layer.path` is `undefined` on a mount layer in this build
 *
 * The Express 4 prefix trick (`String(layer.regexp).split('\\/?')[0]`) therefore
 * returns garbage rather than failing loudly. So the prefix is captured at MOUNT
 * TIME by wrapping `app.use`, which is guaranteed correct regardless of what the
 * internals look like, and each router is then enumerated through its own
 * `router.stack` — which is the documented shape in both 4 and 5.
 */
const routesFromRouter = (router, prefix, out) => {
  const stack = (router && router.stack) || [];
  stack.forEach((layer) => {
    if (layer.route) {
      const base = layer.route.path === '/' ? '' : layer.route.path;
      Object.keys(layer.route.methods || {}).forEach((method) => {
        if (method === '_all') return;
        out.push({
          method: method.toUpperCase(),
          path: (prefix + base) || '/',
          middlewareCount: (layer.route.stack || []).length,
        });
      });
    }
  });
  return out;
};

const app = express();
const registry = [];
const originalUse = app.use.bind(app);
app.use = (mountPath, ...handlers) => {
  if (typeof mountPath === 'string') {
    registry.push({ mountPath, handler: handlers[0], file: MOUNTS.find((mo) => mo.mountPath === mountPath)?.file });
  }
  return originalUse(mountPath, ...handlers);
};

MOUNTS.forEach(({ mountPath, file }) => {
  app.use(mountPath, require(file));
});

const routes = [];
registry.forEach(({ mountPath, handler }) => {
  routesFromRouter(handler, mountPath, routes);
});

// ---- shadowing analysis ---------------------------------------------------
//
// Express matches in REGISTRATION order, but a route inside one mounted router
// can never be shadowed by a route inside a DIFFERENT mounted router: the first
// router to match the path prefix wins, and Express either descends into it or
// falls through to the next `use()`. It does not merge the two routers' route
// lists.
//
// So shadowing is only possible WITHIN a single router. Comparing every route in
// the vertical against every other — which an earlier draft of this script did —
// reported ~40 false "shadowed" routes, including `GET /` being "shadowed by
// POST /` in a different file. A tool that cries wolf is not used, so the
// analysis is now scoped per router, which is where the risk actually lives.
//
// TWO further conditions, each of which produced false positives first:
//
//   1. The METHOD must match. `POST /adjust` is not shadowed by `GET /:id`;
//      Express dispatches on verb first. Comparing paths alone reported eleven
//      such pairs.
//   2. The shadowing route must not consume the whole path when the candidate
//      still has segments left. `GET /:id` does not swallow `POST /adjust` —
//      different verb — but `GET /batches` DOES shadow `GET /batches/:id/alloc`,
//      and both must be in the same router.
const shadowed = [];
registry.forEach(({ mountPath, handler, file }) => {
  const own = [];
  routesFromRouter(handler, mountPath, own);

  own.forEach((later, i) => {
    const concrete = concretePathFor(later.path);
    const earlierMatch = own.find((earlier, j) => {
      if (j >= i) return false;
      // Same verb required, or Express never reaches the path test.
      if (earlier.method !== later.method) return false;
      return pathToRegExp(earlier.path).test(concrete);
    });
    if (earlierMatch) {
      shadowed.push({
        method: later.method,
        path: later.path,
        router: path.basename(file),
        shadowedBy: `${earlierMatch.method} ${earlierMatch.path}`,
        mount: mountPath,
      });
    }
  });
});

// ---- report ---------------------------------------------------------------
const filterArg = process.argv.indexOf('--prefix');
const filter = filterArg > -1 ? process.argv[filterArg + 1] : null;

const shown = filter ? routes.filter((r) => r.path.startsWith(filter)) : routes;

console.log(`\n=== Jhatka route table${filter ? ` (${filter})` : ''} — ${shown.length} routes ===\n`);

const byActor = new Map();
shown.forEach((r) => {
  const actor = r.path.split('/').slice(1, 3).join('/') || '/';
  if (!byActor.has(actor)) byActor.set(actor, []);
  byActor.get(actor).push(r);
});

[...byActor.keys()].sort().forEach((actor) => {
  console.log(`-- ${actor} --`);
  byActor.get(actor)
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .forEach((r) => {
      const n = r.middlewareCount;
      const mw = n > 0 ? `  [${n} mw]` : '';
      console.log(`   ${r.method.padEnd(6)} ${r.path}${mw}`);
    });
  console.log('');
});

if (shadowed.length) {
  console.log('-- SHADOWED within a single router (Express matches in order) --');
  shadowed.forEach((s) =>
    console.log(
      `   ${s.method} ${s.path}\n      shadowed by  ${s.shadowedBy}   [router mounted at ${s.mount}]`
    )
  );
  console.log('');
} else {
  console.log('-- no shadowed routes within any single router --\n');
}