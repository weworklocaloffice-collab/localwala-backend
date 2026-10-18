/**
 * verify.realestate.retired.listing.js — the `RealEstateListing` retirement, kept honest.
 *
 * ## What happened
 *
 * `RealEstateListing` is not in the doc's §4.1 verdict table (32 models; "listing" there
 * means *a property a vendor has listed*, and §4.3.1 gives that lifecycle to
 * `RealEstateProperty.status`). It was never registered in `models/index.js`, and
 * `realestatelistings` held 0 documents. The model and its service have been deleted.
 *
 * ## Why this script still exists
 *
 * A deletion is only safe if nothing was lost with it, and that is worth asserting rather
 * than remembering. Two things could silently regress afterwards:
 *
 *   1. **A dangling require.** Anything still importing `realestate.listing.model` would
 *      throw at start-up. Check [5] walks the whole tree for that.
 *   2. **BR-05 becoming unreachable.** This was the real risk. `consume()` lived only in
 *      `realestate.listing.service.js`, which nothing imported — so the *publish* gate
 *      existed on `propertyService` while the consume it depends on did not, and a vendor
 *      could submit unlimited listings against one entitlement. Consumption now lives in
 *      `property.service.js`, and check [4] asserts it is still called from there.
 *
 * Check [3] keeps the transition map honest: every step the deleted service implemented
 * must still have a live equivalent, or a capability has quietly vanished.
 *
 * Run: node scripts/verify.realestate.retired.listing.js
 */

const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');
const MODULE = path.join(API, 'src', 'modules', 'realestate');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const src = (rel) => fs.readFileSync(path.join(MODULE, rel), 'utf8');

// --------------------------------------------------------------------------- [1]

console.log('\n[1] RealEstateListing is not part of the documented model set');

const DOC_PATH = path.join(
  API,
  '..',
  'Documentation',
  'contents',
  'real-estate-vertical-implementation-plan.md'
);

if (!fs.existsSync(DOC_PATH)) {
  bad('the plan document', 'not found at ' + DOC_PATH + ' — cannot check the doc');
  console.log('\n1 CHECK(S) FAILED');
  process.exit(1);
}

const doc = fs.readFileSync(DOC_PATH, 'utf8');

// The §4.1 verdict table is a markdown table of `| Blueprint entity | Verdict | Model |`.
// Match the row that assigns the Property model, which is the anchor this check hangs on.
assert(
  /\|\s*Property\s*\|\s*\*\*New\*\*\s*\|\s*`RealEstateProperty`\s*\|/.test(doc),
  'could not find the "Property | New | RealEstateProperty" row in the §4.1 verdict table'
);
ok('read the §4.1 verdict table; Property maps to RealEstateProperty');

/**
 * `RealEstateListing` appears in the doc only as a prefix of the three entitlement
 * models — never as a model of its own. Assert that, since "the doc never mentions it" is
 * the whole basis for retiring it.
 */
const bareMentions = [...doc.matchAll(/RealEstateListing(?!Package|Order|Entitlement)/g)];
if (bareMentions.length === 0) {
  ok('doc never names a bare RealEstateListing — only ListingPackage / ListingOrder / ListingEntitlement');
} else {
  bad(
    'doc mentions a bare RealEstateListing',
    `${bareMentions.length} mention(s) — re-read the doc before retiring it`
  );
}

// --------------------------------------------------------------------------- [2]

console.log('\n[2] it is unregistered, so nothing loads it through models/index.js');

const modelsIndex = fs.readFileSync(path.join(API, 'src/models/index.js'), 'utf8');
if (/RealEstateListing\b/.test(modelsIndex) && !/RealEstateListing(?:Package|Order|Entitlement)/.test(modelsIndex.match(/RealEstateListing\b.*/)[0] || '')) {
  bad('models/index.js', 'RealEstateListing is registered');
} else {
  ok('not registered in src/models/index.js');
}

// --------------------------------------------------------------------------- [3]

/**
 * Every transition the listing service implements, and whether the live property service
 * covers it.
 *
 * The mapping is not 1:1 and that is the point of the exercise. The listing service models
 * a *moderation* lifecycle that partly overlaps the property's, and partly does not:
 * `holdListing` moves `status` to ON_HOLD, whereas BR-11 puts ON_HOLD on `availability`,
 * so that one is not a straight port.
 */
const LIFECYCLE = [
  // The listing service names its steps `createListing` / `submitListing`. The live
  // property service names them `create` / `changeStatus` / `changeAvailability`.
  { fn: 'createListing', target: 'a DRAFT property', present: 'create' },
  { fn: 'submitListing', target: 'DRAFT -> SUBMITTED', present: 'changeStatus' },
  { fn: 'approveListing', target: 'SUBMITTED -> APPROVED', present: 'changeStatus' },
  { fn: 'rejectListing', target: '-> REJECTED', present: 'changeStatus' },
  { fn: 'archiveListing', target: '-> ARCHIVED', present: 'changeStatus' },
  // These two are the interesting ones: the listing service put ON_HOLD on `status`,
  // while BR-11 assigns it to `availability`. So the equivalent is `changeAvailability`,
  // not `changeStatus` — a straight port would put the state in the wrong field.
  { fn: 'holdListing', target: 'APPROVED -> ON_HOLD (availability, per BR-11)', present: 'changeAvailability' },
  { fn: 'releaseListing', target: 'ON_HOLD -> APPROVED (availability)', present: 'changeAvailability' },
];

