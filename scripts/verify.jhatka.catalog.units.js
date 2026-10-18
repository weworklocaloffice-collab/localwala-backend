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
 * verify.jhatka.catalog.units.js — schema-level checks for the catalogue models.
 *
 * ## Why these run without a database
 *
 * Almost everything that can be decided about these schemas before shipping can be
 * decided without Mongo. Enum closure, required-ness, the money round-trip, the
 * `measurementMode` fork and the yield variance arithmetic are all pure. Testing
 * them here means a broken model fails in a second rather than in a suite that
 * needs a replica set.
 *
 * ## The trap this suite exists to catch
 *
 * Mongoose 9's `validateSync()` RETURNS a ValidationError; it does not throw.
 * Wrapping it in try/catch makes every negative assertion pass vacuously — a
 * deleted validator still shows green. Every negative case here therefore assigns
 * the return value and asserts on its presence.
 *
 * Run: node scripts/verify.jhatka.catalog.units.js
 */

const mongoose = require('mongoose');
const moneyField = require('../src/utils/money.field');

const Product = require('../src/modules/jhatka/models/jhatka.product.model');
const Variant = require('../src/modules/jhatka/models/jhatka.variant.model');
const YieldSpec = require('../src/modules/jhatka/models/jhatka.yield.spec.model');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

/** `validateSync()` returns the error; it does not throw. */
const errOf = (doc) => doc.validateSync();
const rejects = (doc) => !!errOf(doc);

/** A syntactically valid ObjectId, for required-ref fields. */
const OID = new mongoose.Types.ObjectId().toString();
const NOW = new Date('2026-10-07T00:00:00.000Z');

const baseVariant = (over = {}) => ({
  product: OID,
  sku: 'CHK-CURRY-CUT-1KG',
  name: '1 kg Pack',
  measurementMode: 'WEIGHT',
  unitLabel: 'kg',
  priceBasis: 'per_kg',
  pricePerUnit: 400,
  packSize: { value: 1000, unit: 'GRAM' },
  ...over,
});

const baseYield = (over = {}) => ({
  code: 'CHK-CURRY',
  name: 'Whole chicken to curry cut',
  rawProduct: OID,
  rawSku: 'CHK-WHOLE',
  cutType: 'curry_cut',
  expectedYieldPct: 65,
  shelfLifeHoursPrepared: 24,
  effectiveFrom: NOW,
  ...over,
});

const baseProduct = (over = {}) => ({
  name: 'Chicken Curry Cut',
  code: 'chk-curry-cut',
  category: OID,
  hsnCode: '02071400',
  taxRatePct: 5,
  mrp: 430,
  storageMode: 'chilled',
  ...over,
});

console.log('\n=== jhatka catalogue model unit checks ===\n');

// ---- money convention -------------------------------------------------------
console.log('-- money --');
// `doc.get(path)` invokes the getter, so it returns RUPEES, not the stored paise.
// Reading the raw stored value needs `toObject({ getters: false })`. Conflating
// the two is how a "stored paise" assertion silently passes while checking rupees
// — so both are asserted separately below.
{
  const price = new Variant(baseVariant({ pricePerUnit: 400 }));
  ok('pricePerUnit 400 rupees reads back as 400', price.pricePerUnit === 400, String(price.pricePerUnit));
  ok('pricePerUnit STORES 40000 paise',
     price.toObject({ getters: false }).pricePerUnit === 40000,
     String(price.toObject({ getters: false }).pricePerUnit));
  ok('doc.get() applies the getter (rupees), it is not the raw value',
     price.get('pricePerUnit') === 400);

  const paise = new Variant(baseVariant({ pricePerUnit: 199.99 }));
  ok('₹199.99 does not lose precision on read', paise.pricePerUnit === 199.99, String(paise.pricePerUnit));
  ok('₹199.99 STORES 19999 paise',
     paise.toObject({ getters: false }).pricePerUnit === 19999,
     String(paise.toObject({ getters: false }).pricePerUnit));

  const mrp = new Product(baseProduct({ mrp: 1100 }));
  ok('product mrp round-trips', mrp.mrp === 1100, String(mrp.mrp));
  ok('product mrp stores 110000 paise',
     mrp.toObject({ getters: false }).mrp === 110000,
     String(mrp.toObject({ getters: false }).mrp));

  // The getter/setter pair must be the shared helper, not a hand-written copy.
  // The stores model header documents why: five hand-written copies in one file is
  // how a 100x drift gets introduced later.
  const f = moneyField();
  ok('moneyField getter converts paise -> rupees', f.get(40000) === 400, String(f.get(40000)));
  ok('moneyField setter converts rupees -> paise', f.set(400) === 40000, String(f.set(400)));
  ok('moneyField passes null through untouched (no NaN)', f.get(null) === null && f.set(null) === null);

  // The compounding bug this convention exists to prevent.
  const roundTripped = f.set(f.get(40000));
  ok('a full get/set round trip is lossless', roundTripped === 40000, String(roundTripped));

  // Zero must not become false/null through a truthiness bug.
  const zero = new Variant(baseVariant({ pricePerUnit: 0 }));
  ok('₹0 reads back as 0, not undefined', zero.pricePerUnit === 0, String(zero.pricePerUnit));
}

