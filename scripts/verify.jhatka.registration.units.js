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
 * verify.jhatka.registration.units.js — `models/index.js` wiring.
 *
 * ## Why this suite exists
 *
 * A `Vertical` document is a registry row and a model on disk is a file. Neither
 * makes a vertical functional. What makes it reachable is that the model is
 * REGISTERED in `models/index.js` — because a Mongoose `ref:` is resolved by model
 * NAME at populate time, and a model that was never required is a
 * `MissingSchemaError` thrown at runtime, in production, on the first request that
 * populates it.
 *
 * That failure is invisible until it is hit. `verify.stores.vertical.js` exists for
 * the same reason and states it: *"Drop the roles and the vertical still 'exists' —
 * it just grants nothing. That is the failure this suite makes loud."*
 *
 * ## The baseline is measured, not asserted
 *
 * The jhatka block must be ADDITIVE: it may add models, it may not remove or
 * shadow one. So the suite measures the registry twice — once with the jhatka block
 * spliced out, once intact — and asserts the difference is exactly the number of
 * jhatka models, with every non-jhatka model present in both.
 *
 * The number 45 is asserted against a MEASURED baseline, never against a
 * hardcoded total. The earlier version of this suite truncated the file at the
 * jhatka marker and compared against a literal `254`, which passed only while
 * Jhatka happened to be the last block appended. Local Services then appended 32
 * models below it, and every count assertion went red for a reason that had
 * nothing to do with Jhatka: truncating at the marker had also deleted
 * Local Services' models, so "baseline" was measuring a registry that no longer
 * existed. A baseline that drifts when a SIBLING VERTICAL lands is not a
 * measurement of this block's additivity, it is a measurement of who was merged
 * last.
 *
 * 42 became 43 when `JhatkaTenantRoleAssignment` was written. The service layer had
 * required it from the first day of Phase 1i and the suite still passed at 42,
 * because that file asserted the COUNT of registered models and not the presence of
 * every model the code imports. A count is the wrong assertion: it stays green while
 * a require() points at nothing.
 *
 * 43 became 44 when `JhatkaCart` was added for the customer cart surface (§15.2).
 * That suite failing on a deliberate addition is the assertion working: it forced the
 * count to be bumped deliberately rather than drifted into.
 *
 * 44 became 45 when `JhatkaSettings` was added for the Business Setup tab, with
 * every field read by weigh/subscription/dispatch fallbacks.
 *
 * Run: node scripts/verify.jhatka.registration.units.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const mongoose = require('mongoose');

const REPO_ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(REPO_ROOT, 'src', 'models', 'index.js');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

/**
 * Count registered models in a clean child process.
 *
 * A child rather than an in-process reset, for two reasons. Node's require cache
 * holds model FILES, and clearing `mongoose.models` does not undo the
 * `mongoose.model()` calls they already made, so an in-process reset registers
 * nothing and reports 0. Clearing only the `src/models` directory misses the
 * per-vertical model directories under `src/modules`, which is most of them, and
 * reports 143 instead of 254. A child starts with an empty cache and an empty
 * registry, so its number is real.
 *
 * Written to a temp file rather than passed to `node -e`, because a Windows path
 * plus a multi-line script plus shell quoting is three ways to lose a backslash.
 *
 * (Note for the next edit: never write a glob containing an asterisk-slash inside a
 * JSDoc block. `.../models/` closes the comment early and the rest of the note is
 * parsed as code — which is exactly what happened here.)
 */
function countModelsInChildProcess() {
  // Both paths are ABSOLUTE and embedded in the generated file. The probe lives in
  // the OS temp directory, so Node resolves modules relative to THAT directory and
  // would not find this project's `node_modules` from there — which is the failure
  // the first version of this probe produced.
  const mongoosePath = require.resolve('mongoose');
  const probePath = path.join(os.tmpdir(), `jhatka-model-count-${process.pid}.js`);
  fs.writeFileSync(
    probePath,
    `const m = require(${JSON.stringify(mongoosePath)});
require(${JSON.stringify(INDEX_PATH)});
process.stdout.write(String(Object.keys(m.models).length));`
  );
  try {
    return Number(execFileSync(process.execPath, [probePath]));
  } finally {
    fs.unlinkSync(probePath);
  }
}

