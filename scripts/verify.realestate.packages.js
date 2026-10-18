/**
 * verify.realestate.packages.js — BR-02 / BR-05 purchase path.
 *
 * ## What this covers that nothing did
 *
 * A vendor buying a listing package had no reachable path. `package.service.js` exported
 * five catalogue functions and was imported by nobody; there was no order service, and no
 * route or controller accepted a purchase. So a vendor could not obtain an entitlement
 * through any request, and BR-02 ("a listing package is the entitlement to list") was
 * enforced only by tests calling services directly.
 *
 * This asserts the purchase path end to end at the service layer, plus the invariants that
 * matter more than the happy path.
 *
 * ## The three things worth testing hardest
 *
 * 1. **An unpaid order grants nothing.** If `createOrder` created an entitlement, a vendor
 *    could list without paying.
 * 2. **`markPaid` is idempotent.** Payment webhooks retry. A double grant is free listings.
 * 3. **The amount comes from the catalogue.** A client-supplied price is the classic way a
 *    ₹1 purchase becomes a 50-listing entitlement.
 *
 * Run: node scripts/verify.realestate.packages.js
 */

const path = require('path');

const API = path.resolve(__dirname, '..');
const mongoose = require(path.join(API, 'node_modules/mongoose'));
require(path.join(API, 'node_modules/dotenv')).config({ path: path.join(API, '.env') });

const orderService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.listing.order.service'
));
const packageService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.listing.package.service'
));
const entitlementService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.listing.entitlement.service'
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
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const oid = () => new mongoose.Types.ObjectId();
const CODE = 'PROBEPKG';

