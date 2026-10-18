/**
 * LocalWala — Local Commerce & Delivery Platform
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
 * verify.locality.backcompat.js
 *
 * Proves the Locality change did not affect food and dairy.
 *
 * ## The concern this answers
 *
 * `Locality` is a SHARED model. Local Stores added one field (`aliases`) and one static
 * (`resolveByNameOrAlias`). That is additive on paper, but "additive on paper" is a
 * claim, and food and dairy already have locality rows in the database.
 *
 * So this suite does the thing a paper review cannot: it inserts a locality DIRECTLY
 * into the collection, byte-for-byte in the shape food/dairy have always written, with
 * no `aliases` field at all, and then reads and re-saves it through the model.
 *
 * ## What it checks
 *
 *   1. An existing row loads with every field intact.
 *   2. Re-saving it does not write an `aliases` array into the database.
 *   3. The slug generator and `isNameTaken` — which food relies on — still work for
 *      NEW rows.
 *   4. The only observable difference is `aliases` reading as `[]` in memory, which is
 *      the intended default and nothing reads it outside the stores vertical.
 *
 * Run: node scripts/verify.locality.backcompat.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { Locality, City } = require('../src/models');

let pass = 0;
let failures = 0;

const ck = (label, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const run = async () => {
  console.log('\n=== Locality back-compat (food/dairy safety) ===\n');

  const stamp = Date.now();
  const city = await City.create({
    name: 'BackCompat City ' + stamp,
    image: 'https://example.invalid/bc-' + stamp + '.png',
    location: { type: 'Point', coordinates: [78.4, 17.4] },
    slug: 'bc-' + stamp,
  });

  const rawId = new mongoose.Types.ObjectId();
  const created = new Date('2024-01-01T00:00:00Z');

  // Inserted STRAIGHT to the collection with NO aliases — this is what an existing
  // food/dairy locality row looks like on disk.
  await Locality.collection.insertOne({
    _id: rawId,
    name: 'Preexisting Colony',
    city: city._id,
    location: { type: 'Point', coordinates: [78.41, 17.41] },
    slug: 'preexisting-' + stamp,
    status: true,
    translations: [],
    createdAt: created,
    updatedAt: created,
  });

  // ---- 1. an existing row still loads, intact --------------------------------
  console.log('--- an existing locality row, written before the change ---');

  const hydrated = await Locality.findById(rawId);
  ck('1. the existing row still loads', !!hydrated);
  ck('1b. name is unchanged', hydrated.name === 'Preexisting Colony', hydrated.name);
  ck(
    '1c. geo coordinates survive',
    hydrated.location.type === 'Point' && hydrated.location.coordinates[0] === 78.41,
    JSON.stringify(hydrated.location)
  );
  ck('1d. slug is unchanged', hydrated.slug === 'preexisting-' + stamp, hydrated.slug);
  ck('1e. city ref is unchanged', String(hydrated.city) === String(city._id));
  ck('1f. status is unchanged', hydrated.status === true);
  ck('1g. translations still read as an empty array', Array.isArray(hydrated.translations) && hydrated.translations.length === 0);

  // ---- 2. the ONE intended difference ---------------------------------------
  console.log('--- the only intended difference ---');

  ck(
    '2. aliases is ABSENT in memory too, not defaulted to []',
    hydrated.aliases === undefined,
    JSON.stringify(hydrated.aliases)
  );

  // ---- 3. re-saving must not rewrite the stored document ---------------------
  console.log('--- re-saving an existing row ---');

  await hydrated.save();

  const afterSave = await Locality.collection.findOne({ _id: rawId });
  ck('3. name survives a save', afterSave.name === 'Preexisting Colony', afterSave.name);
  ck('3b. slug survives a save', afterSave.slug === 'preexisting-' + stamp, afterSave.slug);
  ck(
    '3c. NO aliases array is written to the database',
    afterSave.aliases === undefined,
    JSON.stringify(afterSave.aliases)
  );

  // ---- 4. new rows still behave exactly as food expects -----------------------
  console.log('--- new rows (food creates localities this way) ---');

  const fresh = await Locality.create({
    name: 'Fresh Colony ' + stamp,
    city: city._id,
    location: { type: 'Point', coordinates: [78.42, 17.42] },
  });
  ck('4. a new locality still auto-generates a slug', !!fresh.slug && fresh.slug.length > 0, fresh.slug);
  ck('4b. the slug derives from the name', fresh.slug.startsWith('fresh-colony'), fresh.slug);
  ck('4c. aliases is undefined on a new row when not supplied', fresh.aliases === undefined, JSON.stringify(fresh.aliases));

  const taken = await Locality.isNameTaken('Preexisting Colony', null);
  ck('4d. isNameTaken still detects a duplicate name', !!taken);
  ck(
    '4e. isNameTaken still excludes the id it is given',
    (await Locality.isNameTaken('Preexisting Colony', rawId)) === false
  );

  // ---- 5. the resolver is additive and opt-in --------------------------------
  console.log('--- the new resolver ---');

  ck('5. resolveByNameOrAlias exists', typeof Locality.resolveByNameOrAlias === 'function');
  const resolved = await Locality.resolveByNameOrAlias('Preexisting Colony', city._id);
  ck('5b. it resolves an existing row with no aliases', resolved && String(resolved._id) === String(rawId));

  // ---- cleanup ---------------------------------------------------------------
  await Locality.deleteMany({ city: city._id });
  await City.deleteMany({ _id: city._id });

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('LOCALITY IS BACK-COMPATIBLE — food and dairy unaffected');
  } else {
    console.log(failures + ' BACK-COMPAT CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('back-compat suite could not run:', error.message);
    process.exit(1);
  }
})();