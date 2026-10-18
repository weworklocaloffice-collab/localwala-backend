const path = require('path');
const API = 'C:/localwala/AppSourceCode/API';
process.chdir(API);

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  console.log('  FAIL ' + m);
};

const M = require(path.resolve(API, 'src/models/index.js'));
const P = M.RealEstateProperty;
const D = M.RealEstatePropertyDocument;
const V = M.RealEstatePropertyVerification;
const C = M.RealEstatePropertyCategory;

/**
 * Resolve a dotted schema path.
 *
 * Mongoose 9 FLATTENS a nested GeoJSON subdocument — there is no `location` parent
 * path, only `location.type` and `location.coordinates`. Walking segment by segment
 * therefore fails on exactly the field this script exists to check, and the failure
 * mode is nasty: it reports "no location.type path" and "default was removed — we
 * edited a food-path model", which accuses the code of the opposite of the truth.
 *
 * So: try the whole dotted path first, then fall back to walking (which a genuine
 * nested subdocument still needs).
 */
const pathOf = (model, dotted) => {
  const direct = model.schema.path(dotted);
  if (direct) return direct;

  const parts = dotted.split('.');
  let p = model.schema.path(parts[0]);
  if (!p) return null;
  for (let i = 1; i < parts.length; i++) {
    if (!p.schema) return null;
    p = p.schema.path(parts[i]);
    if (!p) return null;
  }
  return p;
};

console.log('\n[1] all four register with the expected mongoose names');
[
  ['RealEstatePropertyCategory', C],
  ['RealEstateProperty', P],
  ['RealEstatePropertyDocument', D],
  ['RealEstatePropertyVerification', V],
].forEach(([want, got]) => {
  if (got && got.modelName === want) ok(want);
  else bad(want + ' -> ' + (got && got.modelName));
});

console.log('\n[2] F-13 — property geometry is the correct one');
{
  const t = pathOf(P, 'location.type');
  if (!t) bad('no location.type path');
  else if (t.options.default === undefined) ok('property location.type has NO default');
  else bad('property location.type default = ' + JSON.stringify(t.options.default));

  const v = pathOf(P, 'location.coordinates');
  if (!v || !v.options.validate) bad('no coordinates validator');
  else {
    const run = (a) => v.options.validate.validator.call({}, a);
    const cases = [
      [[78.4867, 17.385], true, 'valid Hyderabad point'],
      [[0, 0], false, 'null island REJECTED (would match an Atlantic radius search)'],
      [[181, 0], false, 'lng > 180'],
      [[-181, 0], false, 'lng < -180'],
      [[0, 91], false, 'lat > 90'],
      [[0, -91], false, 'lat < -90'],
      [[NaN, 17], false, 'NaN'],
      [[78], false, 'wrong arity'],
      [[78, 17, 5], false, '3 elements'],
    ];
    for (const [val, exp, label] of cases) {
      const got = run(val);
      if (got !== exp) bad(label + ' -> ' + got + ', expected ' + exp);
      else ok(label);
    }
  }
}

console.log('\n[3] the three pre-existing offenders are STILL untouched (plan §4.2.3)');
[
  ['City', 'location.type'],
  ['Locality', 'location.type'],
  ['Restaurant', 'location.type'],
].forEach(([m, p]) => {
  const t = pathOf(M[m], p);
  if (t && t.options.default !== undefined)
    ok(m + '.' + p + '.default still ' + JSON.stringify(t.options.default));
  else bad(m + '.' + p + ' default was removed — we edited a food-path model');
});

console.log('\n[4] BR-11 — status and availability are independent, separately enumed');
{
  const s = P.schema.path('status');
  const a = P.schema.path('availability');
  const expectedStatus = [
    'DRAFT',
    'SUBMITTED',
    'IN_REVIEW',
    'APPROVED',
    'PUBLISHED',
    'CHANGES_REQUIRED',
    'REJECTED',
    'SUSPENDED',
    'EXPIRED',
    'SOLD',
    'RENTED',
    'ARCHIVED',
  ];
  const expectedAvail = ['AVAILABLE', 'ON_HOLD', 'SOLD', 'RENTED', 'UNAVAILABLE', 'SUSPENDED'];

  const sOk = JSON.stringify(s.options.enum) === JSON.stringify(expectedStatus);
  const aOk = JSON.stringify(a.options.enum) === JSON.stringify(expectedAvail);
  if (sOk) ok('status enum exact (' + expectedStatus.length + ' states)');
  else bad('status enum = ' + JSON.stringify(s.options.enum));
  if (aOk) ok('availability enum exact (' + expectedAvail.length + ' states)');
  else bad('availability enum = ' + JSON.stringify(a.options.enum));

  if (s.options.default === 'DRAFT') ok('status defaults DRAFT (never PUBLISHED)');
  else bad('status default = ' + s.options.default);
  if (a.options.default === 'AVAILABLE') ok('availability defaults AVAILABLE');
  else bad('availability default = ' + a.options.default);

  // A PUBLISHED property can be ON_HOLD — that combination is the whole point of
  // separating them, so assert it is representable.
  if (!s.options.enum.includes('PUBLISHED') || !a.options.enum.includes('ON_HOLD'))
    bad('PUBLISHED + ON_HOLD not representable');
  else ok('PUBLISHED + ON_HOLD is representable (held properties stay visible)');
}

