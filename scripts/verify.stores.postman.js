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
 * verify.stores.postman.js — the documented API surface matches the real one.
 *
 * Run: node scripts/verify.stores.postman.js
 *
 * ## The defect this exists to stop
 *
 * Trap T2 in the plan is that a vertical ships with routes and a Postman collection that
 * does not mention them, so the first human to try an endpoint gets a 404 and concludes the
 * feature is missing. Stores shipped exactly that way: `Resource/postman_collection.json`
 * held 2160 endpoints and 168 dairy ones, and zero stores.
 *
 * This suite compares the collection against the LIVE routers in both directions:
 *
 *   - every reachable stores endpoint is documented   (nothing is undocumented)
 *   - every documented stores endpoint still exists  (no stale entries left behind)
 *
 * The first direction alone would pass against a collection full of invented URLs. The
 * second is what makes the collection trustworthy, so both are asserted.
 *
 * Regenerate with: node scripts/seed.postman.stores.js
 */

const fs = require('fs');
const path = require('path');

const partnerRouter = require('../src/modules/stores/routes/stores.route');
const adminRouter = require('../src/modules/stores/routes/stores.admin.route');

const COLLECTION = path.resolve(__dirname, '..', '..', 'Resource', 'postman_collection.json');
const FOLDER = 'Stores Routes';

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

/** Live routes, normalised to `METHOD /path` with :params preserved. */
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

/** Normalise a documented URL down to `METHOD /path`. */
const documented = (item) => {
  const u = item.request && item.request.url;
  const raw = typeof u === 'string' ? u : (u && u.raw) || '';
  const method = String((item.request && item.request.method) || 'GET').toUpperCase();
  const path = raw.replace(/^https?:\/\/[^/]+/, '').replace(/^\{\{base_url\}\}/, '').split('?')[0];
  return `${method} ${path.replace(/\/$/, '') || '/'}`;
};

const run = () => {
  console.log('\n=== the collection is readable ===\n');

  let collection;
  try {
    collection = JSON.parse(fs.readFileSync(COLLECTION, 'utf8'));
  } catch (e) {
    ck('the collection parses', false, e.message);
    return;
  }
  ck('the collection parses', true);
  ck('it declares a schema', !!collection.info && !!collection.info.schema, collection.info && collection.info.schema);

  console.log('\n=== trap T2: a Stores Routes folder exists and is populated ===\n');

  const folder = (collection.item || []).find((i) => i.name === FOLDER);
  ck('the Stores Routes folder exists', !!folder);
  if (!folder) return;

  const leaves = [];
  (function w(items) { for (const i of items || []) { if (i.item) w(i.item); else if (i.request) leaves.push(i); } })(folder.item);
  ck('it contains endpoints', leaves.length > 0, `count=${leaves.length}`);

  const partnerCount = leaves.filter((l) => !documented(l).includes('/v1/admin/stores')).length;
  const adminCount = leaves.length - partnerCount;
  ck('partner and customer endpoints are documented', partnerCount > 0, `partner=${partnerCount}`);
  ck('admin endpoints are documented', adminCount > 0, `admin=${adminCount}`);

  console.log('\n=== nothing reachable is undocumented ===\n');

  const live = [
    ...new Set([...walk(partnerRouter, '/v1/stores'), ...walk(adminRouter, '/v1/admin/stores')]),
  ];
  const docSet = new Set(leaves.map(documented));

  const missing = live.filter((e) => !docSet.has(e));
  ck('every live stores endpoint is documented', missing.length === 0,
    missing.length ? `missing ${missing.length}: ${missing.slice(0, 5).join(', ')}` : `${live.length} endpoints`);
  console.log('         ' + live.length + ' live endpoints checked against the collection');

  console.log('\n=== nothing documented is stale ===\n');

  const liveSet = new Set(live);
  const stale = [...docSet].filter((e) => !liveSet.has(e));
  ck('no documented endpoint has been removed from the code', stale.length === 0,
    stale.length ? `stale ${stale.length}: ${stale.slice(0, 5).join(', ')}` : '');

  console.log('\n=== the other verticals were not collaterally damaged ===\n');

  const allLeaves = [];
  (function w(items) { for (const i of items || []) { if (i.item) w(i.item); else if (i.request) allLeaves.push(i); } })(collection.item);
  const urls = allLeaves.map((l) => {
    const u = l.request.url;
    return typeof u === 'string' ? u : (u && u.raw) || '';
  });
  ck('the dairy surface is still documented', urls.filter((u) => u.includes('/v1/dairy')).length >= 168,
    `dairy=${urls.filter((u) => u.includes('/v1/dairy')).length}`);
  ck('the realestate surface is still documented', urls.filter((u) => u.includes('/v1/realestate')).length >= 87,
    `realestate=${urls.filter((u) => u.includes('/v1/realestate')).length}`);
  ck('the collection grew rather than shrank', allLeaves.length >= 2385, `leaves=${allLeaves.length}`);

  console.log('\n=== endpoints are described, not blank ===\n');

  ck('every entry has a name', leaves.every((l) => !!l.name));
  ck('every entry has a method', leaves.every((l) => !!l.request && !!l.request.method));
  ck('every entry points at {{base_url}}', leaves.every((l) => {
    const u = l.request.url;
    const raw = typeof u === 'string' ? u : (u && u.raw) || '';
    return raw.includes('{{base_url}}');
  }));
};

run();
console.log('\n' + (failures === 0 ? 'ALL STORES POSTMAN CHECKS PASSED' : failures + ' STORES POSTMAN CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);