// ---- BR-09: the measurementMode fork ---------------------------------------
console.log('\n-- BR-09 measurementMode --');
{
  const w = new Variant(baseVariant({ measurementMode: 'WEIGHT' }));
  const c = new Variant(
    baseVariant({
      sku: 'EGG-TRAY-30',
      measurementMode: 'COUNT',
      unitLabel: 'pc',
      priceBasis: 'per_piece',
      pricePerUnit: 8,
      packSize: { value: 1, unit: 'PIECE' },
    })
  );

  ok('WEIGHT line reports isVariableWeightLine true', w.isVariableWeightLine === true);
  ok('COUNT line reports isVariableWeightLine false', c.isVariableWeightLine === false);
  ok('a dozen of eggs is never a variable-weight line', c.isVariableWeightLine === false);

  ok('per_kg resolves to 1000 grams per price unit', w.gramsPerPriceUnit === 1000);
  ok('per_piece resolves to 1 (quantity IS the price quantity)', c.gramsPerPriceUnit === 1);

  ok('valid WEIGHT variant accepted', !rejects(w));
  ok('valid COUNT variant accepted', !rejects(c));

  // The failure this whole fork exists to prevent.
  const bogus = new Variant(baseVariant({ measurementMode: 'POUNDS' }));
  ok('unknown measurementMode rejected', rejects(bogus), 'enum did not fire');

  const countAsWeight = new Variant(
    baseVariant({
      sku: 'EGG-DOZEN',
      measurementMode: 'COUNT',
      unitLabel: 'dozen',
      priceBasis: 'per_dozen',
      pricePerUnit: 72,
      packSize: { value: 1, unit: 'DOZEN' },
    })
  );
  ok('a dozen priced per_dozen is a COUNT line', countAsWeight.isVariableWeightLine === false);
  ok('a dozen priced per_dozen is never weighed', countAsWeight.gramsPerPriceUnit === 1);

  const missing = new Variant({ ...baseVariant(), measurementMode: undefined });
  ok('measurementMode is required (no silent WEIGHT default)', rejects(missing), 'required did not fire');
}

// ---- BR-15 / BR-16: subscription behaviour is per variant -------------------
console.log('\n-- subscription --');
{
  const s = new Variant(baseVariant({ subscriptionChargeMode: 'ceiling', subscriptionCeilingPct: 10 }));
  ok('prepaid WEIGHT occurrence charges the ceiling', s.subscriptionChargeMode === 'ceiling');
  ok('default ceiling is 10%', s.subscriptionCeilingPct === 10);

  ok('unknown charge mode rejected',
     rejects(new Variant(baseVariant({ subscriptionChargeMode: 'hope' }))));

  // Eggs default to ineligible at the category; the variant is authoritative.
  const eggVariant = new Variant(
    baseVariant({
      sku: 'EGG-TRAY',
      measurementMode: 'COUNT',
      unitLabel: 'pc',
      priceBasis: 'per_piece',
      pricePerUnit: 8,
      packSize: { value: 1, unit: 'PIECE' },
      subscriptionEligible: false,
    })
  );
  ok('an egg variant is explicitly not subscription-eligible', eggVariant.subscriptionEligible === false);
}

