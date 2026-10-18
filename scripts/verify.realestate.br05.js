/**
 * verify.realestate.br05.js — BR-05 on the live property service.
 *
 * ## Why this exists
 *
 * BR-05's consume-on-submit lived **only** in `realestate.listing.service.js`, which is
 * imported by nothing under `src/` and is not registered in `models/index.js`. So the
 * reachable code path — `propertyService.changeStatus()`, which the admin and vendor
 * routes use — enforced the *publish* half of BR-02/BR-05 ("no entitlement, no publish")
 * but never consumed anything on submit. A vendor could submit unlimited listings against
 * one entitlement.
 *
 * The consumption now lives in `changeStatus`, and this asserts it where it can actually
 * be reached.
 *
 * ## The three cases that decide whether the rule is real
 *
 * 1. Submit with no entitlement → refused, and nothing is consumed.
 * 2. Submit with one → exactly one unit consumed, and the property records which
 *    entitlement paid.
 * 3. Resubmitting a `CHANGES_REQUIRED` listing → **no second consume**. This is the one
 *    that would quietly let a vendor burn their balance by being asked for corrections.
 *
 * Run: node scripts/verify.realestate.br05.js
 */

const path = require('path');

const API = path.resolve(__dirname, '..');
const mongoose = require(path.join(API, 'node_modules/mongoose'));
require(path.join(API, 'node_modules/dotenv')).config({ path: path.join(API, '.env') });

const propertyService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.property.service'
));
const orderService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.listing.order.service'
));
const RealEstateProperty = require(path.join(
  API,
  'src/modules/realestate/models/realestate.property.model'
));
const RealEstatePropertyCategory = require(path.join(
  API,
  'src/modules/realestate/models/realestate.property.category.model'
));
const RealEstateAuditLog = require(path.join(
  API,
  'src/modules/realestate/models/realestate.audit.log.model'
));
const RealEstateListingPackage = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.package.model'
));
const RealEstateListingOrder = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.order.model'
));
const RealEstateListingEntitlement = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.entitlement.model'
));