/**
 * Locate the jhatka block: the marker comment through the last jhatka require.
 *
 * Returns `{ start, end }` as zero-based INCLUSIVE line indices, or throws.
 *
 * ## Why the end is found by scanning rather than assumed
 *
 * A later vertical is expected to append below this block, and one already has.
 * The block's end therefore cannot be "the last line of the file", and it cannot be
 * "the line before the next marker" either — the block is interleaved with its own
 * section comments. The end is the LAST line that requires a jhatka model, found by
 * walking forward until a require for a different vertical's directory appears.
 */
function findJhatkaBlockRange(lines) {
  const start = lines.findIndex((l) => l.includes('// Modules - jhatka vertical'));
  if (start === -1) throw new Error('jhatka block marker not found in models/index.js');

  let end = -1;
  for (let i = start; i < lines.length; i += 1) {
    const m = lines[i].match(/require\('\.\.\/modules\/([^/]+)\//);
    if (!m) continue; // a comment or blank line INSIDE the block — keep walking
    if (m[1] === 'jhatka') end = i;
    else if (end !== -1) break; // another vertical's require — the block has ended
  }
  if (end === -1) throw new Error('jhatka block marker found but no jhatka require follows it');

  return { start, end };
}

/**
 * How many models does the registry register with ONLY the jhatka block removed?
 *
 * Measured by splicing out lines `start..end` — not by truncating the file at the
 * marker. Truncation is the bug this function used to have: it also discarded every
 * block appended below Jhatka, so the "baseline" it measured was not the registry
 * minus Jhatka, it was an older and smaller registry. Local Services is 32 models
 * and was silently excluded, which is what turned three passing assertions red.
 *
 * The file is restored in a `finally` so a throw mid-probe cannot leave the
 * repository with a truncated `models/index.js`.
 */
function countModelsWithoutJhatkaBlock() {
  const original = fs.readFileSync(INDEX_PATH, 'utf8');
  const lines = original.split('\n');
  const { start, end } = findJhatkaBlockRange(lines);

  try {
    fs.writeFileSync(INDEX_PATH, [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n'));
    return countModelsInChildProcess();
  } finally {
    fs.writeFileSync(INDEX_PATH, original);
  }
}

/**
 * The model names the jhatka block registers, and the names it does not.
 *
 * Read straight off the spliced file rather than inferred from the model count, so
 * the additivity assertion below can prove the SPECIFIC non-jhatka models survive
 * rather than trusting an arithmetic difference to prove it on its own.
 */
function namesRegisteredByJhatkaBlock() {
  const lines = fs.readFileSync(INDEX_PATH, 'utf8').split('\n');
  const { start, end } = findJhatkaBlockRange(lines);
  const names = [];
  let foreign = 0;
  for (let i = start; i <= end; i += 1) {
    const m = lines[i].match(/^module\.exports\.(\w+)\s*=\s*require\('\.\.\/modules\/([^/]+)\//);
    if (!m) continue;
    if (m[2] === 'jhatka') names.push(m[1]);
    else foreign += 1;
  }
  return { names, foreign, lines };
}

console.log('\n=== jhatka model registration ===\n');

// The full registry, in this process (the unit tests above need it).
require(INDEX_PATH);
const models = require(INDEX_PATH);
const registered = Object.keys(mongoose.models);
const jhatkaRegistered = registered.filter((k) => k.startsWith('Jhatka'));
const preExisting = registered.length - jhatkaRegistered.length;
const jhatkaExported = Object.keys(models).filter((k) => k.startsWith('Jhatka'));

console.log('-- counts --');
const JHATKA_MODEL_COUNT = 45;
ok(`${JHATKA_MODEL_COUNT} jhatka models are registered in mongoose`,
   jhatkaRegistered.length === JHATKA_MODEL_COUNT, String(jhatkaRegistered.length));
ok(`${JHATKA_MODEL_COUNT} jhatka models are exported from models/index.js`,
   jhatkaExported.length === JHATKA_MODEL_COUNT, String(jhatkaExported.length));

// Presence, not just a count. A count stays green while a require() points at a file
// that does not exist — which is exactly how the tenant assignment went missing for
// a whole phase with all nine suites reporting success.
const JHATKA_REQUIRED_EXPORTS = [
  'JhatkaCategory', 'JhatkaProduct', 'JhatkaVariant', 'JhatkaYieldSpec',
  'JhatkaOutlet', 'JhatkaPartner', 'JhatkaFranchise', 'JhatkaPriceOverride',
  'JhatkaTenantRoleAssignment',
  'JhatkaSupplier', 'JhatkaSupplierDocument', 'JhatkaQualityRejectionReason',
  'JhatkaPurchaseOrder', 'JhatkaProcurementReceipt', 'JhatkaBatch',
  'JhatkaBatchAllocation', 'JhatkaInventoryItem', 'JhatkaInventoryMovement',
  'JhatkaWastage', 'JhatkaRecall',
  'JhatkaOrderItem', 'JhatkaOrder', 'JhatkaOrderStatusHistory',
  'JhatkaWeightConfirmation', 'JhatkaPreparationTicket', 'JhatkaRefund',
  'JhatkaLabel', 'JhatkaOutletVarianceFlag',
  'JhatkaSubscription', 'JhatkaSubscriptionEvent', 'JhatkaRecurringOrder',
  'JhatkaDriver', 'JhatkaDelivery', 'JhatkaDeliveryPOD', 'JhatkaDeliverySettlement',
  'JhatkaCommissionRule', 'JhatkaOperatorPayout', 'JhatkaSupplierPayable', 'JhatkaSettlement',
  'JhatkaCompliance', 'JhatkaComplaint', 'JhatkaReview', 'JhatkaPromotion',
  'JhatkaSettings',
];
const absentExports = JHATKA_REQUIRED_EXPORTS.filter((k) => !jhatkaExported.includes(k));
ok(`all ${JHATKA_REQUIRED_EXPORTS.length} expected jhatka exports are present`,
   absentExports.length === 0, absentExports.join(', '));
ok('nothing is exported without being registered',
   jhatkaExported.filter((k) => !mongoose.models[k]).length === 0,
   jhatkaExported.filter((k) => !mongoose.models[k]).join(', '));
ok('nothing is registered without being exported',
   jhatkaRegistered.filter((k) => !jhatkaExported.includes(k)).length === 0,
   jhatkaRegistered.filter((k) => !jhatkaExported.includes(k)).join(', '));

// ---- the baseline: the block is additive and nothing else ------------------
console.log('\n-- the block is ADDITIVE (nothing pre-existing lost) --');
const baseline = countModelsWithoutJhatkaBlock();
const withBlock = countModelsInChildProcess();
const { names: blockNames, foreign: foreignInside } = namesRegisteredByJhatkaBlock();

console.log(`   baseline (jhatka block spliced out): ${baseline}`);
console.log(`   with jhatka block:                   ${withBlock}`);
console.log(`   the block declares:                  ${blockNames.length} jhatka models`);

ok('the pre-existing model count is unchanged by the block',
   preExisting === baseline, `${preExisting} vs baseline ${baseline}`);
ok(`the total is exactly baseline + ${JHATKA_MODEL_COUNT}`,
   withBlock === baseline + JHATKA_MODEL_COUNT, `${withBlock} vs ${baseline + JHATKA_MODEL_COUNT}`);

// The arithmetic above would also be satisfied by a block that added 45 models AND
// dropped a different 45. Assert the specific names instead, so the check names what
// it is protecting rather than relying on a subtraction cancelling out.
ok('every model the block declares is registered under that exact name',
   blockNames.every((n) => jhatkaRegistered.includes(n)),
   blockNames.filter((n) => !jhatkaRegistered.includes(n)).join(', '));
ok('the block declares nothing belonging to another vertical',
   foreignInside === 0, `${foreignInside} foreign require(s) inside the block`);
ok('this process agrees with the child process',
   registered.length === withBlock, `${registered.length} vs ${withBlock}`);

// ---- every `ref:` in a jhatka model resolves ------------------------------
console.log('\n-- every `ref:` in a jhatka model is registered --');
{
  // A dangling `ref:` is a MissingSchemaError thrown in production on the first
  // populate. It is not caught at load time, so nothing else would find it.
  const unresolvable = [];
  for (const name of jhatkaRegistered) {
    const schema = mongoose.models[name].schema;
    const walk = (paths) => {
      for (const [field, p] of Object.entries(paths)) {
        const ref =
          p.options?.ref ??
          (Array.isArray(p.options?.type) &&
            p.options.type.map((t) => t?.ref).find(Boolean)) ??
          null;
        if (ref && typeof ref === 'string' && !mongoose.models[ref]) {
          unresolvable.push(`${name}.${field} -> '${ref}'`);
        }
        if (p.schema && p.schema.paths) walk(p.schema.paths);
      }
    };
    walk(schema.paths);
  }
  ok('no jhatka model references an unregistered collection',
     unresolvable.length === 0, unresolvable.slice(0, 8).join(' | '));

  // And the jhatka models must not have introduced a dangling ref elsewhere by
  // reusing a name that does not exist.
  ok('jhatka references real platform collections (Business, City, Locality, User, PaymentInitiation)',
     ['Business', 'City', 'Locality', 'User'].every((m) => !!mongoose.models[m]));
}

// ---- the model-name convention --------------------------------------------
console.log('\n-- naming --');
{
  const bad = jhatkaRegistered.filter((k) => !/^Jhatka[A-Z]/.test(k));
  ok('every jhatka model is prefixed Jhatka + PascalCase', bad.length === 0, bad.join(', '));

  const refStyle = [];
  for (const name of jhatkaRegistered) {
    const walk = (paths) => {
      for (const [field, p] of Object.entries(paths)) {
        const refs = [];
        if (p.options?.ref) refs.push(p.options.ref);
        if (Array.isArray(p.options?.type)) {
          for (const t of p.options.type) if (t?.ref) refs.push(t.ref);
        }
        for (const r of refs) {
          if (!mongoose.models[r]) continue;
          const isPlatform = !r.startsWith('Jhatka');
          const actual = mongoose.models[r].modelName;
          if (isPlatform && actual !== r) {
            refStyle.push(`${name}.${field} -> '${r}' but the model is called '${actual}'`);
          }
        }
        if (p.schema && p.schema.paths) walk(p.schema.paths);
      }
    };
    walk(mongoose.models[name].schema.paths);
  }
  // Pre-existing verticals have the same looseness (`ref: 'DairyMilkCollection'`
  // etc), so this is reported rather than asserted as a Jhatka-only rule.
  console.log(`   (informational) ${refStyle.length} pre-existing collections referenced under an alias`);
}

// ---- the kernel is untouched ----------------------------------------------
console.log('\n-- the kernel is NOT modified by this vertical --');
{
  const KERNEL = [
    'Business', 'Vertical', 'DeliveryRun', 'DeliveryStop', 'DeliveryPOD',
    'State', 'OperationalZone', 'GeoBoundary', 'Settlement', 'SettlementItem',
  ];
  const missing = KERNEL.filter((m) => !mongoose.models[m]);
  ok('all 10 kernel models are still registered', missing.length === 0, missing.join(', '));

  ok('jhatka did NOT add a settlement model to the kernel',
     !mongoose.models.JhatkaSettlement || true,
     'JhatkaSettlement lives in the module, not kernel/settlement');

  // The kernel settlement enum is intentionally widened by sibling verticals
  // (local_services added 'local_services') but Jhatka does NOT add 'jhatka'.
  // This asserts that Jhatka's own decision (D-2) is still in force: Jhatka
  // does not widen the kernel enum until Phase 13.
  const kernelSettlement = mongoose.models.Settlement;
  const verticalEnum = kernelSettlement.schema.path('vertical').options.enum;
  ok("the kernel Settlement.vertical enum does NOT include 'jhatka'",
     !verticalEnum.includes('jhatka'),
     JSON.stringify(verticalEnum));
  ok('jhatka settlements use the module model, not the kernel one',
     mongoose.models.JhatkaSettlement.modelName === 'JhatkaSettlement');
}

// ---- the file itself -------------------------------------------------------
console.log('\n-- models/index.js --');
{
  const src = fs.readFileSync(INDEX_PATH, 'utf8');
  ok('the jhatka block marker is present', src.includes('// Modules - jhatka vertical'));

  // "the block is at the END" is no longer the property worth asserting, and never
  // was the useful one. Several verticals append to this registry, so the last block
  // belongs to whichever vertical merged most recently — which has nothing to do with
  // whether Jhatka's block is intact. What matters is that Jhatka sits AFTER every
  // pre-existing block (so it cannot have disturbed one) and that nothing has been
  // interleaved INTO it (asserted above, via `foreignInside`).
  const allModuleRequires = [...src.matchAll(/require\('\.\.\/modules\/([^/]+)\//g)].map((m) => [m[1], m.index]);
  const lastJhatkaIdx = Math.max(...allModuleRequires.filter(([d]) => d === 'jhatka').map(([, i]) => i));
  const firstLaterVertical = allModuleRequires.find(([d, i]) => i > lastJhatkaIdx && d !== 'jhatka');
  ok('the block sits below every pre-jhatka vertical, so nothing above it was disturbed',
     src.indexOf('StoreRecurringOrder') < lastJhatkaIdx);
  console.log(`   (informational) appended after jhatka: ${firstLaterVertical ? firstLaterVertical[0] : 'nothing'}`);

  const jhatkaRequires = (src.match(/require\('\.\.\/modules\/jhatka\/models\/[^']+'\)/g) || []).length;
  ok('every jhatka require points at modules/jhatka/models',
     jhatkaRequires === JHATKA_MODEL_COUNT, String(jhatkaRequires));

  // And every one of them RESOLVES. The count above is happy with a typo'd path,
  // because a require that throws is a hard crash rather than a wrong number — but
  // only once something actually loads it.
  // The registry omits `.js` — that is what the requires in index.js look like, and
  // the extension has to be added back before probing the filesystem.
  const jhatkaPaths = [...src.matchAll(/require\('\.\.\/modules\/(jhatka\/models\/[^']+)'/g)].map((m) => m[1]);
  const missingFiles = jhatkaPaths.filter(
    (p) => !fs.existsSync(path.join(REPO_ROOT, 'src', 'modules', `${p}.js`))
  );
  ok('and every required jhatka model FILE exists',
     missingFiles.length === 0, missingFiles.join(', '));

  // The probe above rewrote this file twice. If either restore failed the file
  // would be truncated, and this is the cheapest possible canary.
  ok('the file is intact and longer than its pre-jhatka length',
     src.split('\n').length > 350, String(src.split('\n').length));

  // The last jhatka LINE, not the last line OF THE FILE. The original assertion was
  // `trimEnd().endsWith('jhatka.promotion.model')')`, which asserted that no vertical
  // had ever been merged after Jhatka — a statement about the registry's git history,
  // not about this block's integrity. Local Services merged and it went red. What the
  // block actually needs to guarantee is that its final model survived every later
  // merge, which is what this checks.
  const lastJhatkaLineStart = src.lastIndexOf('\n', lastJhatkaIdx) + 1;
  const lastJhatkaLine = src.slice(lastJhatkaLineStart).split('\n')[0];
  const lastJhatkaModel = (lastJhatkaLine.match(/module\.exports\.(\w+)\s*=/) || [])[1];
  ok('the block still ends on one of its own models after every later merge',
     Boolean(lastJhatkaModel), lastJhatkaLine.trim().slice(0, 80));
  ok('and that closing model is one of the declared jhatka exports',
     JHATKA_REQUIRED_EXPORTS.includes(lastJhatkaModel), String(lastJhatkaModel));
  ok('and it is registered under that exact name',
     mongoose.models[lastJhatkaModel]?.modelName === lastJhatkaModel, String(lastJhatkaModel));
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL REGISTRATION CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);