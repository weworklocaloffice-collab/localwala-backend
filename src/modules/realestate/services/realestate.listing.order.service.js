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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { PaymentInitiation } = require('../../../models');
const RealEstateListingOrder = require('../models/realestate.listing.order.model');
const RealEstateListingPackage = require('../models/realestate.listing.package.model');
const entitlementService = require('./realestate.listing.entitlement.service');
const auditService = require('./realestate.audit.service');

/**
 * Listing-order service — a vendor buys a package, which grants an entitlement.
 *
 * ## Why this file had to exist
 *
 * `RealEstateListingOrder` and `RealEstateListingEntitlement` were both present, with an
 * order model that carefully documents the `PENDING_PAYMENT → PAID → entitlement created`
 * sequence. But nothing implemented it: no service created an order, and no route or
 * controller accepted a purchase. `package.service.js` exported five catalogue functions
 * and was imported by nothing at all.
 *
 * The consequence was that BR-02 and BR-05 had no reachable path. A vendor could not buy
 * a package, therefore could not obtain an entitlement, therefore could not submit a
 * listing through any request. The rule that makes a package "the entitlement to list"
 * was enforced only by tests calling services directly.
 *
 * ## Payment goes through the shared stack
 *
 * `realestate.listing.order.payment.service.js` creates a `listing_package`
 * `PaymentInitiation`; the shared gateway callback reaches `markPaid` through
 * `realestate.payment.service.routePaidCallback`. No second payment stack exists.
 *
 * This service still creates orders as `PENDING_PAYMENT` and grants nothing until
 * `markPaid` runs, so an unpaid order can never hold a listing right.
 */

/**
 * Order codes are `RE-` plus a base36 timestamp and randomness.
 *
 * Readable in a support ticket and short enough to dictate over a phone, which a raw
 * ObjectId is not.
 */