let failed = 0;
let passed = 0;
const ok = (m) => {
  passed++;
  console.log('  OK   ' + m);
};
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const CODE = 'BR05PROBE';
const tag = (s) => `${s}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const oid = () => new mongoose.Types.ObjectId();

const VENDOR = { actorType: 'vendor' };
const ADMIN = { actorType: 'admin' };

(async () => {
  console.log('\n[0] fixtures');
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const category =
    (await RealEstatePropertyCategory.findOne({ status: true })) ||
    (await RealEstatePropertyCategory.create({
      key: 'BR05PROBE',
      name: 'BR05 probe',
      slug: 'br05-probe',
      transactionTypes: ['BUY', 'RENT'],
      amenityOptions: [],
      specSchema: { fields: [] },
      status: true,
    }));

  const pkgCode = tag(CODE);
  const pkg = await RealEstateListingPackage.create({
    code: pkgCode,
    name: 'BR05 probe package',
    price: 49990,
    listingCount: 5, // deliberately small so exhaustion is reachable
    durationDays: 60,
    sortOrder: 998,
    status: true,
  });
  ok(`category ${category.key}, package ${pkg.code} with 5 listings`);

  /**
   * A vendor property in DRAFT. `source: 'VENDOR'` is what arms the BR-05 gate.
   */
  const makeProperty = async (vendorId) => {
    // `propertyCode` is unique and required, and normally minted by the service's
    // `generatePropertyCode`. Supplying one here keeps the fixture honest about the
    // model's own constraint.
    const propertyCode = `BR05-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    return RealEstateProperty.create({
      source: 'VENDOR',
      vendor: vendorId,
      category: category._id,
      transactionType: 'BUY',
      propertyCode,
      title: 'BR05 probe property',
      description: 'temporary',
      price: 5250000,
      location: { type: 'Point', coordinates: [78.4867, 17.385] },
      locality: oid(),
      city: oid(),
      state: oid(),
      status: 'DRAFT',
      createdBy: oid(),
    });
  };

  const vendorA = oid();
  const vendorB = oid();

  const properties = [];
  try {
    // ----------------------------------------------------------------------- [1]

    console.log('\n[1] submitting with no entitlement is refused');

    const p1 = await makeProperty(vendorA);
    properties.push(p1);

    let refused = false;
    try {
      await propertyService.changeStatus(p1._id, 'SUBMITTED', VENDOR);
    } catch (e) {
      refused = true;
      ok('refused: ' + e.message.slice(0, 90));
    }
    if (!refused) bad('submit without entitlement', 'was allowed');

    const unchanged = await RealEstateProperty.findById(p1._id).lean();
    if (unchanged.status === 'DRAFT') ok('property is still DRAFT after the refusal');
    else bad('status after refusal', `got ${unchanged.status}`);

    if (!unchanged.entitlement) ok('no entitlement was attached');
    else bad('entitlement', 'attached despite the refusal');

    // ----------------------------------------------------------------------- [2]

    console.log('\n[2] buying a package and paying grants capacity');

    // `createOrder` returns the order *before* payment, when `entitlement` is still null.
    // `markPaid` returns a separate document with the entitlement linked, so the paid
    // document is the one to read — using the pre-payment object made this fail on a null.
    const pendingOrder = await orderService.createOrder(vendorA, pkg.code);
    const paidOrder = await orderService.markPaid(pendingOrder._id, { paymentRef: 'BR05-PROBE' });

    if (paidOrder.status === 'PAID' && paidOrder.entitlement) {
      ok(`order ${paidOrder.orderCode} is PAID and links its entitlement`);
    } else {
      bad('order after payment', `status=${paidOrder.status} entitlement=${paidOrder.entitlement}`);
    }

    const entitlement = await RealEstateListingEntitlement.findById(paidOrder.entitlement).lean();
    if (entitlement && entitlement.totalCount === 5 && entitlement.consumedCount === 0) {
      ok('entitlement granted: 5 total, 0 consumed');
    } else {
      bad('entitlement after payment', JSON.stringify(entitlement));
    }

    // ----------------------------------------------------------------------- [3]

    console.log('\n[3] submitting consumes exactly one unit — BR-05');

    const submitted = await propertyService.changeStatus(p1._id, 'SUBMITTED', VENDOR);

    if (submitted.status === 'SUBMITTED') ok('property reached SUBMITTED');
    else bad('status', `got ${submitted.status}`);

    if (submitted.entitlement) ok('the property records which entitlement paid for it');
    else bad('property.entitlement', 'not set — the consumption is untraceable');

    if (String(submitted.entitlement) === String(entitlement._id)) {
      ok('it is the entitlement from the purchase');
    } else {
      bad('property.entitlement', 'points at a different entitlement');
    }

    const afterSubmit = await RealEstateListingEntitlement.findById(entitlement._id).lean();
    if (afterSubmit.consumedCount === 1) ok('consumedCount 0 -> 1');
    else bad('consumedCount', `got ${afterSubmit.consumedCount}, expected 1`);

    const entries = afterSubmit.consumptions || [];
    if (entries.length === 1) ok('one consumption entry recorded');
    else bad('consumption entries', `${entries.length}, expected 1`);

    if (entries.length === 1 && String(entries[0].property) === String(p1._id)) {
      ok('the entry names the property that consumed it');
    } else if (entries.length === 1) {
      bad('consumption entry', 'names a different property');
    }

    // ----------------------------------------------------------------------- [4]

    console.log('\n[4] a LOCALWALA_DIRECT listing is exempt — BR-04');

    const direct = await RealEstateProperty.create({
      source: 'LOCALWALA_DIRECT',
      category: category._id,
      transactionType: 'BUY',
      propertyCode: `BR05D-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      title: 'BR05 direct listing',
      price: 5250000,
      location: { type: 'Point', coordinates: [78.4867, 17.385] },
      locality: oid(),
      city: oid(),
      state: oid(),
      status: 'DRAFT',
      createdBy: oid(),
    });
    properties.push(direct);

    const directSubmitted = await propertyService.changeStatus(direct._id, 'SUBMITTED', ADMIN);
    if (directSubmitted.status === 'SUBMITTED') {
      ok('a direct listing submits without consuming anything');
    } else {
      bad('direct listing', `got ${directSubmitted.status}`);
    }

    if (!directSubmitted.entitlement) ok('no entitlement attached to a direct listing');
    else bad('direct listing entitlement', 'set — direct listings have no package');

    // ----------------------------------------------------------------------- [5]

    console.log('\n[5] resubmitting after CHANGES_REQUIRED does not consume twice');

    await propertyService.changeStatus(p1._id, 'IN_REVIEW', ADMIN);
    await propertyService.changeStatus(p1._id, 'CHANGES_REQUIRED', ADMIN, {
      reason: 'Please correct the description',
    });

    const beforeResubmit = await RealEstateListingEntitlement.findById(entitlement._id).lean();
    const resubmitted = await propertyService.changeStatus(p1._id, 'SUBMITTED', VENDOR);
    const afterResubmit = await RealEstateListingEntitlement.findById(entitlement._id).lean();

    if (resubmitted.status === 'SUBMITTED') ok('resubmitted to SUBMITTED');
    else bad('resubmit status', `got ${resubmitted.status}`);

    if (afterResubmit.consumedCount === beforeResubmit.consumedCount) {
      ok(`consumedCount unchanged at ${afterResubmit.consumedCount} — a correction is not a new listing`);
    } else {
      bad(
        'double consume on resubmit',
        `${beforeResubmit.consumedCount} -> ${afterResubmit.consumedCount}. ` +
          'The property already carries an entitlement, so re-consuming charges the vendor ' +
          'twice for one listing.'
      );
    }

    // ----------------------------------------------------------------------- [6]

    console.log('\n[6] capacity is exhausted after 5 submissions');

    for (let i = 0; i < 4; i++) {
      const p = await makeProperty(vendorA);
      properties.push(p);
      await propertyService.changeStatus(p._id, 'SUBMITTED', VENDOR);
    }

    const exhausted = await RealEstateListingEntitlement.findById(entitlement._id).lean();
    if (exhausted.consumedCount === 5) ok('5 of 5 consumed');
    else bad('consumedCount', `got ${exhausted.consumedCount}, expected 5`);

    const overflow = await makeProperty(vendorA);
    properties.push(overflow);

    let blocked = false;
    try {
      await propertyService.changeStatus(overflow._id, 'SUBMITTED', VENDOR);
    } catch (e) {
      blocked = true;
      ok('the 6th submission is refused: ' + e.message.slice(0, 80));
    }
    if (!blocked) bad('capacity limit', 'a 6th submission was allowed against a 5-listing package');

    const stillFive = await RealEstateListingEntitlement.findById(entitlement._id).lean();
    if (stillFive.consumedCount === 5) ok('consumedCount held at 5 after the refusal');
    else bad('consumedCount after refusal', `got ${stillFive.consumedCount}`);

    console.log('\n[8] BR-20 — the consumption is audited');

/**
 * BR-20 requires an audit record for every transition that moves money. Consuming an
 * entitlement is one: a vendor's remaining balance drops, and a report that cannot show why
 * a balance is what it is cannot be reconciled.
 *
 * Asserted against the real submit path rather than by calling the audit service directly,
 * because the failure mode is a service that *could* record and does not.
 */
const auditRows = await RealEstateAuditLog.find({
  'metadata.property': String(p1._id),
  eventType: 'ENTITLEMENT_CONSUMED',
}).lean();

if (auditRows.length >= 1) {
  ok(`${auditRows.length} ENTITLEMENT_CONSUMED row(s) for this property`);
} else {
  bad(
    'BR-20 on submit',
    'no audit row for the entitlement consumption — the balance changed with no record'
  );
}

if (auditRows.length >= 1) {
  const row = auditRows[0];
  if (String(row.targetId) === String(entitlement._id)) {
    ok('the row points at the entitlement that was charged');
  } else {
    bad('audit target', 'points at a different document');
  }

  if (row.after && row.after.consumedCount === 1) {
    ok('the row records consumedCount = 1');
  } else {
    bad('audit detail', `after = ${JSON.stringify(row.after)}`);
  }

  if (row.metadata && row.metadata.remaining === 4) {
    ok('the row records the resulting balance (4 remaining)');
  } else {
    bad('audit metadata', `remaining = ${row.metadata && row.metadata.remaining}`);
  }
}

await RealEstateAuditLog.deleteMany({ 'metadata.property': String(p1._id) });

// ----------------------------------------------------------------------- [9]

    console.log('\n[7] another vendor is unaffected by vendor A exhausting their balance');

    const pendingB = await orderService.createOrder(vendorB, pkg.code);
    const paidB = await orderService.markPaid(pendingB._id, { paymentRef: 'BR05-PROBE-B' });

    const pB = await makeProperty(vendorB);
    properties.push(pB);

    const bSubmitted = await propertyService.changeStatus(pB._id, 'SUBMITTED', VENDOR);
    if (bSubmitted.status === 'SUBMITTED') ok('vendor B submits on their own entitlement');
    else bad('vendor B', `got ${bSubmitted.status}`);

    const entB = await RealEstateListingEntitlement.findById(paidB.entitlement).lean();
    if (entB.consumedCount === 1) ok("vendor A's exhaustion did not consume vendor B's units");
    else bad('entitlement isolation', `vendor B consumedCount = ${entB.consumedCount}`);
  } finally {
    console.log('\n[cleanup]');

    await RealEstateProperty.deleteMany({ _id: { $in: properties.map((p) => p._id) } });
    await RealEstateListingOrder.deleteMany({ 'packageSnapshot.code': pkg.code });
    await RealEstateListingEntitlement.deleteMany({ 'packageSnapshot.code': pkg.code });
    await RealEstateListingPackage.deleteMany({ code: pkg.code });
    if (category.key === 'BR05PROBE') await RealEstatePropertyCategory.deleteMany({ _id: category._id });

    const propertyIds = properties.map((p) => p._id);

    const left =
      (await RealEstateListingPackage.countDocuments({ code: pkg.code })) +
      (await RealEstateListingOrder.countDocuments({ 'packageSnapshot.code': pkg.code })) +
      (await RealEstateListingEntitlement.countDocuments({ 'packageSnapshot.code': pkg.code })) +
      (await RealEstateProperty.countDocuments({ _id: { $in: propertyIds } }));

    if (left === 0) ok('probe properties, package, orders and entitlements removed');
    else bad('cleanup', `${left} document(s) left behind`);

    await mongoose.disconnect().catch(() => {});
  }

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of ${passed + failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`ALL ${passed} BR-05 CHECKS PASSED`);
})();