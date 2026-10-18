/**
 * verify.realestate.boot.js — does the Real Estate vertical actually load?
 *
 * ## Why this script exists
 *
 * On 2026-10-07 the module shipped in a state where `src/routes/v1/index.js` threw on
 * require:
 *
 *     Cannot find module '../../modules/realestate/services/realestate.vendor.service'
 *
 * Nine existing verify scripts were green. None of them noticed, because every one of
 * them required a *model* or a *service* directly. Nothing required a **route file**, and
 * nothing required the **v1 router**. A route file is the only place a wrong relative path
 * in a controller or middleware import can survive unnoticed, because the error does not
 * surface until process start.
 *
 * The one script that did catch it, `verify.realestate.kernel.integration.js` check [0],
 * was reported as passing. It was not.
 *
 * So this script asserts the thing nothing asserted: that the module tree loads, and that
 * the composed boot path loads. It needs no database and no test runner.
 *
 * ## Why it is hand-rolled rather than mocha + chai
 *
 * `chai` and `mocha` are not dependencies of this package (`npm test` is
 * `echo "No tests configured"`). Three verify scripts `require('chai')` and were therefore
 * dead on arrival — they had never executed. This script uses only `fs` and `path`, so it
 * runs on a bare checkout.
 *
 * Run: node scripts/verify.realestate.boot.js
 */

const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');
const MODULE_ROOT = path.join(API, 'src', 'modules', 'realestate');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const FINGERPRINT = 'LWL|WWL|2026|LOCALWALA|NODE';
const HEADER_LINES = 17;

/**
 * Every `.js` file under `dir`, recursively.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths, sorted
 */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

const rel = (p) => path.relative(API, p).replace(/\\/g, '/');

// --------------------------------------------------------------------------- [1]

console.log('\n[1] every file under src/modules/realestate/ requires cleanly');
const moduleFiles = walk(MODULE_ROOT);
for (const file of moduleFiles) {
  try {
    require(file);
    ok(rel(file));
  } catch (e) {
    bad(rel(file), e.message.split('\n')[0]);
  }
}

// --------------------------------------------------------------------------- [2]

console.log('\n[2] kernel-adjacent files this module depends on require cleanly');
for (const dep of [
  'src/kernel/geographic/services/geographic.service.js',
  'src/kernel/geographic/models/state.model.js',
  'src/kernel/geographic/models/operational.zone.model.js',
  'src/kernel/geographic/models/geo.boundary.model.js',
  'src/utils/money.field.js',
  'src/utils/catchAsync.js',
  'src/utils/ApiError.js',
  'src/utils/optionalTransaction.js',
  'src/middlewares/validate.js',
  'src/middlewares/webAuth.js',
  'src/config/roles.js',
]) {
  const full = path.join(API, dep);
  if (!fs.existsSync(full)) {
    bad(dep, 'file does not exist');
    continue;
  }
  try {
    require(full);
    ok(dep);
  } catch (e) {
    bad(dep, e.message.split('\n')[0]);
  }
}

// --------------------------------------------------------------------------- [3]

console.log('\n[3] the boot path composes: src/routes/v1/index.js requires cleanly');
let v1Router = null;
try {
  v1Router = require(path.join(API, 'src/routes/v1/index.js'));
  ok('src/routes/v1/index.js loaded');
} catch (e) {
  bad('src/routes/v1/index.js', e.message.split('\n')[0]);
}

// --------------------------------------------------------------------------- [4]

console.log('\n[4] every real-estate route file mounts on the v1 router');
const routeDir = path.join(MODULE_ROOT, 'routes');
const routeFiles = fs.existsSync(routeDir) ? walk(routeDir) : [];

