/**
 * verify.realestate.integration.full.js — end-to-end Real Estate flow.
 *
 * ## What changed, and why the old version was not merely rewritten
 *
 * The previous version of this file drove `RealEstateListing` through
 * `realestate.listing.service.js`. Both are now deleted, so the test had to move to
 * `RealEstateProperty` and `propertyService` — the models and services the routes actually
 * use.
 *
 * Two of its assertions were wrong in ways worth recording, because both had been passing
 * against the dead service and would have carried over as false confidence:
 *
 *   1. It asserted `expect(approved.status).to.equal('ARCHIVED')` after archiving, reading
 *      the **stale** document returned by the previous step. It was checking that archiving
 *      had no effect.
 *   2. It expected archiving a never-submitted DRAFT to *decrease* `consumedCount`. A
 *      DRAFT that never consumed a unit has nothing to give back, so that assertion
 *      contradicted the behaviour it claimed to verify.
 *
 * Neither was reachable-as-written against `propertyService`, which does not expose
 * `approveListing`/`archiveListing` at all — those transitions go through `changeStatus`.
 *
 * ## The cycle asserted here
 *
 * vendor registers → buys a package → payment grants an entitlement → vendor creates a
 * DRAFT property → submits (BR-05 consumes one) → admin approves → publishes → appears in
 * public search → archives, and the consumed unit is NOT returned (BR-05).
 *
 * Run: node scripts/verify.realestate.integration.full.js
 */

const { expect, describe, it, before, beforeEach, after, run } = require('./verify.harness');
const path = require('path');

const API = path.resolve(__dirname, '..');
require(path.join(API, 'node_modules/dotenv')).config({ path: path.join(API, '.env') });
const mongoose = require(path.join(API, 'node_modules/mongoose'));

const RealEstateVendor = require(path.join(
  API,
  'src/modules/realestate/models/realestate.vendor.model'
));
const RealEstateListingPackage = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.package.model'
));
const RealEstateListingEntitlement = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.entitlement.model'
));
const RealEstateListingOrder = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.order.model'
));
const RealEstateProperty = require(path.join(
  API,
  'src/modules/realestate/models/realestate.property.model'
));
const RealEstatePropertyCategory = require(path.join(
  API,
  'src/modules/realestate/models/realestate.property.category.model'
));

const propertyService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.property.service'
));
const orderService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.listing.order.service'
));
const searchService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.property.search.service'
));

const VENDOR = { actorType: 'vendor' };
const ADMIN = { actorType: 'admin' };
const oid = () => new mongoose.Types.ObjectId();

