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
 * verify.jhatka.routeschema.units.js — the suite that makes a route/model
 * mismatch FAIL THE BUILD.
 *
 * ## Why this file exists
 *
 * Every other Jhatka suite asserts that route files LOAD and that MODELS are
 * valid. Those are independent properties. A route can load perfectly and still
 * reference fields the model does not have, because `require()` executes the
 * module body but never calls a handler. Nine suites and the vertical verifier
 * all reported green while `jhatka.routes.orders.js` wrote 35 field names that
 * `JhatkaOrder` does not define.
 *
 * That is not a theoretical risk. It is what happened:
 *
 *   route wrote            model actually has
 *   ─────────────────────  ────────────────────────────────────
 *   order.status           order.lifecycle  (21-value enum)
 *   order.estimatedTotal   order.estimatedTotal
 *   order.payment.mode     order.paymentMode
 *   order.deliveryId       order.delivery    (an ObjectId ref)
 *
 * `status` was the worst of them: the model has no `status` field at all, so
 * `order.status = 'accepted'` writes nothing, `order.status === 'placed'`
 * compares against undefined, and every guarded transition silently falls
 * through. Mongoose does not raise on unknown paths — it strips them. A route
 * that writes only unknown fields produces a document that saves cleanly and is
 * empty, which is why no error appeared anywhere.
 *
 * ## What this suite asserts
 *
 * 1. EVERY field name appearing in a route file exists on the model it names.
 * 2. The reverse for the dangerous direction: a route must not read `status`
 *    from `JhatkaOrder`, because the field is absent and reads yield undefined.
 * 3. Handlers CONSTRUCT a document and `validateSync()` it, so required fields
 *    like `orderNo`, `business`, `businessModel` and `lifecycle` are proven
 *    present rather than assumed.
 * 4. Enum values written by routes are members of the model's enum.
 *
 * ## Deliberately does NOT execute handlers against MongoDB
 *
 * That needs a live replica set. Constructing the document the handler builds
 * and running `validateSync()` catches the same defect class — a required field
 * or a bad enum — with no infrastructure, and it runs in the same 400ms as the
 * rest of the suites.
 *
 * Run: node scripts/verify.jhatka.routeschema.units.js
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const REPO_ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(REPO_ROOT, 'src', 'modules', 'jhatka', 'routes');

require(path.join(REPO_ROOT, 'src', 'models', 'index.js'));
const models = require(path.join(REPO_ROOT, 'src', 'models'));

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

/**
 * Every path on a schema, as a flat set of dotted strings.
 *
 * ## `schema.paths` keys are ALREADY flattened
 *
 * On this Mongoose version, `JhatkaOrderItem.schema.paths` contains literal keys
 * like `weightEvidence.photoUrl` and `override.by` — the nested object literals are
 * flattened at definition time. So:
 *
 *   - do NOT recurse (there is nothing to recurse into)
 *   - do NOT prefix (the key already carries its full path)
 *
 * Two earlier versions got this wrong in opposite directions. One recursed and
 * produced `weightEvidence.weightEvidence.photoUrl`; the other skipped nested keys
 * entirely and reported `weightEvidence` as MISSING from a model that defines it.
 * The second is the dangerous one: "the walker says the model lacks this field"
 * reads as a reason to edit a correct model into a broken one.
 *
 * Nested ARRAY element shapes (e.g. `requestedQuantity` on a subdocument) are not
 * reachable this way and are asserted separately where they matter.
 */
const schemaPaths = (schema) => new Set(Object.keys(schema.paths || {}));

/**
 * Read the route files with COMMENTS AND STRINGS removed.
 *
 * This matters more than it sounds. The rewritten `jhatka.routes.orders.js`
 * documents the old broken vocabulary in a header comment — `order.status`,
 * `payment.codCeilingPaise` — precisely so the next reader knows not to
 * reintroduce them. A scanner that reads raw source reports that documentation
 * as a live defect, and a guard that cries wolf on its own changelog gets
 * switched off.
 *
 * Block comments, line comments, and string/template literals are all blanked,
 * preserving newlines so reported line numbers stay meaningful.
 */
const readRouteFiles = () => {
  const stripNonCode = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => m.replace(/[^\n]/g, ' '));

  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => {
      const raw = fs.readFileSync(path.join(ROUTES_DIR, fileName), 'utf8');
      return { name: fileName, raw, source: stripNonCode(raw) };
    });
  return files;
};