(async () => {
  console.log('\n[0] prepare a throwaway package');
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  await RealEstateListingOrder.deleteMany({ 'packageSnapshot.code': CODE });
  await RealEstateListingEntitlement.deleteMany({ 'packageSnapshot.code': CODE });
  await RealEstateListingPackage.deleteMany({ code: CODE });

  // 49990 RUPEES. `price` is a `moneyField`, so the setter takes rupees and stores paise.
  // Passing 4999000 here (thinking paise) produced a 100x-inflated catalogue, and the
  // first run of this script reported that as a double-conversion bug in the order service.
  // The service was right; the fixture was wrong.
  const pkg = await packageService.createPackage({
    code: CODE,
    name: 'Probe package',
    description: 'temporary',
    price: 49990, // ₹49,990.00
    listingCount: 10,
    durationDays: 60,
    sortOrder: 999,
  });

  ok(`package created, code=${pkg.code}, price reads ${pkg.price} rupees`);

  const vendorA = oid();
  const vendorB = oid();

  try {
    // ----------------------------------------------------------------------- [1]

    console.log('\n[1] creating an order grants nothing — BR-02');

    const order = await orderService.createOrder(vendorA, CODE);

    if (order.status === 'PENDING_PAYMENT') ok('order starts PENDING_PAYMENT');
    else bad('order status', `got ${order.status}`);

    if (order.entitlement === undefined || order.entitlement === null) {
      ok('order has no entitlement attached');
    } else {
      bad('order.entitlement', 'set at creation — an unpaid order would grant a listing right');
    }

    const entsBefore = await RealEstateListingEntitlement.countDocuments({ vendor: vendorA });
    if (entsBefore === 0) ok('vendor holds zero entitlements before payment');
    else bad('entitlement before payment', `${entsBefore} found`);

    // ----------------------------------------------------------------------- [2]

    console.log('\n[2] the amount and snapshot come from the catalogue');

    /**
     * Read the RAW stored value with the collection driver, not `.lean()`.
     *
     * `.lean()` bypasses the moneyField getter and returns paise, which is the documented
     * trap in `src/utils/money.js`. Asserting on a lean read is how this check first
     * reported a 10 000x overcharge that was really just the conversion happening twice.
     */
    const rawOrder = await RealEstateListingOrder.collection.findOne({ _id: order._id });

    if (rawOrder.amount === 4999000) {
      ok('amount stored as 4999000 paise (₹49,990.00) — converted exactly once');
    } else {
      bad(
        'order.amount in paise',
        `got ${rawOrder.amount}, expected 4999000 ` +
          '(a 100x multiple here means moneyField\'s setter ran twice)'
      );
    }

    if (order.amount === 49990) ok(`order reads ${order.amount} rupees through the getter`);
    else bad('order.amount in rupees', `got ${order.amount}, expected 49990`);

    if (rawOrder.packageSnapshot.price === 4999000) {
      ok('snapshot price stored as 4999000 paise — not double-converted');
    } else {
      bad('snapshot price in paise', `got ${rawOrder.packageSnapshot.price}, expected 4999000`);
    }

    if (order.packageSnapshot.code === CODE) ok('snapshot froze the package code');
    else bad('snapshot code', `got ${order.packageSnapshot.code}`);

    if (order.packageSnapshot.listingCount === 10) ok('snapshot froze listingCount = 10');
    else bad('snapshot listingCount', `got ${order.packageSnapshot.listingCount}`);

    /**
     * `frozenAt` was being discarded on write while the parent was an untyped object, so
     * the assertion is on the RAW document. Reading it off the mongoose document would have
     * passed while the stored value was absent.
     */
    if (rawOrder.packageSnapshot.frozenAt) {
      ok('snapshot frozenAt persisted (it was silently dropped before the sub-schema fix)');
    } else {
      bad('snapshot frozenAt', 'not persisted — the snapshot has no freeze time');
    }

    // ----------------------------------------------------------------------- [3]

    console.log('\n[3] an unknown or inactive package cannot be bought');

    try {
      await orderService.createOrder(vendorA, 'NOSUCHPACKAGE');
      bad('unknown package', 'createOrder succeeded');
    } catch (e) {
      ok('unknown package rejected: ' + e.message);
    }

    await RealEstateListingPackage.updateOne({ code: CODE }, { $set: { status: false } });
    try {
      await orderService.createOrder(vendorA, CODE);
      bad('inactive package', 'createOrder succeeded for a deactivated package');
    } catch (e) {
      ok('inactive package rejected: ' + e.message);
    }
    await RealEstateListingPackage.updateOne({ code: CODE }, { $set: { status: true } });

    // ----------------------------------------------------------------------- [4]

    console.log('\n[4] paying grants exactly one entitlement — BR-05');

    const paid = await orderService.markPaid(order._id, { paymentRef: 'PROBE-REF-1' });

    if (paid.status === 'PAID') ok('order is PAID');
    else bad('order status after payment', `got ${paid.status}`);

    if (paid.paidAt instanceof Date) ok('paidAt recorded');
    else bad('paidAt', 'missing');

    if (paid.entitlement) ok('order links its entitlement');
    else bad('order.entitlement', 'still null after payment');

    const granted = await RealEstateListingEntitlement.findById(paid.entitlement).lean();
    if (granted) {
      ok('entitlement document exists');
      if (String(granted.vendor) === String(vendorA)) ok('entitlement belongs to the buyer');
      else bad('entitlement vendor', 'mismatch');
      if (granted.totalCount === 10) ok('granted 10 listings');
      else bad('entitlement totalCount', `got ${granted.totalCount}`);
      if (granted.consumedCount === 0) ok('consumedCount starts at 0');
      else bad('consumedCount', `got ${granted.consumedCount}`);
      if (String(granted.order) === String(order._id)) ok('entitlement records which order paid (BR-15)');
      else bad('entitlement.order', 'not recorded — one-order-one-entitlement is unenforceable');
    } else {
      bad('entitlement', 'document not found');
    }

    // ----------------------------------------------------------------------- [5]

    console.log('\n[5] markPaid is idempotent — payment webhooks retry');

    const again = await orderService.markPaid(order._id, { paymentRef: 'PROBE-REF-2' });
    const entCount = await RealEstateListingEntitlement.countDocuments({ vendor: vendorA });

    if (entCount === 1) ok('a second markPaid granted no second entitlement');
    else bad('idempotency', `${entCount} entitlements after paying twice — expected 1`);

    if (again.paymentRef === 'PROBE-REF-1') {
      ok('the original payment reference is preserved, not overwritten');
    } else {
      bad('paymentRef', `overwritten with ${again.paymentRef}`);
    }

    // ----------------------------------------------------------------------- [6]

    console.log('\n[6] a paid order cannot be cancelled into an entitlement refund');

    try {
      await orderService.markUnpaid(order._id, 'CANCELLED');
      bad('cancel a paid order', 'allowed — refunds need their own path (BR-02)');
    } catch (e) {
      ok('refused: ' + e.message);
    }

    // ----------------------------------------------------------------------- [7]

    console.log('\n[7] vendors see only their own orders');

    const mine = await orderService.findForVendorById(order._id, vendorA);
    if (mine) ok('the buyer can read their own order');
    else bad('buyer read', 'order not found');

    const theirs = await orderService.findForVendorById(order._id, vendorB);
    if (!theirs) ok('another vendor cannot read it (IDOR closed)');
    else bad('IDOR', 'a second vendor read an order they did not buy');

    // ----------------------------------------------------------------------- [8]

    console.log('\n[8] consumption still works against a granted entitlement — BR-05');

    const active = await entitlementService.findActiveForVendor(vendorA);
    if (active.length === 1) ok('the entitlement is listed as active');
    else bad('findActiveForVendor', `${active.length} found, expected 1`);

    // One property id, reused. The restore matches its consumption entry by that id, so
    // passing a fresh id here decrements the count but marks nothing — the first run of
    // this script reported that as broken bookkeeping when the fixture was at fault.
    const probeProperty = oid();

    const consumed = await entitlementService.consume(vendorA, probeProperty, 'probe');
    if (consumed && consumed.consumedCount === 1) ok('one listing consumed');
    else bad('consume', `got consumedCount ${consumed && consumed.consumedCount}`);

    const restored = await entitlementService.restoreManual(
      consumed._id,
      probeProperty,
      oid(),
      'probe_restore'
    );
    if (restored && restored.consumedCount === 0) ok('admin restore returns the unit (BR-05)');
    else bad('restoreManual', `got consumedCount ${restored && restored.consumedCount}`);

    // The restore recorded which listing it reversed, rather than appending a second entry.
    const afterRestore = await RealEstateListingEntitlement.collection.findOne({
      _id: consumed._id,
    });
    const entries = afterRestore.consumptions || [];

    if (entries.length === 1) {
      ok('still one consumption entry — restore mutates, it does not append');
    } else {
      bad('restore bookkeeping', `${entries.length} entries, expected 1`);
    }

    const restoredEntries = entries.filter((c) => c.restoredAt);
    if (restoredEntries.length === 1) ok('the matching entry is marked restored');
    else bad('restore marker', `${restoredEntries.length} restored entries, expected 1`);

    // Restoring a property that was never consumed must be a no-op, not a free unit.
    const before = (await RealEstateListingEntitlement.collection.findOne({ _id: consumed._id }))
      .consumedCount;
    await entitlementService.restoreManual(consumed._id, oid(), oid(), 'probe_wrong_property');
    const after = (await RealEstateListingEntitlement.collection.findOne({ _id: consumed._id }))
      .consumedCount;
    if (before === after) ok('restoring an unrelated property changes nothing');
    else bad('restore scope', `consumedCount went ${before} -> ${after}`);
  } finally {
    // -------------------------------------------------------------------- cleanup

    console.log('\n[cleanup]');

    // Disconnect last. An earlier version disconnected before its final count, which threw
    // `MongoNotConnectedError` and left the exit code reporting a crash rather than a
    // result.
    await RealEstateListingOrder.deleteMany({ 'packageSnapshot.code': CODE });
    await RealEstateListingEntitlement.deleteMany({ 'packageSnapshot.code': CODE });
    await RealEstateListingPackage.deleteMany({ code: CODE });

    const left =
      (await RealEstateListingPackage.countDocuments({ code: CODE })) +
      (await RealEstateListingOrder.countDocuments({ 'packageSnapshot.code': CODE })) +
      (await RealEstateListingEntitlement.countDocuments({ 'packageSnapshot.code': CODE }));

    if (left === 0) ok('probe package, orders and entitlements removed');
    else bad('cleanup', `${left} probe document(s) left behind`);

    await mongoose.disconnect().catch(() => {});
  }

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of ${passed + failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`ALL ${passed} PACKAGE CHECKS PASSED`);
})();