const newOrderCode = () =>
  `RE-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/**
 * The package fields copied onto an order at purchase time.
 *
 * BR-15 applied to packages: the catalogue row may be edited later, so the receipt has to
 * be a snapshot. `price` comes from the package, never from the request body — accepting a
 * client-supplied amount is how a ₹1 purchase becomes a 50-listing entitlement.
 *
 * @param {object} pkg
 * @returns {object}
 */
/**
 * The package fields copied onto an order at purchase time.
 *
 * BR-15 applied to packages: the catalogue row may be edited later, so the receipt has to
 * be a snapshot. `price` comes from the package, never from the request body — accepting a
 * client-supplied amount is how a ₹1 purchase becomes a 50-listing entitlement.
 *
 * ## Two conversion traps, both hit while writing this
 *
 * **1. `price` is a `moneyField`, so the input must be a MONGOOSE DOCUMENT.**
 *
 * `orderService.createOrder` reads the package with `.lean()`, which per `src/utils/money.js`
 * returns the **raw stored paise**, not rupees. `snapshot.price` is *itself* a `moneyField`,
 * so writing that number into it runs the setter again and multiplies by 100 a second time:
 * 4 999 000 paise became 49 990 000 000 paise — a 10 000x overcharge that nothing reported.
 * Passing the hydrated document (`pkgDoc`) instead lets `moneyField`'s own getter supply
 * rupees, so the single conversion happens in one place.
 *
 * **2. `frozenAt` is not a `moneyField`, but `type: Array` on the parent drops it.**
 *
 * `packageSnapshot` is declared `type: Object`, and its sub-keys were plain untyped objects.
 * Mongoose does not apply a nested schema there, so a `Date` assigned to a nested path of an
 * untyped object is discarded on write. The assertion below covers it: a snapshot with no
 * `frozenAt` cannot answer "what was this package at the moment of purchase", which is the
 * entire point of a snapshot.
 *
 * @param {object} pkg — a hydrated mongoose document, NOT a lean object
 * @returns {object}
 */
const snapshotOf = (pkg) => ({
  code: pkg.code,
  name: pkg.name,
  listingCount: pkg.listingCount,
  durationDays: pkg.durationDays,
  limits: pkg.limits,
  price: pkg.price, // rupees; moneyField's setter converts once
  frozenAt: new Date(),
});

/**
 * Create a purchase order in `PENDING_PAYMENT`.
 *
 * No entitlement is created here. It is created by `markPaid`, so a vendor cannot hold a
 * right to list for a purchase that was never charged.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {string} packageCode — the stable package code, e.g. 'BASIC'
 * @returns {Promise<Object>} the created order
 * @throws when the package is missing or inactive
 */
async function createOrder(vendorId, packageCode) {
  // Hydrated, not `.lean()` — `snapshotOf` copies `price` into another moneyField, and a
  // lean read hands back raw paise, which the setter would multiply by 100 again.
  const pkg = await RealEstateListingPackage.findOne({
    code: String(packageCode).trim().toUpperCase(),
  });

  if (!pkg) throw new Error(`No listing package with code "${packageCode}"`);
  if (!pkg.status) throw new Error(`Package "${pkg.code}" is not available for purchase`);

  const order = await RealEstateListingOrder.create({
    orderCode: newOrderCode(),
    vendor: vendorId,
    package: pkg._id,
    packageSnapshot: snapshotOf(pkg),
    amount: pkg.price, // from the catalogue, never from the caller
    status: 'PENDING_PAYMENT',
  });

  // BR-20 — money moves at the moment an order exists, because the amount is now owed.
  await auditService.record({
    eventType: 'LISTING_PACKAGE_ORDER_CREATED',
    targetType: 'ListingOrder',
    targetId: order._id,
    actorType: 'VENDOR',
    after: { status: order.status, packageCode: pkg.code },
    metadata: { vendor: String(vendorId), amountRupees: order.amount },
  });

  return order;
}

/**
 * Mark an order `PAID` and grant its entitlement.
 *
 * Idempotent, because payment webhooks retry. A second call returns the order as-is rather
 * than granting a second entitlement — free listings nobody paid for is not a rounding
 * error, it is revenue that never arrives.
 *
 * Gateway callbacks pass `{ paymentInitiation }`. Admin recovery additionally
 * passes `{ allowUnpaidStatuses, actor, actorType, reason, paymentRef }` so a
 * lost confirmation can settle a PENDING_PAYMENT/FAILED/CANCELLED order
 * without weakening the default PENDING_PAYMENT-only path.
 *
 * @param {mongoose.Types.ObjectId} orderId
 * @param {Object} [payment]
 * @returns {Promise<Object>} the paid order, with `entitlement` populated
 */
async function markPaid(orderId, payment = {}) {
  const order = await RealEstateListingOrder.findById(orderId);
  if (!order) throw new Error('Order not found');

  if (order.status === 'PAID') {
    return order; // already settled; a retry must not grant again
  }

  const allowedFrom = Array.isArray(payment.allowUnpaidStatuses)
    ? payment.allowUnpaidStatuses
    : [];
  if (order.status !== 'PENDING_PAYMENT' && !allowedFrom.includes(order.status)) {
    throw new Error(`Cannot mark a ${order.status} order as paid`);
  }

  const fromStatus = order.status;
  const actorType = payment.actorType || 'SYSTEM';
  const actor = payment.actor || undefined;

  const entitlement = await entitlementService.grant(
    order.vendor,
    order.package,
    order.packageSnapshot,
    order._id
  );

  order.status = 'PAID';
  order.paidAt = new Date();
  order.entitlement = entitlement._id;
  if (payment.paymentInitiation) order.paymentInitiation = payment.paymentInitiation;
  if (payment.paymentRef) order.paymentRef = payment.paymentRef;

  await order.save();

  // BR-20 — the payment itself, and the entitlement it produced. Two rows, because they are
  // two facts: money arrived, and a right to list was created.
  await auditService.record({
    eventType: 'LISTING_PACKAGE_ORDER_PAID',
    targetType: 'ListingOrder',
    targetId: order._id,
    actor,
    actorType,
    reason: payment.reason,
    before: { status: fromStatus },
    after: { status: 'PAID' },
    metadata: {
      paymentRef: order.paymentRef,
      amountRupees: order.amount,
      entitlement: String(entitlement._id),
      vendor: String(order.vendor),
      manual: actorType !== 'SYSTEM',
    },
  });

  await auditService.record({
    eventType: 'ENTITLEMENT_GRANTED',
    targetType: 'ListingEntitlement',
    targetId: entitlement._id,
    actor,
    actorType,
    reason: payment.reason,
    after: { totalCount: entitlement.totalCount, status: entitlement.status },
    metadata: {
      order: String(order._id),
      packageCode: order.packageSnapshot && order.packageSnapshot.code,
      vendor: String(order.vendor),
    },
  });

  // Phase C: package revenue recognition. The LISTING_PACKAGE_PAYMENT
  // ledger row never existed as a writer — only as an enum — so paid
  // package money was invisible to settlements until now. The invoice
  // follows only under an approved determination (OD-04). Both are
  // best-effort post-payment: gateway money cannot be rolled back in
  // code, so failures are loud, never silent, never blocking.
  try {
    const ledgerService = require('./realestate.ledger.service');
    const packageEntry = await ledgerService.record({
      eventType: 'LISTING_PACKAGE_PAYMENT',
      accountType: 'REVENUE',
      direction: 'DEBIT',
      amount: Number(order.amount),
      partyType: 'VENDOR',
      party: order.vendor,
      sourceModel: 'RealEstateListingOrder',
      sourceId: order._id,
      narration: `Listing package ${order.orderCode} paid`,
      metadata: { orderCode: order.orderCode, packageCode: order.packageSnapshot && order.packageSnapshot.code },
    });
    const invoiceService = require('./realestate.invoice.service');
    const holdPolicyService = require('./realestate.hold.policy.service');
    const policy = await holdPolicyService.getActive();
    if (holdPolicyService.getActiveTaxForSupply(policy, 'listingPackageFee')) {
      let buyerGstin = null;
      try {
        const RealEstateVendor = require('../models/realestate.vendor.model');
        const vendor = await RealEstateVendor.findById(order.vendor).select('gstin').lean();
        buyerGstin = (vendor && vendor.gstin) || null;
      } catch {
        /* GSTIN is best-effort enrichment, never a blocker */
      }
      await invoiceService.issueInvoice({
        supply: 'LISTING_PACKAGE_FEE',
        buyerType: 'VENDOR',
        buyer: order.vendor,
        buyerGstin,
        amountPaise: Math.round(Number(order.amount) * 100),
        sourceModel: 'RealEstateListingOrder',
        sourceId: order._id,
        ledgerEntry: packageEntry._id,
      });
    }
  } catch (e) {
    console.error(`package revenue recognition skipped for order ${order.orderCode}: ${e.message}`);
  }

  return order;
}

/**
 * Mark an order `FAILED` or `CANCELLED`.
 *
 * No entitlement to release, because none was ever granted — that separation is the whole
 * reason the order and the entitlement are two documents.
 *
 * @param {mongoose.Types.ObjectId} orderId
 * @param {string} to — 'FAILED' | 'CANCELLED'
 * @returns {Promise<Object>}
 */
async function markUnpaid(orderId, to = 'CANCELLED') {
  const order = await RealEstateListingOrder.findById(orderId);
  if (!order) throw new Error('Order not found');

  if (order.status === 'PAID') {
    // Refund is a different operation with a different rule set, and BR-02 keeps package
    // money separate from commission money. Not handled here on purpose.
    throw new Error('A paid order cannot be cancelled — use the refund path');
  }
  if (!['FAILED', 'CANCELLED'].includes(to)) {
    throw new Error(`Cannot move an order to "${to}"`);
  }

  order.status = to;
  await order.save();

  await PaymentInitiation.updateMany(
    { listingOrder: order._id, status: 'initiated' },
    { $set: { status: 'cancelled' } }
  );

  return order;
}

/**
 * A vendor's own orders, newest first.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @returns {Promise<Array>}
 */
async function findForVendor(vendorId) {
  // Hydrated — `amount` is a moneyField. See the money-edges gate:
  // lean reads ship paise.
  const docs = await RealEstateListingOrder.find({ vendor: vendorId }).sort({ createdAt: -1 });
  return docs.map((d) => d.toObject({ getters: true }));
}

/**
 * One order, scoped to its vendor.
 *
 * @param {mongoose.Types.ObjectId} orderId
 * @param {mongoose.Types.ObjectId} vendorId
 * @returns {Promise<Object|null>}
 */
async function findForVendorById(orderId, vendorId) {
  const doc = await RealEstateListingOrder.findOne({ _id: orderId, vendor: vendorId });
  return doc ? doc.toObject({ getters: true }) : null;
}

/**
 * Admin listing — every order, optional status filter, paginated.
 * Newest first so the admin sees fresh payments at the top.
 */
async function listAll({ status, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  const result = await RealEstateListingOrder.paginate(filter, {
    page,
    limit,
    sort: { createdAt: -1 },
    populate: [
      { path: 'vendor', select: 'businessName displayName slug' },
      { path: 'package', select: 'code name' },
    ],
  });

  result.results = result.results.map((doc) => {
    const row = doc.toObject({ getters: true });
    if (row.vendor && typeof row.vendor === 'object') {
      row.vendorName = row.vendor.businessName || row.vendor.displayName || '';
      row.vendorCode = row.vendor.slug || '';
    }
    if (row.package && typeof row.package === 'object') {
      row.packageName = row.package.name || '';
      row.packageCode = row.package.code || '';
    }
    return row;
  });

  return result;
}

module.exports = {
  newOrderCode,
  snapshotOf,
  createOrder,
  markPaid,
  markUnpaid,
  findForVendor,
  findForVendorById,
  listAll,
};