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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * Public search and visibility verification. **Live, against MongoDB.**
 *
 * Run:  node scripts/verify.realestate.search.js
 *
 * ## What it proves that a unit test cannot
 *
 *   1. **`PUBLISHED` is not optional.** A DRAFT, IN_REVIEW and ARCHIVED property are
 *      all excluded from search. This is BR-03, and the failure mode is a vendor's
 *      unverified draft appearing in a customer's results.
 *   2. **`ON_HOLD` is visible but `SOLD`/`RENTED` are not.** Blueprint §49 — a held
 *      unit must stay findable or a customer who saw it yesterday telephones support.
 *   3. **`priceOnRequest` is excluded from a price-bounded filter.** Otherwise a
 *      "price on request" listing matches every range, which is answering a different
 *      question than the customer asked.
 *   4. **`spec_$_` injection is blocked.** `buildPublicFilter` rejects a key not in any
 *      active category's `filterableKeys`, so `?spec_$gt=` cannot reach the query.
 *   5. **The radius search matches §12 and excludes the far pin**, and the ceiling
 *      actually caps.
 *   6. **`verificationSummary` returns document TYPES only** — no ids, no urls.
 *
 * ## Cleanup
 *
 * Inserted rows are tracked and deleted in a `finally`. It writes to the same
 * `foodbite` database the app uses, so this matters.
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const RealEstateProperty = require('../src/modules/realestate/models/realestate.property.model');
const RealEstatePropertyDocument = require('../src/modules/realestate/models/realestate.property.document.model');
const categoryService = require('../src/modules/realestate/services/realestate.category.service');
const searchService = require('../src/modules/realestate/services/realestate.property.search.service');
const documentAccess = require('../src/modules/realestate/middlewares/realestate.document.access');
const {
  extractSpecFilters,
} = require('../src/modules/realestate/validations/realestate.public.validation');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  console.log('  FAIL ' + m);
};

const touchedProps = [];
const touchedDocs = [];
const oid = () => new mongoose.Types.ObjectId();

const HYD = [78.4867, 17.385];
const BOM = [72.8777, 19.076];

