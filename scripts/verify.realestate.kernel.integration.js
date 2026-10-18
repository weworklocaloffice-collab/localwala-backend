const path = require('path');
const API = 'C:/localwala/AppSourceCode/API';
process.chdir(API);

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

console.log('\n[1] the whole model index loads (all 140+ models register)');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  const n = Object.keys(M).length;
  ok(n + ' models registered');
} catch (e) {
  bad('models/index.js', e.message);
}

console.log('\n[2] the app boots far enough to build the express router');
try {
  const routes = require(path.resolve(API, 'src/routes/v1'));
  // router.use() layers carry `.handle`, not `.route` — count every layer.
  ok('routes/v1 built with ' + routes.stack.length + ' layers');
  const mounts = routes.stack.map((l) => l.regexp && String(l.regexp)).filter(Boolean);
  ok('first 3 mount patterns: ' + mounts.slice(0, 3).join('  '));
} catch (e) {
  bad('routes/v1', e.message);
}

console.log('\n[3] stores module still resolves after the money.field promotion');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  ['StoreChain', 'StoreOutlet', 'StoreOnboarding', 'StoreRoleAssignment'].forEach((k) => {
    if (!M[k]) throw new Error(k + ' missing');
  });
  ok('all Store* models registered');
} catch (e) {
  bad('Store* models', e.message);
}

console.log('\n[4] modelName audit — new mismatches fail, pre-existing ones are reported');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  const NEW = ['State', 'OperationalZone', 'GeoBoundary'];
  const mismatches = [];
  for (const [k, v] of Object.entries(M)) {
    if (!v || !v.modelName) {
      mismatches.push(k + ' (not a model)');
      continue;
    }
    if (v.modelName !== k) mismatches.push(k + ' -> ' + v.modelName);
  }
  const ours = mismatches.filter((m) => NEW.some((n) => m.startsWith(n + ' ')));
  if (ours.length) throw new Error('NEW mismatches: ' + ours.join(', '));
  ok('no mismatch among the 3 new models');
  if (mismatches.length) {
    console.log('  NOTE pre-existing export/modelName mismatches (NOT ours, NOT changed):');
    mismatches.forEach((m) => console.log('       ' + m));
    ok(mismatches.length + ' pre-existing mismatch(es) logged, not introduced by Phase 1');
  } else {
    ok('no mismatches anywhere');
  }
} catch (e) {
  bad('modelName audit', e.message);
}

console.log('\n[5] geo indexes declared on the three new models');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  [
    ['State', 'location'],
    ['OperationalZone', 'location'],
    ['GeoBoundary', 'centroid'],
  ].forEach(([model, field]) => {
    const idx = M[model].schema.indexes();
    const hit = idx.find(([keys]) => keys[field] === '2dsphere');
    if (!hit) throw new Error(model + ' has no 2dsphere on ' + field);
    ok(model + '.' + field + ' -> 2dsphere');
  });
} catch (e) {
  bad('geo indexes', e.message);
}

console.log('\n[5b] no two indexes share a key pattern (Mongo IndexKeySpecsConflict)');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  NEW = ['State', 'OperationalZone', 'GeoBoundary'];
  for (const m of NEW) {
    const seen = new Map();
    for (const [keys, opts] of M[m].schema.indexes()) {
      const k = JSON.stringify(keys);
      if (seen.has(k)) throw new Error(m + ' declares ' + k + ' twice');
      seen.set(k, opts);
    }
    ok(m + ' -> ' + M[m].schema.indexes().length + ' indexes, all distinct key patterns');
  }
} catch (e) {
  bad('duplicate index audit', e.message);
}

console.log('\n[6] geometry fields carry NO default on the nested type (F-13)');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  // Mongoose 9 flattens a nested GeoJSON subdocument into `location.type` and
  // `location.coordinates` paths — there is no `location` parent path to descend from.
  [
    ['State', 'location.type'],
    ['OperationalZone', 'location.type'],
    ['GeoBoundary', 'centroid.type'],
  ].forEach(([model, p]) => {
    const t = M[model].schema.path(p);
    if (!t) throw new Error(model + ' has no path ' + p);
    if (t.options.default !== undefined)
      throw new Error(p + ' HAS default ' + JSON.stringify(t.options.default));
    ok(model + '.' + p + ' has no default');
  });
} catch (e) {
  bad('F-13 regression check', e.message);
}

console.log('\n[7] the three pre-existing offenders still have theirs (unchanged, as required)');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  [
    ['City', 'location.type'],
    ['Locality', 'location.type'],
    ['Restaurant', 'location.type'],
  ].forEach(([model, p]) => {
    const t = M[model].schema.path(p);
    if (!t) throw new Error(model + ' has no path ' + p);
    if (t.options.default === undefined)
      throw new Error(model + ' default was REMOVED — did we edit a food-path model?');
    ok(model + '.' + p + '.default still ' + JSON.stringify(t.options.default) + ' (untouched)');
  });
} catch (e) {
  bad('untouched-model check', e.message);
}

console.log('\n[8] State coordinates validator rejects null island and out-of-range');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  const v = M.State.schema.path('location.coordinates').options.validate;
  if (!v || typeof v.validator !== 'function') throw new Error('no validator');
  const t = (a) => v.validator.call({}, a);
  const cases = [
    [[78.5, 17.5], true, 'valid point'],
    [[0, 0], false, 'null island rejected'],
    [[181, 17], false, 'lng > 180 rejected'],
    [[-181, 17], false, 'lng < -180 rejected'],
    [[78, 91], false, 'lat > 90 rejected'],
    [[78, -91], false, 'lat < -90 rejected'],
    [[NaN, 17], false, 'NaN rejected'],
    [[78], false, '1-element rejected'],
    [
      [78, 17, 5],
      false,
      '3-element rejected (we store [lng,lat] only; a stray 3rd is a caller bug)',
    ],
  ];
  for (const [val, expected, label] of cases) {
    const got = t(val);
    if (got !== expected) throw new Error(label + ': got ' + got + ', expected ' + expected);
    ok(label + ' -> ' + got);
  }
} catch (e) {
  bad('State coordinate validator', e.message);
}

console.log('\n[9] OperationalZone.localities has NO default (must not materialise [])');
try {
  const M = require(path.resolve(API, 'src/models/index.js'));
  const p = M.OperationalZone.schema.path('localities');
  if (p.options.default !== undefined)
    throw new Error('localities has default ' + JSON.stringify(p.options.default));
  ok('OperationalZone.localities default is undefined');
} catch (e) {
  bad('localities default', e.message);
}

console.log('\n' + (failed === 0 ? 'ALL INTEGRATION CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
process.exit(failed === 0 ? 0 : 1);
