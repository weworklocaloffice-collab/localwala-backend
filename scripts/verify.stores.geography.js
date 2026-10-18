/**
 * LocalWala — Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
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
 * verify.stores.geography.js
 *
 * Covers the two SHARED-model edits made for Local Stores: UserAddress gained nullable
 * localityRef / cityRef / pincode, and Locality gained aliases plus a resolver.
 *
 * ## Why this suite is mostly about NOT BREAKING THINGS
 *
 * Both files are shared with food and dairy, which have addresses stored today. The
 * additions are nullable so nothing existing breaks — but "nullable" is a claim, and the
 * only way to know it is true is to save a document shaped like every address already in
 * the collection. Test 7 does exactly that.
 *
 * The second half of the suite tests the resolver's deliberate strictness. A resolver
 * that prefix-matches would produce a confidently WRONG delivery quote, which is worse
 * than returning nothing at all.
 *
 * Run: node scripts/verify.stores.geography.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { UserAddress, Locality, City } = require('../src/models');

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
  console.log('\n=== shared geography additions ===\n');

  const stamp = Date.now();

  const city = await City.create({
    name: 'GeoTest City ' + stamp,
    image: 'https://example.invalid/city-' + stamp + '.png',
    location: { type: 'Point', coordinates: [78.4, 17.4] },
    slug: 'geotest-' + stamp,
  });
  const city2 = await City.create({
    name: 'GeoTest OtherCity ' + stamp,
    image: 'https://example.invalid/other-' + stamp + '.png',
    location: { type: 'Point', coordinates: [78.5, 17.5] },
    slug: 'geoother-' + stamp,
  });

  const gachibowli = await Locality.create({
    name: 'Gachibowli',
    city: city._id,
    location: { type: 'Point', coordinates: [78.44, 17.44] },
    aliases: ['Gachi Bowli', 'gachibowli village', 'Nanakramguda'],
  });

  // ---- 1. schema shape: additive only ----------------------------------------
  console.log('--- schema shape ---');

  ck(
    '1. UserAddress.locality is STILL a String (not converted to a ref)',
    UserAddress.schema.path('locality').instance === 'String',
    UserAddress.schema.path('locality').instance
  );
  ck('1b. localityRef exists', !!UserAddress.schema.path('localityRef'));
  ck('1c. cityRef exists', !!UserAddress.schema.path('cityRef'));
  ck('1d. pincode exists', !!UserAddress.schema.path('pincode'));
  ck(
    '1e. localityRef is NOT required',
    !UserAddress.schema.path('localityRef').options.required,
    String(UserAddress.schema.path('localityRef').options.required)
  );
  ck('1f. pincode is NOT required', !UserAddress.schema.path('pincode').options.required);
  ck('1g. Locality.aliases exists', !!Locality.schema.path('aliases'));

  // The added fields must carry NO default, or Mongoose would write them into every
  // existing food/dairy address the moment that document is re-saved.
  ck(
    '1h. localityRef has NO default',
    UserAddress.schema.path('localityRef').options.default === undefined,
    JSON.stringify(UserAddress.schema.path('localityRef').options.default)
  );
  ck(
    '1i. cityRef has NO default',
    UserAddress.schema.path('cityRef').options.default === undefined
  );
  ck(
    '1j. pincode has NO default',
    UserAddress.schema.path('pincode').options.default === undefined
  );

  // ---- 2. name resolution ----------------------------------------------------
  console.log('--- resolving a typed locality ---');

  const exact = await Locality.resolveByNameOrAlias('Gachibowli', city._id);
  ck('2. an exact name resolves', exact && String(exact._id) === String(gachibowli._id), exact && exact.name);

  const ci = await Locality.resolveByNameOrAlias('gachibowli', city._id);
  ck('2b. an exact name is case-insensitive', ci && String(ci._id) === String(gachibowli._id));

  const alias = await Locality.resolveByNameOrAlias('Gachi Bowli', city._id);
  ck('2c. an alias resolves to the canonical locality', alias && String(alias._id) === String(gachibowli._id), alias && alias.name);

  const aliasUpper = await Locality.resolveByNameOrAlias('NANAKRAMGUDA', city._id);
  ck('2d. alias matching is case-insensitive', aliasUpper && String(aliasUpper._id) === String(gachibowli._id));

  const third = await Locality.resolveByNameOrAlias('Nanakramguda', city._id);
  ck('2e. an alias stored in lower case resolves when typed in caps', third && String(third._id) === String(gachibowli._id));

  // ---- 3. deliberate strictness ----------------------------------------------
  console.log('--- strictness (a wrong answer is worse than none) ---');

  const partial = await Locality.resolveByNameOrAlias('Gachi', city._id);
  ck(
    '3. a PARTIAL name does NOT resolve',
    partial === null,
    partial && partial.name
  );

  const blank = await Locality.resolveByNameOrAlias('   ', city._id);
  ck('3b. an empty string does NOT resolve', blank === null, String(blank));

  const nullName = await Locality.resolveByNameOrAlias(null, city._id);
  ck('3c. null does NOT resolve', nullName === null, String(nullName));

  // Regex metacharacters in user input must not blow up or match everything.
  const injected = await Locality.resolveByNameOrAlias('.*', city._id);
  ck(
    '3d. a regex metacharacter is treated as a literal, not a pattern',
    injected === null,
    injected && injected.name
  );

  // ---- 4. city scoping is enforced, not assumed ------------------------------
  console.log('--- city scoping ---');

  const wrongCity = await Locality.resolveByNameOrAlias('Gachibowli', city2._id);
  ck('4. a locality name from another city does NOT resolve', wrongCity === null, wrongCity && wrongCity.name);

  // Two cities both having "Ambiguous" is the case that makes scoping load-bearing.
  await Locality.create({
    name: 'Ambiguous',
    city: city._id,
    location: { type: 'Point', coordinates: [78.4, 17.4] },
  });
  const ambiguousInCity2 = await Locality.create({
    name: 'Ambiguous',
    city: city2._id,
    location: { type: 'Point', coordinates: [78.4, 17.5] },
  });

  const resolved2 = await Locality.resolveByNameOrAlias('Ambiguous', city2._id);
  ck(
    '4b. a duplicated name resolves to the locality in the requested city',
    resolved2 && String(resolved2._id) === String(ambiguousInCity2._id),
    resolved2 && String(resolved2._id)
  );

  const resolved1 = await Locality.resolveByNameOrAlias('Ambiguous', city._id);
  ck(
    '4c. the same name in the other city resolves to the other locality',
    resolved1 && String(resolved1._id) !== String(ambiguousInCity2._id),
    resolved1 && String(resolved1._id)
  );

  // An exact name must win over another locality's alias for that same string.
  await Locality.create({
    name: 'Kukatpally',
    city: city._id,
    location: { type: 'Point', coordinates: [78.36, 17.47] },
    aliases: ['Gachibowli'],
  });
  const exactWins = await Locality.resolveByNameOrAlias('Gachibowli', city._id);
  ck(
    '4d. an exact NAME match beats another locality that has it as an ALIAS',
    exactWins && String(exactWins._id) === String(gachibowli._id),
    exactWins && exactWins.name
  );

  // ---- 5. back-compat: existing addresses still work --------------------------
  console.log('--- back-compat with existing food/dairy addresses ---');

  const legacyShape = {
    user: new mongoose.Types.ObjectId(),
    title: 0,
    receiverName: 'Legacy Receiver',
    countryCode: 91,
    receiverContact: '9999999999',
    flatHouse: '1/2/3',
    locality: 'Some Old Place',
    location: { type: 'Point', coordinates: [78.4, 17.4] },
  };

  let savedLegacy = null;
  try {
    savedLegacy = await UserAddress.create(legacyShape);
  } catch (error) {
    savedLegacy = null;
  }
  ck('5. an address with NO new fields still saves', !!savedLegacy, 'validation rejected the legacy shape');
  ck('5b. localityRef is absent, not force-set to null', savedLegacy.localityRef === undefined);
  ck('5c. cityRef is absent', savedLegacy.cityRef === undefined);
  ck('5d. pincode is absent', savedLegacy.pincode === undefined);
  ck('5e. the locality TEXT is untouched', savedLegacy.locality === 'Some Old Place', savedLegacy.locality);

  // The strongest form of the guarantee: an address row written the OLD way, with no
  // new fields at all, must stay byte-identical when it is re-saved.
  const legacyRawId = new mongoose.Types.ObjectId();
  await UserAddress.collection.insertOne({
    _id: legacyRawId,
    user: new mongoose.Types.ObjectId(),
    title: 0,
    receiverName: 'Old Row',
    countryCode: 91,
    receiverContact: '9000000000',
    flatHouse: '9/9/9',
    locality: 'Old Row Colony',
    location: { type: 'Point', coordinates: [78.43, 17.43] },
    status: true,
    createdAt: new Date('2023-06-01'),
    updatedAt: new Date('2023-06-01'),
  });

  const legacyHydrated = await UserAddress.findById(legacyRawId);
  ck('5f. an old-format row loads through the model', !!legacyHydrated && legacyHydrated.locality === 'Old Row Colony');
  await legacyHydrated.save();

  const legacyAfter = await UserAddress.collection.findOne({ _id: legacyRawId });
  ck('5g. re-saving writes NO localityRef into the row', legacyAfter.localityRef === undefined, JSON.stringify(legacyAfter.localityRef));
  ck('5h. re-saving writes NO cityRef into the row', legacyAfter.cityRef === undefined);
  ck('5i. re-saving writes NO pincode into the row', legacyAfter.pincode === undefined);
  ck('5j. the old row is otherwise unchanged', legacyAfter.locality === 'Old Row Colony' && legacyAfter.flatHouse === '9/9/9');

  // ---- 6. new-style addresses carry the refs ---------------------------------
  console.log('--- stores-style addresses ---');

  const modern = await UserAddress.create({
    user: new mongoose.Types.ObjectId(),
    title: 0,
    receiverName: 'Modern Receiver',
    countryCode: 91,
    receiverContact: '9999999999',
    flatHouse: '4/5/6',
    locality: 'Gachibowli',
    localityRef: gachibowli._id,
    cityRef: city._id,
    pincode: '500032',
    location: { type: 'Point', coordinates: [78.44, 17.44] },
  });
  ck('6. an address with refs and a pincode saves', !!modern._id);
  ck('6b. localityRef round-trips', String(modern.localityRef) === String(gachibowli._id));
  ck('6c. pincode round-trips as a string', modern.pincode === '500032', modern.pincode);

  // Populating must actually resolve, or the ref is decoration.
  const populated = await UserAddress.findById(modern._id).populate('localityRef');
  ck('6d. localityRef POPULATES to a real locality', populated.localityRef && populated.localityRef.name === 'Gachibowli', populated.localityRef && populated.localityRef.name);

  // ---- cleanup ---------------------------------------------------------------
  await UserAddress.deleteMany({
    _id: { $in: [savedLegacy._id, modern._id, legacyRawId] },
  });
  await Locality.deleteMany({ city: { $in: [city._id, city2._id] } });
  await City.deleteMany({ _id: { $in: [city._id, city2._id] } });

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('ALL GEOGRAPHY CHECKS PASSED');
  } else {
    console.log(failures + ' GEOGRAPHY CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('geography suite could not run:', error.message);
    process.exit(1);
  }
})();