console.log('\n[5] required fields — a property cannot exist without location or category');
{
  [
    'propertyCode',
    'source',
    'title',
    'category',
    'transactionType',
    'locality',
    'city',
    'status',
    'availability',
  ].forEach((f) => {
    const p = P.schema.path(f);
    if (p && p.options.required === true) ok(f + ' required');
    else bad(f + ' required = ' + (p && p.options.required));
  });
  // `state` is deliberately NOT required: no client can resolve a State id
  // (no states endpoint; cities carry no state link), so the service derives
  // it from the locality's operational zone at create time (BR-19 pattern).
  if (P.schema.path('state').options.required !== true)
    ok('state optional (derived from zone, not client-supplied)');
  else bad('state is required — no UI can satisfy that');
  // The asymmetry with Restaurant, called out in the model doc.
  if (P.schema.path('locality').options.required === true)
    ok('property.locality required (Restaurant.locality is optional — deliberate)');
  else bad('property.locality not required');
}

console.log('\n[6] money field is the shared helper, not an inline pair');
{
  const p = P.schema.path('price');

  // `p.set` / `p.get` EXIST as functions — they are the setter/getter REGISTRATION
  // methods, so checking `typeof p.set === 'function'` passes and then calling it with
  // a number throws "A setter must be a function". The configured functions live in
  // `p.setters[]` / `p.getters[]`.
  if (p.setters.length === 1 && p.getters.length === 1) {
    ok('price has exactly one setter and one getter (the moneyField pair)');
  } else {
    bad(
      'price setters=' + p.setters.length + ' getters=' + p.getters.length + ' — expected 1 and 1'
    );
  }

  const stored = p.setters[0](52500);
  if (stored === 5250000) ok('setter: Rs52,500 -> ' + stored + ' paise');
  else bad('setter produced ' + stored + ', expected 5250000');

  const read = p.getters[0](5250000);
  if (read === 52500) ok('getter: 5,250,000 paise -> Rs' + read);
  else bad('getter produced ' + read + ', expected 52500');

  // The invariant that matters: they must be exact inverses across magnitudes.
  // A pair that drifts by a factor is a silent 100x money bug, not a crash.
  const magnitudes = [0, 1, 99.99, 52500, 1000000, 12345678.99];
  const broken = magnitudes.filter((r) => p.getters[0](p.setters[0](r)) !== r);
  if (!broken.length)
    ok('getter/setter are exact inverses across ' + magnitudes.length + ' magnitudes');
  else bad('not inverse at: ' + broken.join(', '));

  // End-to-end through a real document. `hydrate` takes STORED values (paise) and
  // applies the getter, which is exactly the read path a query result goes through.
  const doc = P.hydrate({ price: 5250000 });
  if (doc.price === 52500) ok('P.hydrate({price: 5250000}).price === 52500 (read path)');
  else bad('hydrated doc.price = ' + doc.price);

  if (p.options.default === 0) ok('price default 0');
  else bad('price default = ' + p.options.default);
  if (p.options.min === undefined) ok('price has no min — a rent of 0 is legal');
  else bad('price has a min of ' + p.options.min);
}

