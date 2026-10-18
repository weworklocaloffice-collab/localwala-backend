/**
 * dump.stores.routes.js — lists the stores vertical's registered routes.
 * Run: node scripts/dump.stores.routes.js
 */
const stores = require('../src/modules/stores/routes/stores.route');
const admin = require('../src/modules/stores/routes/stores.admin.route');

const rows = [];

const show = (router, prefix) => {
  for (const layer of router.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {}).join(',').toUpperCase();
      rows.push([methods, prefix + layer.route.path]);
      if (layer.route.stack) {
        for (const inner of layer.route.stack) {
          if (inner.methods) {
            rows.push([Object.keys(inner.methods).join(',').toUpperCase(), prefix + layer.route.path]);
          }
        }
      }
    }
  }
};

show(stores, '');
show(admin, '');

console.log('\n=== /v1/stores (partner + applicant) ===');
for (const [m, p] of rows.filter((r) => r[1] && !r[1].startsWith('/applications'))) {
  console.log('  ' + m.padEnd(22) + p);
}
console.log('\n=== /v1/admin/stores ===');
for (const [m, p] of rows.filter((r) => r[1] && r[1].startsWith('/applications'))) {
  console.log('  ' + m.padEnd(22) + p);
}
console.log('\ntotal routes: ' + rows.length);