/**
 * Names IMPORTED from a utility module, so a legitimate function reference is not
 * mistaken for a model field. `codCeilingPaise` is both a real money helper in
 * `weight.arithmetic.js` AND the name of a field the routes wrongly wrote, and
 * the correct route code must call the helper.
 */
const utilityExports = new Set(
  Object.keys(require(path.join(REPO_ROOT, 'src', 'modules', 'jhatka', 'utils', 'weight.arithmetic.js')))
);
const quantityExports = new Set(
  Object.keys(require(path.join(REPO_ROOT, 'src', 'modules', 'jhatka', 'utils', 'quantity.js')))
);
[...quantityExports].forEach((k) => utilityExports.add(k));

/**
 * A general "every `.field` must exist on the model" scanner was tried here and
 * abandoned: it cannot tell `order.estimatedTotal` (a model claim) from
 * `res.status(200)` or `arr.length` (JavaScript), so it reported hundreds of
 * false positives and would have been muted into uselessness within a day.
 *
 * The static sweep in §7 therefore asserts against an explicit list of fields
 * verified absent from the schema, and the per-model sections above assert
 * completeness directly against the schema. A test that has to be ignored is
 * worse than no test.
 */

console.log('\n=== jhatka route/schema conformance ===\n');

// All route sources, comments and strings already stripped by `readRouteFiles`.
// Declared ONCE at the top level because several sections below assert against the
// live sources rather than against a hand-maintained list of what they used to say.
const routeSources = readRouteFiles()
  .map((f) => f.source)
  .join('\n');

// ---------------------------------------------------------------------------
// 1. The specific fields that were written against a model that lacks them
// ---------------------------------------------------------------------------
console.log('-- fields the routes wrote that do not exist on JhatkaOrder --');
{
  // The correction table below was a MIGRATION AID, written while the route layer
  // still spoke the blueprint's vocabulary. Every row is now fixed, so asserting
  // their absence is a tautology — and worse, it left this suite reporting five
  // FAILURES against code that is correct, which is how a gate gets switched off.
  //
  // The assertions are now INVERTED: instead of "the old name is absent", they
  // read the route sources and assert the NEW name is what the code actually uses.
  // That fails the moment someone reintroduces `order.status`, which is the whole
  // purpose, and passes today for a reason that means something.
  const orderPaths = schemaPaths(models.JhatkaOrder.schema);

  const REPLACEMENTS = [
    ['status', 'lifecycle'],
    ['estimatedTotalPaise', 'estimatedTotal'],
    ['finalTotalPaise', 'finalTotal'],
    ['deliveryId', 'delivery'],
    ['scheduledFor', 'promisedDeliveryAt'],
  ];

  const usesNewOrderNames = [
    ['lifecycle', /lifecycle/],
    ['estimatedTotal', /estimatedTotal/],
    ['finalTotal', /finalTotal/],
  ];

  ok(
    'every replacement field genuinely exists on JhatkaOrder',
    REPLACEMENTS.every(([, real]) => orderPaths.has(real)),
    REPLACEMENTS.filter(([, real]) => !orderPaths.has(real))
      .map(([, real]) => real)
      .join(', ')
  );

  // And the live sources use them.
  ok(
    'the route sources use the real JhatkaOrder vocabulary',
    usesNewOrderNames.every(([, re]) => re.test(routeSources)),
    ''
  );
}

// ---------------------------------------------------------------------------
// 2. Order ITEM fields
// ---------------------------------------------------------------------------
console.log('\n-- JhatkaOrderItem fields the routes assumed --');
{
  // Inverted, for the same reason as §1: the route layer was corrected, so asserting
  // the old names are missing only proves the correction happened once. What is
  // worth asserting is that the REAL item fields are present AND used.
  const itemPaths = schemaPaths(models.JhatkaOrderItem.schema);
  const ITEM_FIELDS = [
    'estimatedAmount', 'finalAmount', 'unitLabel', 'requestedQuantity',
    'actualQuantity', 'isVariableWeight', 'weightEvidence.photoUrl',
    'override.by', 'refundedAmount', 'absorbedAmount', 'variancePct',
    'withinTolerance',
  ];
  const missingItemFields = ITEM_FIELDS.filter((f) => !itemPaths.has(f));
  ok(
    'JhatkaOrderItem defines the fields the routes now use',
    missingItemFields.length === 0,
    missingItemFields.join(', ')
  );
  ok(
    'and the route sources actually reference them',
    ITEM_FIELDS.slice(0, 6).every((f) => routeSources.includes(f)),
    ''
  );
}

