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
 * Live index and invariant verification for the Real Estate catalogue models.
 *
 * Run:  node scripts/verify.realestate.indexes.js
 *
 * ## Why this exists separately from `verify.realestate.property.js`
 *
 * That script proves the invariants are **declared** — `schema.indexes()` reports a
 * partial unique index. This script proves they **work**, by connecting to MongoDB and
 * attempting the writes that must fail.
 *
 * The gap is real and not theoretical. A partial filter expression written as
 * `{ status: { $eq: 'ACCEPTED' } }`, or a caster that stores a string where the filter
 * expects an ObjectId, produces an index that is declared, is created, and never
 * applies. `schema.indexes()` cannot tell the difference. Only a rejected insert can.
 *
 * ## What it proves
 *
 *   one_accepted_document_per_category
 *     two ACCEPTED documents on one (property, category)  -> REJECTED
 *     a second non-ACCEPTED document on the same pair     -> ALLOWED  (the partial filter)
 *
 *   one_open_review_per_property
 *     two OPEN reviews on one property                    -> REJECTED
 *     a CLOSED review then a new OPEN one                 -> ALLOWED
 *
 *   propertyCode unique
 *     two properties with the same code                   -> REJECTED
 *
 *   location.coordinates validator
 *     [0, 0]                                              -> REJECTED by validation
 *
 * ## It cleans up after itself
 *
 * Everything is written under one freshly generated `property` ObjectId per group, and
 * deleted by that id in a `finally`. It writes to the same `foodbite` database the app
 * uses, so this matters — a failed run must not leave rows behind.
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const M = require('../src/models/index.js');

const Property = M.RealEstateProperty;
const Document = M.RealEstatePropertyDocument;
const Verification = M.RealEstatePropertyVerification;

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  console.log('  FAIL ' + m);
};

const oid = () => new mongoose.Types.ObjectId();

/** The writes we make, so cleanup is exact rather than "delete everything". */
const touched = {
  documents: [],
  verifications: [],
  properties: [],
};

/**
 * Assert a write is rejected with a duplicate-key error (code 11000).
 */
const expectReject = async (fn, label) => {
  try {
    await fn();
    bad(label + ' -> was ACCEPTED but should have been REJECTED');
    return false;
  } catch (e) {
    if (e.code === 11000) {
      ok(label + ' -> REJECTED (E11000)');
      return true;
    }
    bad(label + ' -> threw ' + (e.code || '') + ' ' + e.message);
    return false;
  }
};

/** Assert a write succeeds. */
const expectOk = async (fn, label) => {
  try {
    const r = await fn();
    ok(label + ' -> ALLOWED');
    return r;
  } catch (e) {
    bad(label + ' -> was REJECTED but should have been ALLOWED: ' + e.message);
    return null;
  }
};