console.log('\n[3] every transition has an equivalent on the live property service');

const propertyServiceSrc = src('services/realestate.property.service.js');
const propertyService = require(path.join(MODULE, 'services/realestate.property.service'));

const exported = Object.keys(propertyService);
ok(`realestate.property.service exports: ${exported.join(', ')}`);

for (const step of LIFECYCLE) {
  // Membership only. An earlier version of this check also accepted a mention anywhere in
  // the file, which passed `submitListing` against a *comment* that named the function —
  // exactly the false green this script exists to prevent.
  if (exported.includes(step.present)) {
    ok(`${step.fn} (${step.target}) -> covered by ${step.present}()`);
  } else {
    bad(
      `${step.fn} (${step.target})`,
      `${step.present} is not an export of realestate.property.service — this transition would be lost`
    );
  }
}

// --------------------------------------------------------------------------- [4]

console.log('\n[4] the entitlement check survives — BR-05 must not be lost with the model');

const entitlementServiceSrc = src('services/realestate.listing.entitlement.service.js');
const hasConsume = /function consume\s*\(/.test(entitlementServiceSrc);
const hasRestore = /function restoreManual\s*\(/.test(entitlementServiceSrc);
const hasEligible = /function restoreIfEligible\s*\(/.test(entitlementServiceSrc);

if (hasConsume) ok('entitlement service still owns consume()');
else bad('consume()', 'missing from realestate.listing.entitlement.service');

if (hasRestore) ok('entitlement service still owns restoreManual()');
else bad('restoreManual()', 'missing — BR-05 admin restore would be lost');

if (hasEligible) ok('entitlement service still owns restoreIfEligible()');
else bad('restoreIfEligible()', 'missing');

/**
 * BR-05 consumption must be reachable from the *live* service, not only from the code that
 * is being retired.
 *
 * This was the substantive risk. `consume()` lived only in `realestate.listing.service.js`,
 * which nothing imported, so the publish gate existed on `propertyService` while the consume
 * that the gate depends on did not. Consumption now lives in `property.service.js`.
 */
if (/entitlementService\.consume\s*\(/.test(src('services/realestate.property.service.js'))) {
  ok('property.service calls entitlementService.consume() — BR-05 is on the reachable path');
} else {
  bad(
    'BR-05 reachability',
    'property.service does not consume an entitlement — submit would not be charged'
  );
}

// --------------------------------------------------------------------------- [5]

console.log('\n[5] the retired files are gone and nothing dangles');

/**
 * The decisive fact for retirement. If the service were wired into a route, controller or
 * the search path, deleting it would be a behavioural change. If the only importer is a
 * verify script, then it is not part of the running application at all — and the honest
 * disposition is to rewrite that test against the property service, not to preserve the
 * dead model to keep a test happy.
 */
let importers = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const text = fs.readFileSync(full, 'utf8');
      if (/require\([^)]*realestate\.listing\.(model|service)/.test(text)) {
        importers.push(path.relative(API, full).replace(/\\/g, '/'));
      }
    }
  }
};
walk(path.join(API, 'src'));
walk(path.join(API, 'scripts'));

ok(`remaining references to the retired model/service: ${importers.length}`);
importers.forEach((i) => console.log('       ' + i));

if (importers.length === 0) {
  ok('nothing anywhere still requires realestate.listing.model or .listing.service');
} else {
  bad(
    'dangling reference to the retired model',
    importers.join(', ') + ' — these would throw on require'
  );
}

// The files must actually be gone, not merely unreferenced.
const retired = [
  'src/modules/realestate/models/realestate.listing.model.js',
  'src/modules/realestate/services/realestate.listing.service.js',
];
const stillPresent = retired.filter((f) => fs.existsSync(path.join(API, f)));
if (stillPresent.length === 0) ok('both retired files are deleted from disk');
else bad('retired files still on disk', stillPresent.join(', '));

// `RealEstateListingPackage` / `Order` / `Entitlement` must NOT have gone with them.
for (const keep of [
  'src/modules/realestate/models/realestate.listing.package.model.js',
  'src/modules/realestate/models/realestate.listing.order.model.js',
  'src/modules/realestate/models/realestate.listing.entitlement.model.js',
]) {
  if (fs.existsSync(path.join(API, keep))) ok(`kept: ${path.basename(keep)}`);
  else bad(path.basename(keep), 'deleted — it is a documented model (doc §4.1)');
}

// --------------------------------------------------------------------------- done

console.log('');
if (failed > 0) {
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('RealEstateListing is RETIRED — coverage preserved on the property service');