describe('RealEstate End-to-End Flow', function () {
  before(async function () {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
  });

  after(async function () {
    await mongoose.disconnect().catch(() => {});
  });

  beforeEach(async function () {
    await RealEstateVendor.deleteMany({});
    await RealEstateListingPackage.deleteMany({});
    await RealEstateListingEntitlement.deleteMany({});
    await RealEstateProperty.deleteMany({});
    await RealEstateListingOrder.deleteMany({});
  });

  it('vendor registers → buys a package → creates DRAFT → submits (consumes) → admin approves → publishes → searchable → archive does not restore', async function () {
    // 1. Vendor
    const vendor = await RealEstateVendor.create({
      user: oid(),
      businessName: 'Integration Vendor',
      businessType: 'AGENCY',
      displayName: 'Integration Vendor',
      contactPerson: 'Test Person',
      contactEmail: 'integration@test.com',
      contactMobile: '9876543210',
      contactCountryCode: '+91',
      pan: 'ABCDE1234F',
      status: 'ACTIVE',
      verificationStatus: 'APPROVED',
      bank: {
        accountName: 'Test Person',
        accountNumber: '1234567890',
        ifsc: 'SBIN0000001',
        bankName: 'State Bank of India',
      },
    });

    // 2. A category to file the property under. Reuse a seeded one when present so the
    //    test does not depend on its own fixture surviving.
    const category =
      (await RealEstatePropertyCategory.findOne({ status: true })) ||
      (await RealEstatePropertyCategory.create({
        key: 'INTPROBE',
        name: 'Integration probe',
        slug: 'integration-probe',
        transactionTypes: ['BUY', 'RENT'],
        amenityOptions: [],
        specSchema: { fields: [] },
        status: true,
      }));

    // 3. Package, then a real purchase through the order service.
    const pkg = await RealEstateListingPackage.create({
      code: 'INTBASIC',
      name: 'Integration Basic',
      description: 'for the end-to-end test',
      price: 49990, // rupees; moneyField stores paise
      listingCount: 10,
      durationDays: 60,
      features: ['Basic listings'],
      limits: { maxImages: 15, maxVideos: 3, allowFeatured: true },
      sortOrder: 3,
      status: true,
    });

    const pending = await orderService.createOrder(vendor._id, pkg.code);
    expect(pending.status).to.equal('PENDING_PAYMENT');

    // BR-02: an unpaid order grants nothing. Asserted as a falsy check rather than
    // `to.equal(null)` because the field is simply unset before `markPaid` runs, and an
    // unset field reads as `undefined`.
    expect(pending.entitlement).to.equal(undefined);

    const order = await orderService.markPaid(pending._id, { paymentRef: 'INT-REF-1' });
    expect(order.status).to.equal('PAID');
    expect(order.entitlement).to.not.be.null;

    const entitlement = await RealEstateListingEntitlement.findById(order.entitlement).lean();
    expect(entitlement.totalCount).to.equal(10);
    expect(entitlement.consumedCount).to.equal(0);

    // 4. A vendor property, always DRAFT on create (BR-03).
    /**
 * Category-required specs, read from the category rather than hardcoded.
 *
 * `APARTMENT` declares `bedrooms` and `bathrooms` as required, so `create()` rejects a
 * payload without them. Hardcoding `bedrooms: 3` would pass today and break the moment the
 * category gains another required field — so the fields are derived from the category's own
 * `specSchema`, which is the same source `validateSpecs` reads.
 */
const specsFor = (cat) => {
  const fields = (cat.specSchema && cat.specSchema.fields) || [];
  const specs = {};
  for (const f of fields) {
    if (!f.required) continue;
    switch (f.type) {
      case 'NUMBER':
        specs[f.key] = f.min !== undefined ? f.min : 1;
        break;
      case 'BOOLEAN':
        specs[f.key] = true;
        break;
      case 'ENUM':
        specs[f.key] = f.options && f.options[0] !== undefined ? f.options[0] : null;
        break;
      default:
        specs[f.key] = f.maxLength || 'TEST';
    }
  }
  return specs;
};

    const property = await propertyService.create(
      {
        source: 'VENDOR',
        vendor: vendor._id,
        category: category._id,
        transactionType: 'BUY',
        title: 'Integration Test Property',
        description: 'A property for end-to-end verification',
        price: 52500, // rupees
        location: { type: 'Point', coordinates: [78.5, 17.5] }, // Hyderabad
        locality: oid(),
        city: oid(),
        state: oid(),
        specs: specsFor(category),
      },
      { actorType: 'vendor' }
    );

    expect(property.status).to.equal('DRAFT');
    expect(property.availability).to.equal('AVAILABLE');
    expect(property.source).to.equal('VENDOR');

    // 5. Submit → BR-05 consumes exactly one unit.
    const submitted = await propertyService.changeStatus(property._id, 'SUBMITTED', VENDOR);
    expect(submitted.status).to.equal('SUBMITTED');
    expect(submitted.submittedAt).to.not.be.null;
    expect(String(submitted.entitlement)).to.equal(String(entitlement._id));

    const afterSubmit = await RealEstateListingEntitlement.findById(entitlement._id).lean();
    expect(afterSubmit.consumedCount).to.equal(1);

    // 6. Admin review → approve → publish.
    const inReview = await propertyService.changeStatus(property._id, 'IN_REVIEW', ADMIN);
    expect(inReview.status).to.equal('IN_REVIEW');

    const approved = await propertyService.changeStatus(property._id, 'APPROVED', ADMIN);
    expect(approved.status).to.equal('APPROVED');

    const published = await propertyService.changeStatus(property._id, 'PUBLISHED', ADMIN);
    expect(published.status).to.equal('PUBLISHED');
    expect(published.publishedAt).to.not.be.null;

    // 7. A published property is publicly searchable. The search service hardcodes
    //    `status: PUBLISHED`, so finding it proves the whole chain is reachable.
    const found = await searchService.search({
      lng: 78.5,
      lat: 17.5,
      radiusMeters: 5000,
    });
    expect(found.totalResults).to.be.greaterThan(0);
    expect(found.results.some((p) => String(p._id) === String(property._id))).to.be.true;

    // 8. Archive. BR-05: at or past SUBMITTED the unit is NOT returned.
    const archived = await propertyService.changeStatus(property._id, 'ARCHIVED', VENDOR);
    expect(archived.status).to.equal('ARCHIVED');

    const afterArchive = await RealEstateListingEntitlement.findById(entitlement._id).lean();
    expect(afterArchive.consumedCount).to.equal(1);

    // 9. An archived property leaves public search.
    const afterSearch = await searchService.search({
      lng: 78.5,
      lat: 17.5,
      radiusMeters: 5000,
    });
    expect(afterSearch.results.some((p) => String(p._id) === String(property._id))).to.be.false;

    // 10. Vendor record intact.
    const finalVendor = await RealEstateVendor.findById(vendor._id).lean();
    expect(finalVendor.businessName).to.equal('Integration Vendor');

    await RealEstateVendor.deleteMany({});
    await RealEstateListingPackage.deleteMany({});
    await RealEstateListingEntitlement.deleteMany({});
    await RealEstateProperty.deleteMany({});
    await RealEstateListingOrder.deleteMany({});
  });

  it('a vendor cannot reach APPROVED directly, and cannot publish without submitting', async function () {
    const category =
      (await RealEstatePropertyCategory.findOne({ status: true })) ||
      (await RealEstatePropertyCategory.create({
        key: 'INTPROBE2',
        name: 'Integration probe 2',
        slug: 'integration-probe-2',
        transactionTypes: ['BUY', 'RENT'],
        amenityOptions: [],
        specSchema: { fields: [] },
        status: true,
      }));

    const property = await RealEstateProperty.create({
      source: 'LOCALWALA_DIRECT',
      category: category._id,
      transactionType: 'BUY',
      propertyCode: `INT-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      title: 'Direct listing',
      price: 52500,
      location: { type: 'Point', coordinates: [78.5, 17.5] },
      locality: oid(),
      city: oid(),
      state: oid(),
      status: 'DRAFT',
      createdBy: oid(),
    });

    // BR-03: the ladder is DRAFT -> SUBMITTED -> IN_REVIEW -> APPROVED -> PUBLISHED.
    // APPROVED is admin-only, so a vendor is refused even if the status table allows it.
    let vendorApproveRefused = false;
    try {
      await propertyService.changeStatus(property._id, 'APPROVED', VENDOR);
    } catch (e) {
      vendorApproveRefused = true;
    }
    expect(vendorApproveRefused).to.be.true;

    // And DRAFT -> PUBLISHED is not a legal jump at all.
    let skipRefused = false;
    try {
      await propertyService.changeStatus(property._id, 'PUBLISHED', ADMIN);
    } catch (e) {
      skipRefused = true;
    }
    expect(skipRefused).to.be.true;

    await RealEstateProperty.deleteMany({});
  });

  it('a VENDOR listing cannot publish without an entitlement — BR-02', async function () {
    const category = await RealEstatePropertyCategory.findOne({ status: true });

    /**
     * Seeded directly at `APPROVED` with no entitlement, rather than walked up through
     * `changeStatus`.
     *
     * That matters: submitting a `VENDOR` listing now consumes an entitlement (BR-05), so
     * there is no service path that reaches `APPROVED` entitlement-free. Walking it up —
     * which the first version of this test did — fails at SUBMITTED with the BR-05 message
     * and never exercises the publish gate at all.
     *
     * Writing the row directly is the only way to isolate the gate, and it is legitimate:
     * the gate is a second line of defence for a document that arrives at APPROVED without
     * one (a migration, a direct write, a bug elsewhere).
     */
    const property = await RealEstateProperty.create({
      source: 'VENDOR',
      vendor: oid(),
      category: category._id,
      transactionType: 'BUY',
      propertyCode: `INT-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      title: 'Vendor listing with no entitlement',
      price: 52500,
      location: { type: 'Point', coordinates: [78.5, 17.5] },
      locality: oid(),
      city: oid(),
      state: oid(),
      status: 'APPROVED',
      createdBy: oid(),
    });

    if (property.entitlement) throw new Error('fixture is wrong — it carries an entitlement');
    expect(property.status).to.equal('APPROVED');

    let publishRefused = false;
    try {
      await propertyService.changeStatus(property._id, 'PUBLISHED', ADMIN);
    } catch (e) {
      publishRefused = true;
    }
    expect(publishRefused).to.be.true;

    await RealEstateProperty.deleteMany({});
  });
});

run();