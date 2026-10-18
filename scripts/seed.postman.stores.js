/**
 * Regenerates the "Stores Routes" folder inside Resource/postman_collection.json from
 * the LIVE router stacks, so the documented surface cannot drift from the real one.
 *
 *   node scripts/seed.postman.stores.js
 *
 * Run from API/. Idempotent: it removes any existing "Stores Routes" folder first.
 * A timestamped backup of the collection is written before anything is changed.
 */

const fs = require('fs');
const path = require('path');

const COLLECTION = path.resolve(__dirname, '..', '..', 'Resource', 'postman_collection.json');
const FOLDER = 'Stores Routes';

const express = require('express');
const partnerRouter = require('../src/modules/stores/routes/stores.route');
const adminRouter = require('../src/modules/stores/routes/stores.admin.route');

/**
 * Walk a mounted express stack into `{ method, path }` entries.
 * Express 5 exposes a mount's prefix on the LAYER, not on the sub-router, so prefixes are
 * resolved by matching each layer's regexp against a probe URL and reading the capture.
 */
const walk = (router, prefix = '', out = []) => {
  for (const layer of router.stack || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods || {})) {
        if (method === '_all') continue;
        out.push({ method: method.toUpperCase(), path: (prefix + layer.route.path).replace(/\/{2,}/g, '/') });
      }
    } else if (layer.handle && layer.handle.stack) {
      let seg = '';
      const re = layer.regexp;
      if (re) {
        const probe = '/__probe__';
        const m = re.exec(probe);
        if (m) seg = m[0].replace(/^\^/, '').replace(/\\\//g, '/').replace(/\$$/, '').replace(/\?.*$/, '');
      }
      walk(layer.handle, prefix + seg.replace(/\/$/, ''), out);
    }
  }
  return out;
};

const toItem = (r) => ({
  name: `${r.method} ${r.path}`,
  request: {
    method: r.method,
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '' },
    url: { raw: `{{base_url}}${r.path}`, host: ['{{base_url}}'], path: r.path.split('/').filter(Boolean) },
    description: r.path,
  },
  response: [],
});

const run = () => {
  const raw = fs.readFileSync(COLLECTION, 'utf8');
  const collection = JSON.parse(raw);

  const entries = [
    ...walk(partnerRouter, '/v1/stores'),
    ...walk(adminRouter, '/v1/admin/stores'),
  ];

  // De-duplicate on method+path, then sort so the folder reads predictably.
  const seen = new Set();
  const unique = entries
    .filter((r) => {
      const k = r.method + ' ' + r.path;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  const backup = COLLECTION.replace(/\.json$/, `.json.bak-${Date.now()}`);
  fs.writeFileSync(backup, raw);

  collection.item = (collection.item || []).filter((i) => i.name !== FOLDER);
  collection.item.push({
    name: FOLDER,
    description: 'Local Stores vertical. GENERATED from the live routers by scripts/seed.postman.stores.js - do not hand-edit.',
    item: unique.map(toItem),
  });

  fs.writeFileSync(COLLECTION, JSON.stringify(collection, null, 2));
  console.log(`Backup:  ${path.basename(backup)}`);
  console.log(`Added:   ${unique.length} endpoints under "${FOLDER}"`);
  console.log(`  partner/admin  = ${unique.filter((r) => r.path.startsWith('/v1/admin/stores')).length}`);
  console.log(`  partner/customer = ${unique.filter((r) => !r.path.startsWith('/v1/admin/stores')).length}`);
};

run();