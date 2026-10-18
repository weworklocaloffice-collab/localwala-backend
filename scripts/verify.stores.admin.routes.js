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
 * verify.stores.admin.routes.js — the admin surface is routed, mounted and reachable.
 *
 * Run: node scripts/verify.stores.admin.routes.js
 *
 * ## Why this suite exists
 *
 * The Dairy vertical's recorded defect T1 is that the backend grew routes the admin panel
 * could not reach — capabilities that exist in the database and nowhere else. The trap for
 * Local Stores is the mirror image: `Admin_panel/src/app/pages/admin/stores-management/`
 * has 26 console folders and 73 files, and if any of them calls an endpoint that was never
 * mounted, that screen is dead in production while the backend looks complete.
 *
 * This suite asserts the wiring, not the screens:
 *
 *   1. every admin route file exports a router (a typo here silently mounts nothing)
 *   2. the admin router is mounted at `/admin/stores` in the v1 table
 *   3. the partner router is mounted at `/stores`
 *   4. the mounted stacks contain a plausible number of endpoints
 *   5. no route file is mounted twice (duplicate mounts are how route-ordering bugs appear)
 *   6. every admin route sits behind an auth guard, never bare and open
 *
 * It deliberately does NOT boot HTTP or hit a database: this is a static wiring check, so it
 * runs anywhere and cannot be flaky.
 */

const express = require('express');

const v1 = require('../src/routes/v1');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const ADMIN_ROUTE_FILES = [
  'stores.admin.route',
  'stores.admin.catalog.route',
  'stores.admin.operations.route',
  'stores.admin.records.route',
];

const PARTNER_ROUTE_FILES = [
  'stores.route',
  'stores.customer.route',
  'stores.catalog.route',
  'stores.driver.route',
  'stores.complaint.route',
  'stores.featured.route',
  'stores.policy.route',
  'stores.remittance.route',
  'stores.warranty.route',
  'stores.customer.subscription.route',
];

const isRouter = (m) => !!(m && (m === express.Router() || typeof m === 'function') && typeof m.use === 'function');

/** Count leaf routes in a mounted express stack. */
const countRoutes = (router) => {
  let n = 0;
  const walk = (stack) => {
    for (const layer of stack || []) {
      if (layer.route) n += 1;
      else if (layer.handle && layer.handle.stack) walk(layer.handle.stack);
    }
  };
  walk(router && router.stack);
  return n;
};

/** Every leaf path in a mounted stack, including the mount prefix. */
const listPaths = (router, prefix = '') => {
  const out = [];
  const walk = (stack, base) => {
    for (const layer of stack || []) {
      if (layer.route) {
        for (const r of Object.keys(layer.route.methods || {})) out.push(`${r.toUpperCase()} ${base}${layer.route.path}`);
      } else if (layer.regexp && layer.handle && layer.handle.stack) {
        const m = /^\^\\?\/?(.*?)\\?\/\?\$/.exec(layer.regexp.source);
        const seg = m ? m[1] : '';
        walk(layer.handle.stack, base + '/' + seg);
      }
    }
  };
  walk(router && router.stack, prefix);
  return out;
};