for (const file of routeFiles) {
  const name = path.basename(file).replace(/^realestate\./, '').replace(/\.route\.js$/, '');
  const label = `/realestate/${name}`;

  if (!v1Router) {
    bad(label, 'v1 router failed to load, cannot assert mount');
    continue;
  }

  // The v1 router mounts with `router.use(path, route)`, which produces a layer whose
  // `handle` IS the router function itself — there is no `layer.route.path` to read.
  const exported = require(file);
  const mounted = (v1Router.stack || []).some((layer) => layer.handle === exported);

  if (mounted) ok(`${label} mounted`);
  else bad(`${label} NOT mounted on the v1 router (file: ${rel(file)})`);
}

// --------------------------------------------------------------------------- [5]

console.log('\n[5] no shadowed duplicate route files left in src/routes/v1/');
const legacyDir = path.join(API, 'src/routes/v1');
const duplicates = fs
  .readdirSync(legacyDir)
  .filter((f) => /^realestate\..*\.route\.js$/.test(f));

if (duplicates.length === 0) {
  ok('no duplicate real-estate route files in src/routes/v1/');
} else {
  for (const f of duplicates) {
    bad(
      `src/routes/v1/${f}`,
      'duplicate of src/modules/realestate/routes/ — ' +
        'the module copy is the mounted one, this one is unreachable dead code'
    );
  }
}

// --------------------------------------------------------------------------- [6]

console.log('\n[6] licence header on every real-estate module file (doc §0.0)');
for (const file of moduleFiles) {
  const head = fs.readFileSync(file, 'utf8').split('\n').slice(0, HEADER_LINES).join('\n');
  if (head.includes(FINGERPRINT)) ok(rel(file));
  else bad(rel(file), `missing "Ownership Fingerprint: ${FINGERPRINT}" in the first ${HEADER_LINES} lines`);
}

// --------------------------------------------------------------------------- [7]

/**
 * Every partial index filter must reference a real schema field.
 *
 * `RealEstateListingEntitlement` carried `{ entitlementRef: 1 }` with
 * `partialFilterExpression: { entitlementRef: { $type: 'objectId' } }` while declaring no
 * such field. MongoDB accepts it, `schema.indexes()` reports it, and it silently indexes
 * and enforces nothing — a partial index whose filter can never match a document.
 *
 * That is more dangerous than having no index, because the failure mode is absence rather
 * than an error: the intended uniqueness simply was not there. This check makes the
 * difference visible.
 */
console.log('\n[7] no partial index filters on a field the schema does not declare');

const collectFieldNames = (schema, prefix = '', out = new Set()) => {
  for (const path of Object.keys(schema.paths || {})) {
    out.add(prefix + path);
  }
  for (const [name, sub] of Object.entries(schema.subpaths || {})) {
    out.add(prefix + name);
    if (sub && sub.schema && sub.schema.paths) {
      collectFieldNames(sub.schema, `${prefix}${name}.`, out);
    }
  }
  return out;
};

/** First key segment of a dotted path, which is what a filter usually names. */
const rootField = (key) => String(key).split('.')[0];

let partialCount = 0;
for (const file of moduleFiles.filter((f) => f.endsWith('.model.js'))) {
  let model;
  try {
    model = require(file);
  } catch (e) {
    continue; // already reported by check [1]
  }
  if (!model || !model.schema) continue;

  const fields = collectFieldNames(model.schema);
  const indexes = model.schema.indexes();

  for (const [spec, opts] of indexes) {
    const filter = opts && opts.partialFilterExpression;
    if (!filter) continue;
    partialCount++;

    for (const key of Object.keys(filter)) {
      const root = rootField(key);
      if (fields.has(key) || fields.has(root)) {
        ok(`${model.modelName}: partial filter "${key}" is a declared field`);
      } else {
        bad(
          `${model.modelName}: partial filter "${key}"`,
          'not a field on this schema — the index matches nothing and enforces nothing'
        );
      }
    }
  }
}
if (partialCount === 0) {
  ok('no partial indexes declared on real-estate models');
} else {
  ok(`${partialCount} partial index filter(s) checked`);
}

// --------------------------------------------------------------------------- done

console.log('');
if (failed > 0) {
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL BOOT CHECKS PASSED');