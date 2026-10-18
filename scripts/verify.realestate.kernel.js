const path = require('path');
const API = 'C:/localwala/AppSourceCode/API';
process.chdir(API);

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

console.log('\n[1] new geographic models require cleanly');
for (const m of [
  '../kernel/geographic/models/state.model',
  '../kernel/geographic/models/operational.zone.model',
  '../kernel/geographic/models/geo.boundary.model',
]) {
  try {
    require(path.resolve(API, 'src/models', m));
    ok(m);
  } catch (e) {
    bad(m, e.message);
  }
}

console.log('\n[2] geographic.service requires cleanly');
try {
  const svc = require(path.resolve(API, 'src/kernel/geographic/services/geographic.service'));
  [
    'haversineMeters',
    'pointInRings',
    'approximateCentroid',
    'assertClosedRings',
    'findZoneByLocality',
    'findZonesByLocalities',
    'findBoundariesContaining',
    'resolveStateByNameOrAlias',
    'distanceBetween',
    'saveBoundary',
  ].forEach((k) => {
    if (typeof svc[k] !== 'function') throw new Error('missing ' + k);
  });
  ok('all 10 service methods present');
} catch (e) {
  bad('geographic.service', e.message);
}

console.log('\n[3] models/index.js registers all three, no collision');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  ['State', 'OperationalZone', 'GeoBoundary'].forEach((k) => {
    if (!M[k]) throw new Error(k + ' not exported');
    const name = M[k].modelName;
    if (name !== k) throw new Error(k + ' registered as ' + name);
    ok(k + ' -> mongoose model "' + name + '"');
  });
} catch (e) {
  bad('models/index.js', e.message);
}

console.log('\n[4] untouched models still register under their original names');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  [
    ['City', 'City'],
    ['Locality', 'Locality'],
    ['Restaurant', 'Restaurant'],
    ['Food', 'Food'],
  ].forEach(([k, expected]) => {
    if (!M[k]) throw new Error(k + ' missing');
    if (M[k].modelName !== expected) throw new Error(k + ' became ' + M[k].modelName);
    ok(k + ' unchanged');
  });
} catch (e) {
  bad('untouched models', e.message);
}

console.log('\n[5] money.field promotion: stores re-export resolves to the same helper');
try {
  const shared = require(path.resolve(API, 'src/utils/money.field'));
  const viaStores = require(path.resolve(API, 'src/modules/stores/utils/money.field'));
  if (viaStores !== shared) throw new Error('stores re-export is a different function');
  ok('stores/utils/money.field re-exports the SAME function object');

  const f = shared(0);
  const stored = f.set(100);
  if (stored !== 10000) throw new Error('set(100) gave ' + stored + ' paise, expected 10000');
  const read = f.get(stored);
  if (read !== 100) throw new Error('get(10000) gave ' + read + ', expected 100');
  ok('round trip: Rs100 -> ' + stored + ' paise -> Rs' + read);

  // The whole point of the helper: getter and setter must be exact inverses.
  for (const rupees of [0, 1, 99.99, 100, 52500, 1000000, 1234567.89]) {
    const back = f.get(f.set(rupees));
    if (back !== rupees) throw new Error('not inverse at ' + rupees + ' -> ' + back);
  }
  ok('getter/setter inverse across 7 magnitudes including 0 and 2dp');

  if (f.get(undefined) !== undefined) throw new Error('get(undefined) must pass through');
  if (f.set(undefined) !== undefined) throw new Error('set(undefined) must pass through');
  ok('null/undefined pass through without becoming NaN');
} catch (e) {
  bad('money.field', e.message);
}

console.log('\n' + (failed === 0 ? 'ALL CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
process.exit(failed === 0 ? 0 : 1);