const base = (over) => ({
  source: 'LOCALWALA_DIRECT',
  transactionType: 'BUY',
  title: 'x',
  status: 'DRAFT',
  availability: 'AVAILABLE',
  location: { type: 'Point', coordinates: HYD },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const seed = async (over) => {
  const r = await RealEstateProperty.collection.insertOne(base(over));
  touchedProps.push(r.insertedId);
  return r.insertedId;
};

/** Run a search and return the ids. */
const searchIds = async (query) => {
  const filter = await searchService.buildPublicFilter(extractSpecFilters(query));
  return (await RealEstateProperty.find(filter).select('_id').lean()).map((d) => String(d._id));
};

const run = async () => {
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGODB_URL not set');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });

  const apartment = await categoryService.findByKey('APARTMENT');
  if (!apartment) throw new Error('Run scripts/seed.realestate.categories.js first');

  console.log('\n[1] BR-03 — only PUBLISHED is returned by search');
  {
    const draft = await seed({
      category: apartment._id,
      status: 'DRAFT',
      propertyCode: 'RE-QQQ-000001',
    });
    const inReview = await seed({
      category: apartment._id,
      status: 'IN_REVIEW',
      propertyCode: 'RE-QQQ-000002',
    });
    const archived = await seed({
      category: apartment._id,
      status: 'ARCHIVED',
      propertyCode: 'RE-QQQ-000003',
    });
    const published = await seed({
      category: apartment._id,
      status: 'PUBLISHED',
      availability: 'AVAILABLE',
      propertyCode: 'RE-QQQ-000004',
    });

    const ids = await searchIds({ category: apartment._id, limit: 50 });

    if (ids.includes(String(published))) ok('a PUBLISHED property is returned');
    else bad('PUBLISHED property missing from search');
    [
      ['DRAFT', draft],
      ['IN_REVIEW', inReview],
      ['ARCHIVED', archived],
    ].forEach(([label, id]) => {
      if (ids.includes(String(id))) bad(label + ' property LEAKED into public search');
      else ok(label + ' property correctly excluded');
    });
  }

  console.log('\n[2] blueprint §49 — ON_HOLD visible, SOLD/RENTED/SUSPENDED hidden');
  {
    const cat = apartment._id;
    const mk = async (avail, code) =>
      seed({ category: cat, status: 'PUBLISHED', availability: avail, propertyCode: code });
    const avail = await mk('AVAILABLE', 'RE-QQQ-000011');
    const held = await mk('ON_HOLD', 'RE-QQQ-000012');
    const sold = await mk('SOLD', 'RE-QQQ-000013');
    const rented = await mk('RENTED', 'RE-QQQ-000014');
    const suspended = await mk('SUSPENDED', 'RE-QQQ-000015');

    const ids = await searchIds({ category: cat, limit: 50 });
    const has = (id) => ids.includes(String(id));

    if (has(avail)) ok('AVAILABLE -> visible');
    else bad('AVAILABLE missing');
    if (has(held)) ok('ON_HOLD -> VISIBLE (a held unit stays findable)');
    else bad('ON_HOLD hidden — a customer who saw it yesterday cannot find it today');
    [
      ['SOLD', sold],
      ['RENTED', rented],
      ['SUSPENDED', suspended],
    ].forEach(([label, id]) => {
      if (has(id)) bad(label + ' LEAKED into search');
      else ok(label + ' -> hidden');
    });
  }

  console.log('\n[3] priceOnRequest is excluded from a price-bounded filter');
  {
    const cat = apartment._id;
    const priced = await seed({
      category: cat,
      status: 'PUBLISHED',
      price: 5000000,
      propertyCode: 'RE-QQQ-000021',
    });
    const onRequest = await seed({
      category: cat,
      status: 'PUBLISHED',
      price: 0,
      priceOnRequest: true,
      propertyCode: 'RE-QQQ-000022',
    });

    const bounded = await searchIds({
      category: cat,
      priceMin: 100,
      priceMax: 100000000,
      limit: 50,
    });
    if (bounded.includes(String(priced))) ok('a priced listing matches a price range');
    else bad('priced listing missing from a price-bounded search');
    if (bounded.includes(String(onRequest)))
      bad('priceOnRequest LEAKED into a price-bounded search');
    else ok('priceOnRequest excluded from a price-bounded search');

    // With no price filter it must still be findable — it is a real listing.
    const unbounded = await searchIds({ category: cat, limit: 50 });
    if (unbounded.includes(String(onRequest)))
      ok('priceOnRequest IS returned when no price filter is applied');
    else bad('priceOnRequest missing from an unfiltered search');
  }

  console.log('\n[4] spec filter injection is blocked');
  {
    const cat = apartment._id;

    // Two different defences, tested differently.
    //
    //   malformed key (`spec_$gt`)      -> the wire pattern refuses it, so it never
    //                                      becomes a spec at all. The security property
    //                                      is that it does NOT reach the query — not
    //                                      that it throws.
    //   well-formed unknown key         -> reaches the service and is rejected there,
    //   (`spec_evil`)                     because it is in no category's filterableKeys.
    const malformed = ['$gt', '$ne', '$where', '$regex', '__proto__', 'a$b', 'a.b'];
    for (const key of malformed) {
      const extracted = extractSpecFilters({ [`spec_${key}`]: 1, category: cat });
      const hasSpecs = extracted.specs && Object.keys(extracted.specs).length > 0;
      // eslint-disable-next-line no-await-in-loop
      const filter = await searchService.buildPublicFilter(extracted);
      const reached = Object.keys(filter).some((k) => k.startsWith('specs.'));

      if (hasSpecs || reached) bad(`spec_${key} WAS ACCEPTED into the query`);
      else ok(`spec_${key} dropped before the query — never became a filter key`);
    }

    const wellFormedUnknown = ['evil', 'constructor', 'prototype'];
    for (const key of wellFormedUnknown) {
      const extracted = extractSpecFilters({ [`spec_${key}`]: 1, category: cat });
      const hasSpecs = extracted.specs && Object.keys(extracted.specs).length > 0;
      if (hasSpecs) {
        // eslint-disable-next-line no-await-in-loop
        try {
          await searchService.buildPublicFilter(extracted);
          bad(`spec_${key} reached the query and was ACCEPTED`);
        } catch (e) {
          ok(`spec_${key} rejected by the allowlist -> "${e.message.slice(0, 46)}..."`);
        }
      } else {
        ok(`spec_${key} dropped before the query`);
      }
    }

    // Prototype pollution. `__proto__` cannot pass the wire pattern, but the
    // accumulator is null-prototype and the key list is explicit precisely so that
    // remains true if the pattern is ever loosened.
    const beforeMin = {}.min;
    extractSpecFilters({ spec___proto___min: 1, spec___proto__: 2, spec_constructor_min: 3 });
    const plain = {};
    if (plain.min === beforeMin && Object.prototype.min === undefined) {
      ok('no prototype pollution: Object.prototype untouched');
    } else {
      bad('PROTOTYPE POLLUTION — Object.prototype gained a property');
    }
  }

  console.log('\n[5] a real filterable spec key is accepted and narrows results');
  {
    const cat = apartment._id;
    const threeBhk = await seed({
      category: cat,
      status: 'PUBLISHED',
      specs: { bedrooms: 3 },
      propertyCode: 'RE-QQQ-000031',
    });
    const twoBhk = await seed({
      category: cat,
      status: 'PUBLISHED',
      specs: { bedrooms: 2 },
      propertyCode: 'RE-QQQ-000032',
    });

    const ids = await searchIds({ category: cat, spec_bedrooms: 3, limit: 50 });
    if (ids.includes(String(threeBhk)) && !ids.includes(String(twoBhk))) {
      ok('spec_bedrooms=3 returned the 3BHK and excluded the 2BHK');
    } else {
      bad('spec filter did not narrow correctly; got ' + ids.length + ' results');
    }

    // A range on a numeric spec.
    const ranged = await searchIds({ category: cat, spec_bedrooms_min: 3, limit: 50 });
    if (ranged.includes(String(threeBhk)) && !ranged.includes(String(twoBhk))) {
      ok('spec_bedrooms_min=3 behaved as a range');
    } else {
      bad('spec range filter failed');
    }
  }

  console.log('\n[6] priceMin > priceMax is rejected');
  {
    try {
      await searchService.buildPublicFilter({ priceMin: 9000000, priceMax: 100000 });
      bad('an inverted price range was accepted');
    } catch (e) {
      ok('inverted price range rejected -> "' + e.message.slice(0, 58) + '..."');
    }
  }

  console.log('\n[7] radius search: composition, exclusion, and the ceiling');
  {
    const cat = apartment._id;
    const near = await seed({
      category: cat,
      status: 'PUBLISHED',
      location: { type: 'Point', coordinates: HYD },
      propertyCode: 'RE-QQQ-000041',
    });
    const far = await seed({
      category: cat,
      status: 'PUBLISHED',
      location: { type: 'Point', coordinates: BOM },
      propertyCode: 'RE-QQQ-000042',
    });

    const ids = await searchIds({
      category: cat,
      lng: 78.5,
      lat: 17.4,
      radiusMeters: 5000,
      limit: 50,
    });
    if (ids.includes(String(near)) && !ids.includes(String(far)))
      ok('$geoWithin 5 km around Hyderabad returned only the near pin');
    else bad('radius filter wrong');

    // The ceiling must cap an absurd request rather than honour it.
    const capMetres = searchService.maxRadiusMeters();
    if (capMetres === 50000) ok('default search radius ceiling is 50 km (' + capMetres + ' m)');
    else bad('unexpected ceiling: ' + capMetres);

    const huge = await searchIds({
      category: cat,
      lng: 78.5,
      lat: 17.4,
      radiusMeters: 999999999,
      limit: 50,
    });
    if (!huge.includes(String(far)))
      ok('an over-ceiling radius was CAPPED (Mumbai still excluded)');
    else bad('the ceiling was not applied — an unbounded radius was honoured');

    // nearby() uses $near and must order by distance. Asserted as a monotonicity
    // property rather than "the first result is X", because earlier sections leave
    // other PUBLISHED pins at the same coordinates — an assertion on a specific id
    // would be testing the fixture, not the sort.
    const nearList = await searchService.nearby(78.5, 17.4, { category: cat, limit: 10 });
    const hav = (a, b) => {
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(b[1] - a[1]);
      const dLng = toRad(b[0] - a[0]);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
      return 2 * 6378137 * Math.asin(Math.min(1, Math.sqrt(h)));
    };
    const distances = nearList.map((d) => hav([78.5, 17.4], d.location.coordinates));
    const monotonic = distances.every((d, i) => i === 0 || d >= distances[i - 1] - 1e-6);
    if (nearList.length && monotonic) {
      ok(
        'nearby() results are ordered nearest-first (' +
          nearList.length +
          ' rows, ' +
          Math.round(distances[0]) +
          'm ... ' +
          Math.round(distances[distances.length - 1]) +
          'm)'
      );
    } else {
      bad('nearby() ordering is not monotonic: ' + distances.map((d) => Math.round(d)).join(', '));
    }
    if (nearList.some((d) => String(d._id) === String(near)))
      ok('nearby() includes the pin inside the radius');
    else bad('nearby() missed the pin inside the radius');
    if (!nearList.some((d) => String(d._id) === String(far)))
      ok('nearby() excluded the 620 km pin');
    else bad('nearby() included a pin outside the radius');
  }

  console.log('\n[8] bad coordinates are rejected');
  {
    for (const [lng, lat, label] of [
      [0, 0, '(0,0)'],
      [200, 17, 'lng 200'],
      [78, 100, 'lat 100'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      try {
        await searchService.nearby(lng, lat, {});
        bad('nearby() accepted ' + label);
      } catch (e) {
        ok('nearby() rejected ' + label);
      }
    }
    // eslint-disable-next-line no-await-in-loop
    try {
      await searchService.nearby(undefined, 17, {});
      bad('nearby() accepted undefined lng');
    } catch (e) {
      ok('nearby() rejected undefined lng');
    }
  }

  console.log('\n[9] BR-18 — verificationSummary returns TYPES only, never files');
  {
    const prop = await RealEstateProperty.findById(
      await seed({
        category: apartment._id,
        status: 'PUBLISHED',
        verifiedAt: new Date(),
        propertyCode: 'RE-QQQ-000051',
      })
    ).lean();

    const mkDoc = async (category, visibility, status) => {
      const r = await RealEstatePropertyDocument.collection.insertOne({
        property: prop._id,
        category,
        visibility,
        status,
        title: 'Secret Deed',
        fileUrl: 'https://cdn.example.com/secret.pdf',
        fileName: 'secret.pdf',
        checksum: 'abc123',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      touchedDocs.push(r.insertedId);
      return r;
    };
    await mkDoc('OWNERSHIP', 'CUSTOMER_VISIBLE', 'ACCEPTED');
    await mkDoc('APPROVAL', 'CUSTOMER_VISIBLE', 'ACCEPTED');
    await mkDoc('TAX', 'ADMIN_ONLY', 'ACCEPTED');
    await mkDoc('ENCUMBRANCE', 'CUSTOMER_VISIBLE', 'PENDING');

    // Exactly what the customer route does: scope the read by actor, then summarise.
    const guestAccess = documentAccess.buildQuery('guest', prop._id);
    const docs = await RealEstatePropertyDocument.find(guestAccess)
      .select('category visibility status')
      .lean();
    const summary = searchService.verificationSummary(prop, docs);

    if (summary.verified === true) ok('verified flag reflects verifiedAt');
    else bad('verified flag wrong');

    const cleared = summary.documentsCleared;
    if (cleared.includes('OWNERSHIP') && cleared.includes('APPROVAL'))
      ok('cleared types include OWNERSHIP and APPROVAL');
    else bad('cleared types = ' + JSON.stringify(cleared));

    if (!cleared.includes('TAX')) ok('ADMIN_ONLY document excluded for a guest');
    else bad('ADMIN_ONLY document LEAKED into the public summary');

    if (!cleared.includes('ENCUMBRANCE')) ok('a PENDING document is not reported as cleared');
    else bad('PENDING document reported as cleared');

    const serialised = JSON.stringify(summary);
    if (!/fileUrl|secret\.pdf|cdn\.example|abc123/.test(serialised))
      ok('the summary contains NO url, filename or checksum');
    else bad('the summary leaked a file reference: ' + serialised);
  }

  console.log('\n' + (failed === 0 ? 'ALL SEARCH CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
};

run()
  .catch((e) => {
    console.error('\nLIVE SEARCH VERIFY FAILED:', e.message);
    failed++;
  })
  .finally(async () => {
    try {
      if (touchedDocs.length)
        await RealEstatePropertyDocument.collection.deleteMany({ _id: { $in: touchedDocs } });
      if (touchedProps.length)
        await RealEstateProperty.collection.deleteMany({ _id: { $in: touchedProps } });
      console.log(
        '\ncleanup: removed ' +
          touchedDocs.length +
          ' document(s), ' +
          touchedProps.length +
          ' propert(ies)'
      );
    } catch (e) {
      console.error('CLEANUP FAILED — check for leftover test rows:', e.message);
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(failed === 0 ? 0 : 1);
  });