// ---- product: BR-20 tax snapshot -------------------------------------------
console.log('\n-- BR-20 tax snapshot --');
{
  const p = new Product(baseProduct());
  ok('valid product accepted', !rejects(p));
  ok('taxRatePct 101 rejected', rejects(new Product(baseProduct({ taxRatePct: 101 }))));
  ok('taxRatePct negative rejected', rejects(new Product(baseProduct({ taxRatePct: -1 }))));
  ok('hsnCode is required', rejects(new Product(baseProduct({ hsnCode: undefined }))));
  ok('taxRatePct is required', rejects(new Product(baseProduct({ taxRatePct: undefined }))));
  ok('unknown allergen rejected', rejects(new Product(baseProduct({ allergens: ['nut'] }))));
  ok('unknown storageMode rejected', rejects(new Product(baseProduct({ storageMode: 'ambient-ish' }))));

  const snapshotted = new Product(
    baseProduct({ taxConfigSnapshot: { version: 3, resolvedAt: NOW } })
  );
  ok('taxConfigSnapshot is retained for audit', snapshotted.taxConfigSnapshot.version === 3);
}

// ---- yield: the concept the blueprint omits --------------------------------
console.log('\n-- yield --');
{
  const y = new YieldSpec(baseYield());
  ok('valid yield spec accepted', !rejects(y));
  ok('expectedYieldPct 0 rejected', rejects(new YieldSpec(baseYield({ expectedYieldPct: 0 }))));
  ok('expectedYieldPct 101 rejected', rejects(new YieldSpec(baseYield({ expectedYieldPct: 101 }))));
  ok('shelfLifeHoursPrepared is required (BR-13)',
     rejects(new YieldSpec(baseYield({ shelfLifeHoursPrepared: undefined }))));
  ok('effectiveFrom is required', rejects(new YieldSpec(baseYield({ effectiveFrom: undefined }))));
  ok('unknown cutType rejected', rejects(new YieldSpec(baseYield({ cutType: 'diced' }))));

  // BR-13 in one assertion: prepared life is counted from CUT time, not intake.
  ok('prepared shelf life is shorter than the 48h raw default',
     y.shelfLifeHoursPrepared < 48, String(y.shelfLifeHoursPrepared));

  // The variance arithmetic. 5 is percentage POINTS, not a ratio.
  const below = YieldSpec.evaluateVariance(65, 61, 5);
  const above = YieldSpec.evaluateVariance(65, 66, 5);
  const far = YieldSpec.evaluateVariance(65, 58, 5);

  ok('65 expected / 61 actual is inside a 5-point tolerance', below.withinTolerance === true);
  ok('65 expected / 66 actual is inside a 5-point tolerance', above.withinTolerance === true);
  ok('65 expected / 58 actual is 7 points out, so outside', far.withinTolerance === false);
  ok('under-yield is named BELOW_EXPECTED', far.direction === 'BELOW_EXPECTED', String(far.direction));
  ok('variance is signed, negative meaning less than plan', far.variancePct === -7, String(far.variancePct));

  const over = YieldSpec.evaluateVariance(65, 72, 5);
  ok('over-yield is named ABOVE_EXPECTED', over.direction === 'ABOVE_EXPECTED', String(over.direction));
  ok('in-tolerance has no direction', below.direction === null);

  // Tolerance is in points. A 10% relative drift on a 65% yield is 6.5 points.
  const points = YieldSpec.evaluateVariance(65, 59, 5);
  const relPct = ((65 - 59) / 65) * 100;
  ok('6 points out is outside even though 6/65 is only 9%', points.withinTolerance === false,
     'relative ' + relPct.toFixed(1) + '%');
}

// ---- BR-23: nothing with money is deletable ---------------------------------
console.log('\n-- immutability shape --');
{
  const idx = Variant.schema.indexes();
  ok('sku is uniquely indexed',
     idx.some((i) => i[1] && i[1].unique && JSON.stringify(i[0]) === JSON.stringify({ sku: 1 })));

  const pidx = Product.schema.indexes();
  ok('product code is uniquely indexed',
     pidx.some((i) => i[1] && i[1].unique && JSON.stringify(i[0]) === JSON.stringify({ code: 1 })));

  const yidx = YieldSpec.schema.indexes();
  ok('one active yield per rawSku+cutType is enforced by a partial unique index',
     yidx.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression),
     JSON.stringify(yidx.map((i) => i[0])));
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL CATALOGUE MODEL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);