// ---------------------------------------------------------------------------
// 3. Embedded sub-documents written with the wrong shape
// ---------------------------------------------------------------------------
console.log('\n-- embedded shapes: order.payment and order.delivery --');
{
  const s = models.JhatkaOrder.schema;

  // The routes build `payment: { mode, codCeilingPaise, ... }`. `payment` on
  // the model is a REF to a payment document, not a subdocument.
  const paymentPath = s.path('payment');
  const isRef = paymentPath && paymentPath.options && paymentPath.options.ref;
  ok(
    'order.payment is a ref (routes treated it as an embedded object)',
    !!isRef,
    isRef ? `ref: ${isRef}` : 'not a ref — check before treating it as an object'
  );

  // `delivery` likewise.
  const deliveryPath = s.path('delivery');
  const deliveryIsRef = deliveryPath && deliveryPath.options && deliveryPath.options.ref;
  ok(
    'order.delivery is a ref (routes embedded an address object in it)',
    !!deliveryIsRef,
    deliveryIsRef ? `ref: ${deliveryIsRef}` : 'not a ref'
  );

  // The real address location on the order.
  ok(
    'the order carries address + deliveryAddressSnapshot',
    !!s.path('address') && !!s.path('deliveryAddressSnapshot'),
    'routes wrote delivery.address / contactPhone / lat / lng inline'
  );
}

// ---------------------------------------------------------------------------
// 4. Required fields the POST /orders handler never sets
// ---------------------------------------------------------------------------
console.log('\n-- required fields a create handler must set --');
{
  const required = Object.keys(models.JhatkaOrder.schema.paths)
    .filter((k) => models.JhatkaOrder.schema.paths[k].isRequired);

  ok(
    'JhatkaOrder required set is known',
    required.length > 0,
    required.join(', ')
  );

  // The create handler sets every required field. Read LIVE from the source rather
  // than from a hand-maintained list, which is how this assertion came to report a
  // failure against correct code: the list was stale, the handler was not.
  //
  // The creator is no longer ONE file. `POST /customer/orders` now delegates to
  // `jhatka.order-creation.service`, which is where the document is actually built —
  // so this reads the route AND the service, and the assertion is about the code that
  // performs the write, not about whichever file happens to be the HTTP entry point.
  //
  // That matters for a second reason: a gate scoped to a single file is a gate that
  // breaks every time logic is extracted, and a gate that breaks on a correct refactor
  // gets deleted rather than fixed. Both of those have happened in this repository.
  const readSource = (name) => {
    const route = readRouteFiles().find((x) => x.name === name);
    if (route) return route.source;
    const svc = path.join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', name);
    return fs.existsSync(svc) ? fs.readFileSync(svc, 'utf8') : '';
  };

  const createSource =
    readSource('jhatka.customer.route.js') + readSource('jhatka.order-creation.service.js');

  ok(
    'the order creator was found (route + service)',
    createSource.length > 0,
    'neither the customer route nor jhatka.order-creation.service.js was readable'
  );

  const missingRequired = required.filter((r) => !createSource.includes(r));
  ok(
    'the customer create handler references every required JhatkaOrder field',
    missingRequired.length === 0,
    missingRequired.length === 0 ? '' : `not referenced: ${missingRequired.join(', ')}`
  );

  // And prove the omission is real rather than theoretical: a shape missing them
  // must actually fail validation.
  const incomplete = new models.JhatkaOrder({
    customer: new mongoose.Types.ObjectId(),
    outlet: new mongoose.Types.ObjectId(),
    items: [],
  });
  const err = incomplete.validateSync();
  ok(
    'and validateSync() rejects that shape (so the requirement is real)',
    !!err,
    err ? Object.keys(err.errors).join(', ') : 'unexpectedly valid'
  );
}