const insertDoc = async (overrides) => {
  const r = await Document.collection.insertOne({
    property: null,
    category: 'OWNERSHIP',
    visibility: 'INTERNAL',
    title: 't',
    fileUrl: 'u',
    status: 'PENDING',
    open: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  touched.documents.push(r.insertedId);
  return r;
};

const insertVerif = async (overrides) => {
  const r = await Verification.collection.insertOne({
    property: null,
    attempt: 1,
    stage: 'DOCUMENT_CHECK',
    reviewer: oid(),
    open: true,
    openedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  touched.verifications.push(r.insertedId);
  return r;
};

const run = async () => {
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGODB_URL not set');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });

  console.log('\n[0] sync indexes on the four catalogue collections');
  for (const [name, model] of [
    ['RealEstateProperty', Property],
    ['RealEstatePropertyDocument', Document],
    ['RealEstatePropertyVerification', Verification],
    ['RealEstatePropertyCategory', M.RealEstatePropertyCategory],
  ]) {
    const before = (await model.collection.indexes()).length;
    await model.syncIndexes();
    const after = await model.collection.indexes();
    ok(name + ': ' + before + ' -> ' + after.length + ' live indexes');
  }

  console.log('\n[1] one ACCEPTED document per (property, category)');
  {
    const property = oid();
    await expectOk(
      () => insertDoc({ property, category: 'OWNERSHIP', status: 'ACCEPTED' }),
      'first ACCEPTED OWNERSHIP document'
    );
    await expectReject(
      () => insertDoc({ property, category: 'OWNERSHIP', status: 'ACCEPTED' }),
      'second ACCEPTED OWNERSHIP document on the same property'
    );

    // The partial filter must NOT apply to other statuses, or a property could never
    // hold a rejected version alongside an accepted one — which it must.
    await expectOk(
      () => insertDoc({ property, category: 'OWNERSHIP', status: 'REJECTED' }),
      'a REJECTED document alongside an ACCEPTED one (partial filter is narrow)'
    );
    await expectOk(
      () => insertDoc({ property, category: 'OWNERSHIP', status: 'PENDING' }),
      'a PENDING document alongside an ACCEPTED one'
    );

    // A different category is a different document entirely.
    await expectOk(
      () => insertDoc({ property, category: 'APPROVAL', status: 'ACCEPTED' }),
      'ACCEPTED APPROVAL document (different category, same property)'
    );

    // A different property is independent.
    await expectOk(
      () => insertDoc({ property: oid(), category: 'OWNERSHIP', status: 'ACCEPTED' }),
      'ACCEPTED OWNERSHIP on a DIFFERENT property'
    );
  }

  console.log('\n[2] one OPEN review per property');
  {
    const property = oid();
    await expectOk(() => insertVerif({ property, attempt: 1, open: true }), 'first OPEN review');
    await expectReject(
      () => insertVerif({ property, attempt: 2, open: true }),
      'second OPEN review on the same property'
    );

    // A closed review must not block a new one — that is the resubmission path.
    const property2 = oid();
    await expectOk(
      () =>
        insertVerif({ property: property2, attempt: 1, open: false, decision: 'CHANGES_REQUIRED' }),
      'a CLOSED review'
    );
    await expectOk(
      () => insertVerif({ property: property2, attempt: 2, open: true }),
      'a new OPEN review after a closed one (resubmission)'
    );

    // Multiple closed reviews on one property must all be storable — that is the
    // history the plan requires (plan §47).
    await expectOk(
      () => insertVerif({ property: property2, attempt: 3, open: false, decision: 'REJECTED' }),
      'a third, also-closed review (full history kept)'
    );
  }

  console.log('\n[3] propertyCode is unique');
  {
    const code = 'RE-TEST-' + Date.now();
    const base = {
      source: 'LOCALWALA_DIRECT',
      category: oid(),
      transactionType: 'BUY',
      locality: oid(),
      city: oid(),
      state: oid(),
      location: { type: 'Point', coordinates: [78.4867, 17.385] },
      title: 'x',
      status: 'DRAFT',
      availability: 'AVAILABLE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const a = await Property.collection.insertOne({ ...base, propertyCode: code });
    touched.properties.push(a.insertedId);
    ok('first property with code ' + code + ' -> ALLOWED');
    await expectReject(
      () => Property.collection.insertOne({ ...base, propertyCode: code }),
      'second property with the same code'
    );
  }

  console.log('\n[4] the coordinates validator rejects null island and out-of-range');
  {
    const valid = {
      source: 'LOCALWALA_DIRECT',
      category: oid(),
      transactionType: 'BUY',
      locality: oid(),
      city: oid(),
      state: oid(),
      propertyCode: 'RE-VALID-' + Date.now(),
      title: 'x',
      location: { type: 'Point', coordinates: [78.4867, 17.385] },
    };
    const clean = await new Property(valid)
      .validate()
      .then(() => true)
      .catch((e) => e);
    if (clean === true) ok('a real Hyderabad pin passes model validation');
    else bad('valid pin rejected: ' + clean.message);

    for (const [coords, label] of [
      [[0, 0], 'null island [0,0]'],
      [[181, 17], 'lng 181'],
      [[78, 91], 'lat 91'],
    ]) {
      const err = await new Property({ ...valid, location: { type: 'Point', coordinates: coords } })
        .validate()
        .then(() => null)
        .catch((e) => e);
      if (err && /coordinates/.test(err.message)) ok(label + ' -> REJECTED by validation');
      else bad(label + ' -> ' + (err ? 'rejected but wrong error: ' + err.message : 'ACCEPTED'));
    }
  }

  console.log('\n[5] the geo index actually answers a $near query');
  {
    const near = oid();
    const far = oid();
    const mk = (code, coords) => ({
      source: 'LOCALWALA_DIRECT',
      category: oid(),
      transactionType: 'BUY',
      locality: oid(),
      city: oid(),
      state: oid(),
      propertyCode: code,
      title: 'x',
      status: 'PUBLISHED',
      availability: 'AVAILABLE',
      location: { type: 'Point', coordinates: coords },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const a = await Property.collection.insertOne(
      mk('RE-GEO-NEAR-' + Date.now(), [78.4867, 17.385])
    );
    const b = await Property.collection.insertOne(
      mk('RE-GEO-FAR-' + Date.now(), [72.8777, 19.076])
    );
    touched.properties.push(a.insertedId, b.insertedId);

    // 5 km around Hyderabad should find `near` and not `far` (~620 km away).
    const found = await Property.collection
      .find({
        status: 'PUBLISHED',
        'location.coordinates': {
          $near: { $geometry: { type: 'Point', coordinates: [78.5, 17.4] }, $maxDistance: 5000 },
        },
      })
      .toArray();

    const ids = found.map((d) => String(d._id));
    if (ids.includes(String(a.insertedId)) && !ids.includes(String(b.insertedId))) {
      ok('$near within 5 km returned the Hyderabad pin and excluded Mumbai');
    } else {
      bad(
        '$near returned ' +
          found.length +
          ' docs; expected the 1 Hyderabad pin. ids=' +
          ids.join(',')
      );
    }
  }

  console.log('\n' + (failed === 0 ? 'ALL LIVE INDEX CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
};

run()
  .catch((e) => {
    console.error('\nLIVE VERIFY FAILED:', e.message);
    failed++;
  })
  .finally(async () => {
    // Exact cleanup — delete only what this run inserted.
    try {
      if (touched.documents.length)
        await Document.collection.deleteMany({ _id: { $in: touched.documents } });
      if (touched.verifications.length)
        await Verification.collection.deleteMany({ _id: { $in: touched.verifications } });
      if (touched.properties.length)
        await Property.collection.deleteMany({ _id: { $in: touched.properties } });
      console.log(
        '\ncleanup: removed ' +
          touched.documents.length +
          ' document(s), ' +
          touched.verifications.length +
          ' review(s), ' +
          touched.properties.length +
          ' propert(ies)'
      );
    } catch (e) {
      console.error('CLEANUP FAILED — check for leftover test rows:', e.message);
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(failed === 0 ? 0 : 1);
  });