console.log('\n[7] no-default discipline on optional arrays/objects');
{
  const checks = [
    ['property.amenities', pathOf(P, 'amenities')],
    ['property.media', pathOf(P, 'media')],
    // `checklist`, `changeRequests` and `documentsChecked` live on the VERIFICATION
    // model, not the document model — a review records what was checked.
    ['verification.checklist', pathOf(V, 'checklist')],
    ['verification.changeRequests', pathOf(V, 'changeRequests')],
    ['verification.documentsChecked', pathOf(V, 'documentsChecked')],
    // `specSchema` is a nested object, so it is flattened like `location` — use pathOf.
    ['category.specSchema.fields', pathOf(C, 'specSchema.fields')],
    ['category.amenityOptions', pathOf(C, 'amenityOptions')],
  ];
  checks.forEach(([label, p]) => {
    // A missing path must FAIL, not silently pass as "no default".
    if (!p) bad(label + ' — path does not exist');
    else if (p.options.default === undefined) ok(label + ' has no default');
    else bad(label + ' default = ' + JSON.stringify(p.options.default));
  });
  const specs = P.schema.path('specs');
  if (!specs) bad('property.specs — path does not exist');
  else if (specs.options.default === undefined) ok('property.specs has no default');
  else bad('property.specs default = ' + JSON.stringify(specs.options.default));
}

console.log('\n[8] BR-18 — document visibility classes');
{
  const e = D.schema.path('visibility').options.enum;
  if (
    JSON.stringify(e) ===
    JSON.stringify(['INTERNAL', 'CUSTOMER_VISIBLE', 'BANK_VISIBLE', 'ADMIN_ONLY'])
  )
    ok('visibility enum exact (4 classes)');
  else bad('visibility enum = ' + JSON.stringify(e));
  if (D.schema.path('visibility').options.default === 'INTERNAL')
    ok('visibility defaults INTERNAL (deny by default)');
  else bad('visibility default = ' + D.schema.path('visibility').options.default);

  // Document category must be an enum too. A free string would let "OWNERSHIP" and
  // "ownership" become two categories, and the verification checklist matches on it.
  const cats = D.schema.path('category').options.enum;
  const expected = ['OWNERSHIP', 'APPROVAL', 'TAX', 'ENCUMBRANCE', 'PROJECT', 'SELLER', 'OTHER'];
  if (cats && JSON.stringify(cats) === JSON.stringify(expected))
    ok('document category enum exact (' + cats.length + ' classes)');
  else bad('document category enum = ' + JSON.stringify(cats));

  // The document status lifecycle must match what the partial unique index filters on,
  // or the index silently never applies.
  const dst = D.schema.path('status').options.enum;
  if (dst && dst.includes('ACCEPTED'))
    ok('document status enum contains ACCEPTED (matches the partial index filter)');
  else bad('document status enum = ' + JSON.stringify(dst));
}

console.log('\n[9] the partial unique indexes that carry the invariants');
{
  const dIdx = D.schema.indexes();
  const accepted = dIdx.find(([, o]) => o.name === 'one_accepted_document_per_category');
  if (accepted) ok('one ACCEPTED document per (property, category) — partial unique index present');
  else bad('accepted-document index missing');

  const vIdx = V.schema.indexes();
  const openOne = vIdx.find(([, o]) => o.name === 'one_open_review_per_property');
  if (openOne) ok('one OPEN review per property — partial unique index present');
  else bad('open-review index missing');

  // And the filter expressions must actually be single-valued, or the index is a no-op.
  if (
    accepted[1].partialFilterExpression &&
    accepted[1].partialFilterExpression.status === 'ACCEPTED'
  )
    ok('accepted index filters on status=ACCEPTED');
  if (openOne[1].partialFilterExpression && openOne[1].partialFilterExpression.open === true)
    ok('open-review index filters on open=true');
}

console.log('\n[10] search indexes');
{
  const idx = P.schema.indexes();

  // The 2dsphere marker lives in the index KEY, not the options:
  //   {"status":1,"availability":1,"transactionType":1,"location.coordinates":"2dsphere"}  {}
  // Checking the options finds nothing, which is how this assertion previously passed
  // for the wrong reason and would have kept passing if the geo index were deleted.
  const hasSphere = idx.some(([k]) => Object.values(k).includes('2dsphere'));
  if (hasSphere) ok('location.coordinates 2dsphere index present (found in the index key)');
  else bad('no 2dsphere index on property.location');

  const publicIdx = idx.find(
    ([k]) =>
      k.status === 1 &&
      k.availability === 1 &&
      k.transactionType === 1 &&
      k['location.coordinates'] === '2dsphere'
  );
  if (publicIdx)
    ok('public-search index is compound WITH the geo key (one scan, not an intersect)');
  else bad('public-search compound index missing or does not carry the geo key');

  if (idx.some(([k]) => k.status === 1 && k.availability === 1 && k.transactionType === 1))
    ok('public-search compound index present');
  else bad('public-search compound index missing');
  if (idx.some(([k]) => k.category === 1 && k.price === 1))
    ok('category+price facet index present');
  else bad('facet index missing');
  if (idx.some(([k]) => k.locality === 1 && k.status === 1)) ok('locality browse index present');
  else bad('locality index missing');
  if (idx.some(([k]) => k.status === 1 && k.expiresAt === 1)) ok('expiry-cron index present');
  else bad('expiry index missing');
  if (idx.some(([k]) => k.vendor === 1 && k.status === 1)) ok('vendor-dashboard index present');
  else bad('vendor index missing');

  const code = idx.find(([k]) => k.propertyCode === 1);
  if (code && code[1].unique) ok('propertyCode unique');
  else bad('propertyCode not uniquely indexed');
}