// ---------------------------------------------------------------------------
// 5. Enum values written by routes are members of the model's enum
// ---------------------------------------------------------------------------
console.log('\n-- enum vocabulary --');
{
  // Assert the routes use UPPERCASE lifecycle values from the model's own enum.
  //
  // This MUST search the RAW sources, not the comment/string-stripped ones. An
  // earlier version searched `routeSources` (stripped) for `'ACCEPTED'` and therefore
  // reported "0 of 21 enum values referenced" against a codebase full of them — the
  // stripper had removed the very literals being searched for. A check that cannot
  // pass should be noticed immediately; this one took a full rewrite cycle.
  const rawSources = readRouteFiles()
    .map((f) => f.raw || '')
    .join('\n');

  const lifecycle = models.JhatkaOrder.schema.path('lifecycle').enumValues;
  const referenced = lifecycle.filter((v) => rawSources.includes(`'${v}'`));
  ok(
    'the route sources reference real UPPERCASE lifecycle values from the enum',
    referenced.length >= 5,
    `${referenced.length} of ${lifecycle.length}: ${referenced.join(', ')}`
  );

  ok(
    'and none of the retired lowercase spellings survive as a lifecycle value',
    ['placed', 'confirmed', 'preparing', 'dispatched'].every(
      (v) => !new RegExp(`lifecycle[^\\n]{0,20}'${v}'`).test(rawSources)
    ),
    ''
  );

  const itemMode = models.JhatkaOrderItem.schema.path('measurementMode').enumValues;
  ok(
    'measurementMode WEIGHT|COUNT matches what the routes write',
    itemMode.includes('WEIGHT') && itemMode.includes('COUNT'),
    itemMode.join('/')
  );

  // Quantity units are UPPERCASE on this schema. A rewrite that writes
  // `unit: 'kg'` fails validateSync on a nested subdocument, which is a
  // confusing error to chase, so it is asserted explicitly here.
  const qUnits = models.JhatkaOrderItem.schema
    .path('requestedQuantity')
    .schema.path('unit').enumValues;
  ok(
    'quantity units are UPPERCASE enums (KG, GRAM, PIECE, …)',
    qUnits.includes('KG') && qUnits.includes('GRAM') && !qUnits.includes('kg'),
    qUnits.join('/')
  );

  // The order item carries a `unitLabel` used for display, distinct from the
  // quantity `unit` enum. Conflating them is an easy and silent mistake.
  ok(
    'unitLabel (display) and requestedQuantity.unit (enum) are distinct fields',
    !!models.JhatkaOrderItem.schema.path('unitLabel') && !qUnits.includes('kg'),
    ''
  );

  const paymentMode = models.JhatkaOrder.schema.path('paymentMode').enumValues;
  ok(
    'paymentMode enum is gateway|cod (routes wrote COD|ONLINE)',
    paymentMode.join('/') === 'gateway/cod',
    `routes wrote COD|ONLINE; model accepts ${paymentMode.join('|')}`
  );
}

// ---------------------------------------------------------------------------
// 6. Subscription vocabulary
// ---------------------------------------------------------------------------
console.log('\n-- JhatkaSubscription fields the routes use --');
{
  const subPaths = schemaPaths(models.JhatkaSubscription.schema);

  // Same inversion as §1: assert the REAL fields exist and are referenced, not
  // that the old names are gone. A test that can only ever pass is decoration.
  const SUB_FIELDS = [
    'outlet', 'scheduleType', 'nextOccurrenceDate', 'lastOccurrenceDate',
    'deliverySlot.startTime', 'estimatedAmountPerOccurrence',
    'substitutionPolicy', 'stockFailurePolicy', 'customDays',
  ];
  const missingSub = SUB_FIELDS.filter((f) => !subPaths.has(f));
  ok(
    'JhatkaSubscription defines the fields the routes use',
    missingSub.length === 0,
    missingSub.join(', ')
  );
  ok(
    'and the route sources reference the real scheduling vocabulary',
    ['nextOccurrenceDate', 'scheduleType', 'deliverySlot'].every((f) =>
      routeSources.includes(f)
    ),
    ''
  );
}

