const path = require('path');
const API = 'C:/localwala/AppSourceCode/API';
process.chdir(API);

const svc = require(
  path.resolve(API, 'src/modules/realestate/services/realestate.category.service')
);
const Model = require(
  path.resolve(API, 'src/modules/realestate/models/realestate.property.category.model')
);

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  console.log('  FAIL ' + m);
};

// assertThrows(fn, substring, label)
function throws(fn, substr, label) {
  try {
    fn();
    bad(label + ' -> expected a throw, got none');
    return null;
  } catch (e) {
    if (e.message && e.message.includes(substr)) {
      ok(label + ' -> "' + e.message.slice(0, 78) + '"');
      return e;
    }
    bad(label + ' -> threw "' + (e.message || e) + '" which does not mention "' + substr + '"');
    return e;
  }
}

// assertValid(fn, label)
function valid(fn, label) {
  try {
    fn();
    ok(label);
    return true;
  } catch (e) {
    bad(label + ' -> unexpected throw: ' + e.message);
    return false;
  }
}

console.log('\n[1] descriptor type -> Joi mapping');
{
  const cat = {
    _id: 'c1',
    updatedAt: new Date(1000),
    specSchema: {
      fields: [
        { key: 'n', type: 'NUMBER', min: 1, max: 10 },
        { key: 'i', type: 'NUMBER', integer: true },
        { key: 'e', type: 'ENUM', options: ['A', 'B'] },
        { key: 'b', type: 'BOOLEAN' },
        { key: 'd', type: 'DATE' },
        { key: 's', type: 'STRING', maxLength: 5 },
        { key: 't', type: 'TEXT' },
        { key: 'dflt', type: 'STRING' },
      ],
    },
  };
  const schema = svc.compileSpecSchema(cat);
  const base = {
    n: 5,
    i: 3,
    e: 'A',
    b: true,
    d: '2026-01-15',
    s: 'abc',
    t: 'long text',
    dflt: 'x',
  };
  valid(() => schema.validate(base), 'all 8 types validate a good value');
  const r = schema.validate({ ...base, n: 50 });
  if (r.error && r.error.message.includes('10')) ok('NUMBER max enforced (50 > 10)');
  else bad('NUMBER max not enforced: ' + (r.error && r.error.message));
  const r2 = schema.validate({ ...base, e: 'Z' });
  if (r2.error) ok('ENUM rejects an unlisted value');
  else bad('ENUM accepted "Z"');
  const r3 = schema.validate({ ...base, i: 3.5 });
  if (r3.error) ok('integer:true rejects 3.5');
  else bad('integer:true accepted 3.5');
}

console.log('\n[2] required vs optional');
{
  const cat = {
    _id: 'c2',
    updatedAt: new Date(1000),
    specSchema: {
      fields: [
        { key: 'must', type: 'STRING', required: true },
        { key: 'maybe', type: 'STRING' },
      ],
    },
  };
  const schema = svc.compileSpecSchema(cat);
  const r = schema.validate({ maybe: 'x' });
  if (r.error && r.error.message.includes('must')) ok('required field enforced when absent');
  else bad('required not enforced: ' + JSON.stringify(r.error));
  valid(() => schema.validate({ must: 'y' }), 'valid when the required field is present');
  valid(() => schema.validate({ must: 'y', maybe: null }), 'optional field accepts null');
  valid(() => schema.validate({ must: 'y', maybe: '' }), 'optional field accepts empty string');
}

console.log('\n[3] reject descriptors that cannot produce a working schema');
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: [{ key: '' }] } }),
  "'key' is required",
  'empty key'
);
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: [{ key: '  ' }] } }),
  "'key' is required",
  'whitespace key'
);
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: [{ key: '1bad', type: 'STRING' }] } }),
  'must be alphanumeric',
  'key starting with a digit'
);
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: [{ key: 'has-dash', type: 'STRING' }] } }),
  'must be alphanumeric',
  'key with a dash'
);
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: [{ key: 'ok', type: 'NOPE' }] } }),
  'is not one of',
  'unknown field type'
);
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: [{ key: 'e', type: 'ENUM' }] } }),
  'needs a non-empty',
  'ENUM with no options'
);
throws(
  () =>
    svc.compileSpecSchema({ specSchema: { fields: [{ key: 'e', type: 'ENUM', options: [] }] } }),
  'needs a non-empty',
  'ENUM with empty options'
);
throws(
  () =>
    svc.compileSpecSchema({
      specSchema: {
        fields: [
          { key: 'a', type: 'STRING' },
          { key: 'a', type: 'STRING' },
        ],
      },
    }),
  'duplicate key',
  'duplicate key'
);
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: ['notanobject'] } }),
  'must be an object',
  'non-object field'
);
throws(
  () => svc.compileSpecSchema({ specSchema: { fields: [['a', 'b']] } }),
  'must be an object',
  'array field'
);

console.log('\n[4] reserved keys are rejected (they would shadow model fields)');
['price', 'status', 'availability', 'specs', 'location', '_id'].forEach((k) => {
  throws(
    () => svc.compileSpecSchema({ specSchema: { fields: [{ key: k, type: 'STRING' }] } }),
    'is reserved',
    "reserved key '" + k + "'"
  );
});

console.log('\n[5] cache invalidates on updatedAt, with no explicit bust');
{
  svc.clearSchemaCache();
  const t1 = new Date(1000);
  const t2 = new Date(2000);
  const a1 = svc.getCompiledSpecSchema({
    _id: 'cx',
    updatedAt: t1,
    specSchema: { fields: [{ key: 'v', type: 'NUMBER' }] },
  });
  const a2 = svc.getCompiledSpecSchema({
    _id: 'cx',
    updatedAt: t1,
    specSchema: { fields: [{ key: 'v', type: 'NUMBER' }] },
  });
  if (a1 === a2) ok('same (id, updatedAt) -> same cached schema object');
  else bad('cache did not return the same object');

  const before = svc._schemaCache.size;
  svc.getCompiledSpecSchema({
    _id: 'cx',
    updatedAt: t2,
    specSchema: { fields: [{ key: 'v', type: 'NUMBER' }] },
  });
  if (svc._schemaCache.size > before)
    ok('updatedAt change -> new cache entry (automatic invalidation)');
  else bad('updatedAt change did not create a new entry');

  // The whole point: an EDITED specSchema must be picked up with no bust call, even
  // when updatedAt has NOT moved (a bulk write or a script can change specSchema
  // without touching the timestamp). This is why the cache key hashes the fields.
  svc.clearSchemaCache();
  svc.getCompiledSpecSchema({
    _id: 'cy',
    updatedAt: t2,
    specSchema: { fields: [{ key: 'v', type: 'NUMBER' }] },
  });
  const edited = svc.getCompiledSpecSchema({
    _id: 'cy',
    updatedAt: t2,
    specSchema: { fields: [{ key: 'w', type: 'STRING' }] },
  });
  const r = edited.validate({ w: 'hello' });
  if (!r.error) ok('edited specSchema takes effect even with updatedAt UNCHANGED');
  else bad('stale schema served after edit: ' + r.error.message);

  // And the reverse: reverting must also take effect, not return the newer one.
  const reverted = svc.getCompiledSpecSchema({
    _id: 'cy',
    updatedAt: t2,
    specSchema: { fields: [{ key: 'v', type: 'NUMBER' }] },
  });
  if (!reverted.validate({ v: 3 }).error) ok('reverted specSchema also takes effect');
  else bad('revert served a stale schema');

  // Different categories must not share a cache entry.
  svc.clearSchemaCache();
  const p = svc.getCompiledSpecSchema({
    _id: 'cz',
    updatedAt: t1,
    specSchema: { fields: [{ key: 'v', type: 'NUMBER' }] },
  });
  const q = svc.getCompiledSpecSchema({
    _id: 'cz2',
    updatedAt: t1,
    specSchema: { fields: [{ key: 'v', type: 'NUMBER' }] },
  });
  if (p !== q) ok('different category ids -> different cache entries');
  else bad('two categories shared a cache entry');
}

console.log('\n[6] validateSpecs surfaces the category key and the field path');
{
  const cat = {
    key: 'APARTMENT',
    _id: 'c6',
    updatedAt: new Date(1000),
    specSchema: { fields: [{ key: 'bedrooms', type: 'NUMBER', required: true, min: 0 }] },
  };
  throws(() => svc.validateSpecs(cat, {}), 'APARTMENT', 'missing required names the category');
  throws(() => svc.validateSpecs(cat, { bedrooms: -1 }), 'bedrooms', 'bad value names the field');
  throws(
    () => svc.validateSpecs(cat, { bedrooms: 1, ghost: 2 }),
    'ghost',
    'unknown key is reported (stripUnknown:false)'
  );
  valid(() => svc.validateSpecs(cat, { bedrooms: 3 }), 'valid specs pass');
  const cleaned = svc.validateSpecs(cat, { bedrooms: '3' });
  if (cleaned.bedrooms === 3) ok('coerces "3" -> 3 (convert:true)');
  else bad('did not coerce, got ' + JSON.stringify(cleaned.bedrooms));

  // A category with no required fields must accept an absent specs object entirely â€”
  // that is the case that lets a PLOT with no optional values be created.
  const loose = {
    key: 'COMMERCIAL_LAND',
    _id: 'c6b',
    updatedAt: new Date(1000),
    specSchema: { fields: [{ key: 'roadWidth', type: 'NUMBER' }] },
  };
  valid(
    () => svc.validateSpecs(loose, undefined),
    'absent specs accepted when nothing is required'
  );
  valid(() => svc.validateSpecs(loose, null), 'null specs accepted when nothing is required');
  valid(() => svc.validateSpecs(loose, {}), 'empty specs accepted when nothing is required');
}

console.log('\n[7] amenity validation');
{
  const cat = { key: 'APARTMENT', amenityOptions: ['LIFT', 'GYM', 'CCTV'] };
  throws(
    () => svc.validateAmenities(cat, ['LIFT', 'SWIMMING_POOL']),
    'SWIMMING_POOL',
    'unknown amenity named'
  );
  const d = svc.validateAmenities(cat, ['GYM', 'LIFT', 'GYM']);
  if (JSON.stringify(d) === JSON.stringify(['GYM', 'LIFT']))
    ok('de-duplicated, order preserved -> ' + JSON.stringify(d));
  else bad('de-dup wrong: ' + JSON.stringify(d));
  if (JSON.stringify(svc.validateAmenities(cat, ['LIFT'])) === JSON.stringify(['LIFT']))
    ok('valid list passes through');
  if (JSON.stringify(svc.validateAmenities(cat, 'notanarray')) === '[]') ok('non-array -> []');
  throws(
    () => svc.validateAmenities({ key: 'X', amenityOptions: [] }, ['LIFT']),
    'Allowed: (none declared)',
    'category with no declared amenities'
  );
}

console.log('\n[8] validateSpecSchema â€” the admin write path');
{
  valid(() => svc.validateSpecSchema({ key: 'APARTMENT' }), 'minimal payload passes');
  valid(
    () => svc.validateSpecSchema({ key: 'COMMERCIAL_SHOP', transactionTypes: ['BUY', 'RENT'] }),
    'valid transactionTypes'
  );
  throws(() => svc.validateSpecSchema({ key: '' }), 'key is required', 'missing key');
  throws(() => svc.validateSpecSchema({ key: 'lowercase' }), 'UPPER_SNAKE_CASE', 'lowercase key');
  throws(
    () => svc.validateSpecSchema({ key: 'A', transactionTypes: [] }),
    'non-empty array',
    'empty transactionTypes'
  );
  throws(
    () => svc.validateSpecSchema({ key: 'A', transactionTypes: ['LEASE'] }),
    'LEASE',
    'unknown transactionType named'
  );
  throws(
    () => svc.validateSpecSchema({ key: 'A', specSchema: { fields: [{ key: 'x', type: 'BAD' }] } }),
    'is not one of',
    'broken descriptor rejected at category-save time'
  );
}

console.log('\n[9] the model itself');
{
  const m = Model;
  if (m.modelName === 'RealEstatePropertyCategory') ok('modelName = RealEstatePropertyCategory');
  else bad('modelName = ' + m.modelName);

  const idx = m.schema.indexes();
  const keyIdx = idx.find(([k]) => k.key === 1);
  if (keyIdx && keyIdx[1].unique) ok('key: 1 unique');
  else bad('key is not uniquely indexed');

  if (m.schema.path('slug').options.unique) ok('slug declared unique on the FIELD');
  else bad('slug not unique on the field');

  // Exactly ONE slug index, created by the field-level `unique: true`. Declaring it
  // again in schema.index() is the mistake that makes Mongoose warn about a duplicate
  // index on every boot - see the note in vertical.model.js.
  const slugIdx = idx.filter(([k]) => k.slug === 1);
  if (slugIdx.length === 1 && slugIdx[0][1].unique)
    ok('exactly one slug index, and it is unique (not double-declared)');
  else bad('slug indexes: ' + slugIdx.length + ' - expected exactly 1');

  // Duplicate key patterns would be rejected by Mongo on sync.
  const seen = new Set();
  const dupes = [];
  for (const [k] of idx) {
    const s = JSON.stringify(k);
    if (seen.has(s)) dupes.push(s);
    seen.add(s);
  }
  if (!dupes.length) ok(idx.length + ' indexes, all distinct key patterns');
  else bad('duplicate index on ' + dupes.join(' and '));

  if (m.schema.path('specSchema.fields').options.default === undefined)
    ok('specSchema.fields has no default');
  else bad('specSchema.fields has a default');
  if (m.schema.path('amenityOptions').options.default === undefined)
    ok('amenityOptions has no default');
  else bad('amenityOptions has a default');
  if (m.schema.path('requiresReview').options.default === true)
    ok('requiresReview defaults true (operator-created categories need review)');
  else bad('requiresReview default = ' + m.schema.path('requiresReview').options.default);
}

console.log('\n' + (failed === 0 ? 'ALL CATEGORY CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
process.exit(failed === 0 ? 0 : 1);