console.log('\n[11] no duplicate index key patterns anywhere in the four models');
{
  [
    ['RealEstateProperty', P],
    ['RealEstatePropertyDocument', D],
    ['RealEstatePropertyVerification', V],
    ['RealEstatePropertyCategory', C],
  ].forEach(([name, model]) => {
    const seen = new Set();
    const dupes = [];
    model.schema.indexes().forEach(([k]) => {
      const s = JSON.stringify(k);
      if (seen.has(s)) dupes.push(s);
      seen.add(s);
    });
    if (!dupes.length) ok(name + ' — ' + model.schema.indexes().length + ' indexes, all distinct');
    else bad(name + ' duplicate index on ' + dupes.join(' and '));
  });
}

console.log('\n[12] every ref resolves — or is a KNOWN forward reference to a later phase');
{
  const known = new Set(
    Object.values(M)
      .filter((m) => m && m.modelName)
      .map((m) => m.modelName)
  );

  // Phase 3+. A ref to one of these is not a bug, it is a dependency not yet built.
  // Anything else is a typo and must fail.
  const FUTURE = new Set(['RealEstateVendor', 'RealEstateListingEntitlement']);

  /**
   * Every `ref` reachable from a schema, including array caster refs
   * (`[{ type: ObjectId, ref: 'X' }]`) and nested subdocument schemas.
   */
  const collectRefs = (schema, out = [], trail = '', depth = 0) => {
    if (depth > 6) return out;

    Object.entries(schema.paths || {}).forEach(([key, p]) => {
      const here = trail ? trail + '.' + key : key;

      // Direct ObjectId.
      if (p.instance === 'ObjectId' && p.options && p.options.ref) {
        out.push([here, p.options.ref]);
      }
      // Array of ObjectId: the ref is on the caster, not the array.
      if (p.instance === 'Array' && p.caster && p.caster.options && p.caster.options.ref) {
        out.push([here + '[]', p.caster.options.ref]);
      }
      // Array of subdocuments that themselves carry refs.
      if (p.schema && p.schema.paths) {
        collectRefs(p.schema, out, here, depth + 1);
      }
      if (
        p.$embeddedSchemaType &&
        p.$embeddedSchemaType.options &&
        p.$embeddedSchemaType.options.ref
      ) {
        out.push([here + '[]', p.$embeddedSchemaType.options.ref]);
      }
    });
    return out;
  };

  const dangling = [];
  const forward = [];
  let total = 0;

  [
    ['RealEstateProperty', P],
    ['RealEstatePropertyDocument', D],
    ['RealEstatePropertyVerification', V],
    ['RealEstatePropertyCategory', C],
  ].forEach(([name, model]) => {
    collectRefs(model.schema).forEach(([trail, ref]) => {
      total++;
      if (known.has(ref)) return;
      if (FUTURE.has(ref)) {
        forward.push(name + '.' + trail + ' -> ' + ref);
        return;
      }
      dangling.push(name + '.' + trail + ' -> ' + ref);
    });
  });

  ok(total + ' refs found across the four models');

  if (!dangling.length)
    ok('no dangling refs (every ref is either registered or a known forward reference)');
  else bad('DANGLING refs (likely typos): ' + dangling.join(', '));

  if (forward.length) {
    console.log('  NOTE ' + forward.length + ' forward reference(s) to a later phase, expected:');
    forward.forEach((f) => console.log('       ' + f));
  } else {
    ok('no forward references — everything needed by these models already exists');
  }
}

console.log(
  '\n' + (failed === 0 ? 'ALL PROPERTY MODEL CHECKS PASSED' : failed + ' CHECK(S) FAILED')
);
process.exit(failed === 0 ? 0 : 1);