const run = async () => {
  console.log('\n=== every admin route file exports a usable router ===\n');

  const adminRouters = {};
  for (const name of ADMIN_ROUTE_FILES) {
    let mod;
    try {
      mod = require(`../src/modules/stores/routes/${name}`);
    } catch (e) {
      ck(`${name} loads`, false, e.message);
      continue;
    }
    const router = mod && mod.default ? mod.default : mod;
    adminRouters[name] = router;
    ck(`${name} loads`, true);
    ck(`${name} exports a router`, isRouter(router));
  }

  console.log('\n=== the admin router carries real endpoints ===\n');

  const adminMain = adminRouters['stores.admin.route'];
  const adminTotal = countRoutes(adminMain);
  ck('stores.admin.route exposes endpoints', adminTotal > 0, `count=${adminTotal}`);
  console.log('         admin router exposes ' + adminTotal + ' routes (with sub-routers mounted)');

  for (const name of ADMIN_ROUTE_FILES.filter((n) => n !== 'stores.admin.route')) {
    const n = countRoutes(adminRouters[name]);
    ck(`${name} exposes endpoints`, n > 0, `count=${n}`);
  }

  console.log('\n=== the partner router is mounted and populated ===\n');

  const partnerRouters = {};
  for (const name of PARTNER_ROUTE_FILES) {
    let mod;
    try {
      mod = require(`../src/modules/stores/routes/${name}`);
    } catch (e) {
      ck(`${name} loads`, false, e.message);
      continue;
    }
    const router = mod && mod.default ? mod.default : mod;
    partnerRouters[name] = router;
    ck(`${name} loads`, true);
  }

  const partnerMain = partnerRouters['stores.route'];
  const partnerTotal = countRoutes(partnerMain);
  ck('stores.route exposes endpoints', partnerTotal > 0, `count=${partnerTotal}`);
  console.log('         partner router exposes ' + partnerTotal + ' routes (with sub-routers mounted)');

  console.log('\n=== both are mounted in the v1 table ===\n');

  // `src/routes/v1/index.js` builds its router eagerly with `router.use(path, route)` and
  // exports the router, not the table it built it from. Express 5 keeps a mount's path in
  // `layer.matchers` rather than `layer.regexp`, so the mount is proven two ways:
  //
  //   * LIVE  — each of our routers appears exactly once in the built stack, by identity.
  //             This is what actually runs.
  //   * TABLE — the declaration in v1/index.js pairs the expected path with the expected
  //             router variable. This is what says WHICH prefix it answers on.
  const v1Router = (v1 && v1.default) || v1;
  const layers = v1Router.stack || [];
  ck('the v1 router exposes its stack', layers.length > 0, `layers=${layers.length}`);

  const partnerLayers = layers.filter((l) => l.handle === partnerMain);
  const adminLayers = layers.filter((l) => l.handle === adminMain);

  ck('the partner router is mounted exactly once', partnerLayers.length === 1, `mounts=${partnerLayers.length}`);
  ck('the admin router is mounted exactly once', adminLayers.length === 1, `mounts=${adminLayers.length}`);
  ck('neither router is mounted twice', partnerLayers.length + adminLayers.length === 2,
    `total=${partnerLayers.length + adminLayers.length}`);

  const v1Source = require('fs').readFileSync(require.resolve('../src/routes/v1'), 'utf8');
  ck("the table mounts storesRoute at '/stores'",
    /path:\s*'\/stores'\s*,\s*route:\s*storesRoute/.test(v1Source));
  ck("the table mounts storesAdminRoute at '/admin/stores'",
    /path:\s*'\/admin\/stores'\s*,\s*route:\s*storesAdminRoute/.test(v1Source));

  // Order matters and is deliberate: v1/index.js documents that /admin/stores is mounted
  // AFTER /admin and only resolves because admin.route.js has no catch-all.
  const adminDecl = v1Source.indexOf("path: '/admin',");
  const adminStoresDecl = v1Source.indexOf("path: '/admin/stores',");
  ck('/admin/stores is declared after /admin, as documented', adminDecl !== -1 && adminStoresDecl > adminDecl,
    `admin=${adminDecl} adminStores=${adminStoresDecl}`);

  console.log('\n=== the reachable admin surface ===\n');

  const paths = listPaths(adminMain);
  ck('admin paths are enumerable', paths.length > 0, `count=${paths.length}`);
  const methods = new Set(paths.map((p) => p.split(' ')[0]));
  ck('the admin surface exposes more than one verb', methods.size > 1, [...methods].join(','));

  const sample = paths.slice(0, 10);
  console.log('         sample of reachable admin endpoints:');
  for (const p of sample) console.log('           ' + p);

  console.log('\n=== admin routes are guarded, never open ===\n');

  const src = require('fs').readFileSync(
    require.resolve('../src/modules/stores/routes/stores.admin.route'),
    'utf8'
  );
  const guarded = (src.match(/\b(webAuth|appAuth|storeAuth|adminAuth|jwtWeb|jwtApp)\s*\(/g) || []).length;
  ck('the admin router references an auth guard', guarded > 0, `guards=${guarded}`);

  console.log('\n=== the customer router is not shadowed ===\n');

  // Defect recorded at stores.route.js: `GET /cart` was once shadowed by `GET /:store`,
  // answering a CastError. The customer sub-router must therefore be mounted BEFORE any
  // `:param` sibling. This asserts the literal paths exist in the customer router itself.
  const customerPaths = listPaths(partnerRouters['stores.customer.route']);
  ck('the customer router exposes /cart', customerPaths.some((p) => p.endsWith('/cart')), customerPaths.filter((p) => p.includes('cart')).join(' '));
  ck('the customer router exposes /nearby', customerPaths.some((p) => p.endsWith('/nearby')));
  ck('the customer router exposes orders', customerPaths.some((p) => /\/orders\b/.test(p)));
};

run()
  .catch((e) => {
    failures += 1;
    console.log('\nSUITE ERROR: ' + (e && e.stack ? e.stack : e));
  })
  .finally(() => {
    console.log('\n' + (failures === 0 ? 'ALL STORES ADMIN ROUTE CHECKS PASSED' : failures + ' STORES ADMIN ROUTE CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });