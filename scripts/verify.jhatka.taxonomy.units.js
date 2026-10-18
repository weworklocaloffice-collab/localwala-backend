const C = require('../src/modules/jhatka/models/jhatka.category.model');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

console.log('\n=== jhatka.category.model unit checks ===\n');

console.log('LAUNCH  :', C.LAUNCH_CATEGORY_KEYS.join(', '));
console.log('RESERVED:', C.RESERVED_CATEGORY_KEYS.join(', '));
console.log('');

ok('LAUNCH_CATEGORY_KEYS has exactly 4', C.LAUNCH_CATEGORY_KEYS.length === 4, String(C.LAUNCH_CATEGORY_KEYS.length));
ok('RESERVED_CATEGORY_KEYS has exactly 4', C.RESERVED_CATEGORY_KEYS.length === 4, String(C.RESERVED_CATEGORY_KEYS.length));
ok('launch and reserved sets do not overlap', !C.LAUNCH_CATEGORY_KEYS.some((k) => C.RESERVED_CATEGORY_KEYS.includes(k)));

['assertLaunchSet', 'assertNoReservedLeak', 'findTree', 'findRoots'].forEach((s) => {
  ok('static ' + s + ' exists', typeof C[s] === 'function');
});

const root = new C({ key: 'chicken', name: 'Chicken' });
const child = new C({ key: 'curry_cut', name: 'Curry Cut', parent: '507f1f77bcf86cd799439011' });

ok('root.isSubCategory is false', root.isSubCategory === false);
ok('child.isSubCategory is true', child.isSubCategory === true);

ok('pattern accepts curry_cut', C.CATEGORY_KEY_PATTERN.test('curry_cut'));
ok('pattern accepts fish_seafood', C.CATEGORY_KEY_PATTERN.test('fish_seafood'));
ok('pattern rejects KebabCase', !C.CATEGORY_KEY_PATTERN.test('KebabCase'));
ok('pattern rejects leading digit', !C.CATEGORY_KEY_PATTERN.test('1chicken'));
ok('pattern rejects hyphen', !C.CATEGORY_KEY_PATTERN.test('curry-cut'));
ok('pattern rejects empty', !C.CATEGORY_KEY_PATTERN.test(''));

// ---- inheritance ------------------------------------------------------------
const parentDoc = {
  defaultMeasurementMode: 'WEIGHT',
  shelfLifeHoursRaw: 48,
  shelfLifeHoursPrepared: 24,
  subscriptionEligibleByDefault: false,
  allergens: [],
  weightPolicy: { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 2, codTolerancePct: 10 },
};

const inheriting = new C({ key: 'curry_cut', name: 'Curry Cut', parent: 'x' });
const p1 = inheriting.effectiveProfile(parentDoc);
ok('child inherits measurementMode', p1.defaultMeasurementMode === 'WEIGHT', String(p1.defaultMeasurementMode));
ok('child inherits shelfLifeHoursRaw', p1.shelfLifeHoursRaw === 48, String(p1.shelfLifeHoursRaw));
ok('child inherits weightPolicy', p1.weightPolicy.tolerancePct === 5, String(p1.weightPolicy.tolerancePct));

const overriding = new C({ key: 'prawns', name: 'Prawns', parent: 'x', defaultMeasurementMode: 'COUNT' });
const p2 = overriding.effectiveProfile(parentDoc);
ok('child override beats parent', p2.defaultMeasurementMode === 'COUNT', String(p2.defaultMeasurementMode));

// A COUNT subcategory under a WEIGHT parent is the prawn case: it must stay COUNT.
ok('prawns under fish stays COUNT', p2.defaultMeasurementMode === 'COUNT');

// Explicit false must survive, not fall back to the parent's value.
const clears = new C({ key: 'boneless', name: 'Boneless', parent: 'x', subscriptionEligibleByDefault: true });
const p3 = clears.effectiveProfile({ ...parentDoc, subscriptionEligibleByDefault: true });
ok('explicit false is not replaced by parent', p3.subscriptionEligibleByDefault === true, String(p3.subscriptionEligibleByDefault));

const weightOverride = new C({ key: 'prawns', name: 'P', parent: 'x', weightPolicy: { tolerancePct: 2 } });
const p4 = weightOverride.effectiveProfile(parentDoc);
ok('child weightPolicy merges field-by-field', p4.weightPolicy.tolerancePct === 2 && p4.weightPolicy.codTolerancePct === 10,
   JSON.stringify(p4.weightPolicy));

// ---- enum validation --------------------------------------------------------
let allergensOk = true;
const aErr = new C({ key: 'x', name: 'X', allergens: ['egg', 'fish'] }).validateSync();
if (aErr) allergensOk = false;
ok('valid allergens accepted', allergensOk);

// Mongoose 9: `validateSync()` RETURNS the ValidationError rather than throwing.
// Wrapping it in try/catch silently passes every negative case, which is how a
// broken validator survives a green suite. Assign the return value and assert on it.
const validateErr = (doc) => doc.validateSync();

ok('valid allergens accepted', validateErr(new C({ key: 'x', name: 'X', allergens: ['egg', 'fish'] })) === undefined);
ok(
  'misspelled allergen rejected',
  !!validateErr(new C({ key: 'x', name: 'X', allergens: ['fishs'] })),
  'validator did not fire'
);
ok(
  'unknown measurementMode rejected',
  !!validateErr(new C({ key: 'x', name: 'X', defaultMeasurementMode: 'POUNDS' })),
  'validator did not fire'
);
ok('empty allergens accepted', validateErr(new C({ key: 'x', name: 'X', allergens: [] })) === undefined);
ok(
  'missing required name rejected',
  !!validateErr(new C({ key: 'x' })),
  'required did not fire'
);
// Mongoose applies `lowercase: true` BEFORE validators run, so `KebabCase` is
// cast to `kebabcase` and is legitimately a valid key. The validator is only
// reachable for shapes the cast cannot repair — a hyphen, a leading digit, an
// empty string. Asserting that `KebabCase` is *rejected* would encode a wrong
// expectation and would eventually be "fixed" by deleting the lowercase cast.
ok(
  'key cast normalises KebabCase to kebabcase',
  new C({ key: 'KebabCase', name: 'X' }).key === 'kebabcase',
  'got ' + new C({ key: 'KebabCase', name: 'X' }).key
);
ok(
  'hyphenated key rejected (cast cannot repair it)',
  !!validateErr(new C({ key: 'curry-cut', name: 'X' })),
  'key validator did not fire'
);
ok(
  'key with leading digit rejected',
  !!validateErr(new C({ key: '1chicken', name: 'X' })),
  'key validator did not fire'
);
ok(
  'empty key rejected',
  !!validateErr(new C({ key: '', name: 'X' })),
  'key validator did not fire'
);

// ---- index sanity -----------------------------------------------------------
const idx = C.schema.indexes();
ok('unique (parent, key) index exists',
   idx.some((i) => i[1] && i[1].unique && JSON.stringify(i[0]) === JSON.stringify({ parent: 1, key: 1 })),
   JSON.stringify(idx.map((i) => i[0])));

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL CATEGORY MODEL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);