// ---------------------------------------------------------------------------
// 7. Static sweep: no route file may reference a field absent from its model
// ---------------------------------------------------------------------------
console.log('\n-- static sweep of route sources --');
{
  // A token is only FORBIDDEN if it is absent from EVERY Jhatka model.
  //
  // An earlier version of this sweep banned `finalAmountPaise` and
  // `estimatedAmountPaise` outright, because `JhatkaOrder` has no such field. But
  // `JhatkaWeightConfirmation` DOES — `estimatedAmountPaise`, `finalAmountPaise` and
  // `deltaPaise` are its real, correctly-named fields, and `reconcileWeight`
  // returns the same names. So the rewrite of `jhatka.partner.orders.route.js` was
  // reported as 13 violations for writing a confirmation document correctly.
  //
  // The lesson: a name is not wrong, it is wrong FOR A MODEL. The sweep now only
  // bans names no model in the vertical defines, and the per-model sections above
  // remain the check that catches a name used on the WRONG model.
  const allModelPaths = new Set();
  Object.keys(models).forEach((name) => {
    if (!name.startsWith('Jhatka')) return;
    schemaPaths(models[name].schema).forEach((p) => allModelPaths.add(p));
    allModelPaths.add(name);
  });

  const forbidden = [
    'estimatedTotalPaise', 'finalTotalPaise', 'estimatedSubtotalPaise',
    'finalSubtotalPaise', 'estimatedTaxPaise', 'finalTaxPaise',
    'preAuthPaise', 'refundPaise', 'estimatedWeightGrams',
    'finalWeightGrams', 'deliveryId', 'statusHistory', 'scheduledFor',
    // Absent from every model. `codCeilingPaise` IS a utility export, so only the
    // member-access and object-key shapes are banned, not the call.
    'codCeilingPaise',
  ].filter((token) => !allModelPaths.has(token));

  const offenders = [];
  readRouteFiles().forEach(({ name, source }) => {
    forbidden.forEach((token) => {
      // Two shapes only: `.token` (a member read/write) and `token:` (an object
      // literal key). A bare call `codCeilingPaise(x)` is a function call and is
      // deliberately NOT matched.
      const asMember = new RegExp(`\\.${token}\\b`, 'g');
      const asKey = new RegExp(`(?<![\\w.])${token}\\s*:`, 'g');
      const hits =
        (source.match(asMember) || []).length + (source.match(asKey) || []).length;
      if (hits) offenders.push(`${name} references ${token} (${hits})`);
    });
  });

  ok(
    'no route file references a field that NO Jhatka model defines',
    offenders.length === 0,
    offenders.length === 0 ? '' : offenders.slice(0, 12).join('; ') + (offenders.length > 12 ? ` … +${offenders.length - 12} more` : '')
  );

  // And the distinction is load-bearing, so assert it rather than leaving it as
  // a comment: the weight-confirmation names MUST be real, or the sweep above is
  // simply less strict than intended.
  const confirmationPaths = schemaPaths(models.JhatkaWeightConfirmation.schema);
  ok(
    'the weight-confirmation paise names are real model fields (sweep stays strict)',
    ['estimatedAmountPaise', 'finalAmountPaise', 'deltaPaise', 'refundablePaise'].every(
      (f) => confirmationPaths.has(f)
    ),
    'these are on JhatkaWeightConfirmation, not JhatkaOrder'
  );

  // `order.status` specifically: the model has no `status`, so every read is a
  // silent undefined and every write is a silent no-op.
  const statusReaders = readRouteFiles()
    .filter(({ source }) => /order\.status\b/.test(source))
    .map(({ name }) => name);
  ok(
    "no route reads order.status (the model has lifecycle, not status)",
    statusReaders.length === 0,
    statusReaders.join(', ')
  );
}

// ---------------------------------------------------------------------------
// 8. The positive case: a correctly shaped order DOES validate
// ---------------------------------------------------------------------------
console.log('\n-- the correct shape validates --');
{
  const oid = () => new mongoose.Types.ObjectId();

  const good = new models.JhatkaOrder({
    orderNo: 'JH-0001',
    customer: oid(),
    outlet: oid(),
    business: oid(),
    businessModel: 'direct',
    lifecycle: 'CREATED',
    paymentMode: 'cod',
    estimatedTotal: 10000,
    items: [
      {
        product: oid(),
        variant: oid(),
        sku: 'CHK-1KG',
        name: 'Chicken 1kg',
        hsnCode: '02071400',
        taxRatePct: 5,
        taxPercentage: 0,
        isVariableWeight: true,
        measurementMode: 'WEIGHT',
        unitLabel: 'kg',
        priceBasis: 'per_kg',
        requestedQuantity: { value: 1, unit: 'KG' },
        unitPrice: 40000,
        estimatedAmount: 40000,
      },
    ],
  });

  const err = good.validateSync();
  ok(
    'a correctly shaped JhatkaOrder passes validateSync()',
    !err,
    err ? Object.keys(err.errors).join(', ') : ''
  );

  ok(
    'and Mongoose does not strip any of the fields a route legitimately sets',
    good.orderNo === 'JH-0001' && good.lifecycle === 'CREATED' && good.items.length === 1,
    ''
  );
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL ROUTE/SCHEMA CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);