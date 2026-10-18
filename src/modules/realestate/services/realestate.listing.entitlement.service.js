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

const RealEstateListingEntitlement = require('../models/realestate.listing.entitlement.model');
const RealEstateListingPackage = require('../models/realestate.listing.package.model');
const RealEstateListingOrder = require('../models/realestate.listing.order.model');
const auditService = require('./realestate.audit.service');

/**
 * Consume one entitlement from the vendor's active entitlements.
 *
 * Policy:
 *   - Finds the earliest-expiring ACTIVE entitlement with remaining > 0
 *   - Atomically increments consumedCount and pushes a consumption record
 *   - Returns the entitlement that was consumed, or null if none available
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {mongoose.Types.ObjectId} propertyId — the listing being created
 * @param {string} reason — e.g. 'listing_create', 'admin_restore'
 * @returns {Promise<Object|Cnull>} entitlement document or null
 */
async function consume(vendorId, propertyId, reason = 'listing_create') {
  const now = new Date();

  // 1️⃣ Find the best entitlement: earliest effectiveTo (FIFO), active, with remaining > 0
  const entitlement = await RealEstateListingEntitlement.findOne({
    vendor: vendorId,
    status: 'ACTIVE',
    effectiveTo: { $gte: now }, // not expired
    $or: [
      { totalCount: null }, // unlimited
      { $expr: { $lt: ['$consumedCount', '$totalCount'] } }, // has remaining
    ],
  })
    .sort({ effectiveFrom: 1 }) // first-purchased, first-consumed
    .lean();

  if (!entitlement) {
    return null; // nothing to consume
  }

  // 2️⃣ Atomic update: increment consumedCount and record the consumption
  const updated = await RealEstateListingEntitlement.findByIdAndUpdate(
    entitlement._id,
    {
      $inc: { consumedCount: 1 },
      $push: {
        consumptions: {
          property: propertyId,
          at: now,
          reason,
        },
      },
    },
    { new: true, runValidators: true }
  );

  // BR-20 — every consumption is a money movement. Record it separately so the
  // audit row carries the resulting consumedCount, which is what a reconciliation
  // needs. This is separate from consume() so the null branch has its own call site.
  await auditService.record({
    eventType: 'ENTITLEMENT_CONSUMED',
    targetType: 'ListingEntitlement',
    targetId: entitlement._id,
    actorType: 'VENDOR',
    after: { consumedCount: updated.consumedCount },
    metadata: {
      property: String(propertyId),
      vendor: String(entitlement.vendor),
      remaining:
        entitlement.totalCount === null
          ? null
          : entitlement.totalCount - updated.consumedCount,
    },
  });

  return updated;
}

/**
 * Audit a consumption after it has happened.
 *
 * Split from `consume()` deliberately: `consume()` returns `null` when there is nothing to
 * consume, and the two outcomes — "consumed one unit" and "there was none" — are very
 * different facts. Folding the audit into the same function meant the null branch needed its
 * own call site, which is exactly the kind of thing that gets forgotten on a later edit.
 *
 * @param {object} entitlement — the updated entitlement document from `consume()`
 * @param {mongoose.Types.ObjectId} propertyId — the listing that consumed a unit
 */
async function auditConsumption(entitlement, propertyId) {
  await auditService.record({
    eventType: 'ENTITLEMENT_CONSUMED',
    targetType: 'ListingEntitlement',
    targetId: entitlement._id,
    actorType: 'VENDOR',
    after: { consumedCount: entitlement.consumedCount },
    metadata: {
      property: String(propertyId),
      vendor: String(entitlement.vendor),
      remaining:
        entitlement.totalCount === null
          ? null
          : entitlement.totalCount - entitlement.consumedCount,
    },
  });
}

/**
 * Moderation progression of a listing, in the order `status` moves forward.
 *
 * Kept to the seven values in `RealEstateListing.status`. An earlier version of this file
 * used `['DRAFT', 'SUBMITTED', 'PUBLISHED']`, and `PUBLISHED` is not a listing status at
 * all — every real value except DRAFT and SUBMITTED looked "above" it, so an unknown or
 * REJECTED status silently ranked above the SUBMITTED boundary.
 */
const LISTING_PROGRESSION = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED',
  'ON_HOLD',
  'REJECTED',
  'ARCHIVED',
];

/** The point of no return: at or past this, the entitlement is spent. */
const SPENT_AT = 'SUBMITTED';

/**
 * Check whether a given listing may be restored to the vendor's entitlement.
 *
 * BR-05: "Creating a property consumes exactly one listing entitlement. Deleting or
 * archiving does not restore it once the listing has reached `SUBMITTED`. Below
 * `SUBMITTED`, deletion restores the entitlement and is not abuse."
 *
 * So restore is allowed **below** SUBMITTED and denied **at or beyond** it.
 *
 * ## The comparison was inverted
 *
 * The previous version read:
 *
 *     if (currentIndex <= submitIndex) return false;   // "at SUBMITTED or above"
 *
 * With `DRAFT` at index 0 and `SUBMITTED` at index 1, that denies `DRAFT` — the one status
 * the rule explicitly allows. Its own comment said "Listing is DRAFT or below" on the
 * branch that returned `true`. Any test of the DRAFT case would have caught it, which is
 * why `verify.realestate.entitlement.js` matters: it had never run, so nothing did.
 *
 * `restoreIfEligible` is pure and takes no database handle, so it is called directly here.
 *
 * @param {mongoose.Types.ObjectId} entitlementId — unused; kept for call-site symmetry
 * @param {mongoose.Types.ObjectId} propertyId — unused; kept for call-site symmetry
 * @param {string} listingStatus — the current status of the listing
 * @returns {boolean} true if restore is eligible
 */
function restoreIfEligible(entitlementId, propertyId, listingStatus) {
  const currentIndex = LISTING_PROGRESSION.indexOf(listingStatus);
  const spentIndex = LISTING_PROGRESSION.indexOf(SPENT_AT);

  // An unrecognised status is not "below SUBMITTED". Defaulting to `true` here would hand
  // back an entitlement for a listing in a state nobody reasoned about.
  if (currentIndex === -1) return false;

  return currentIndex < spentIndex;
}

/**
 * Admin‑only manual restore of an entitlement.
 *
 * This bypasses the BR-05 check entirely. Only an admin may call this.
 * It pushes a restoration record and increments remaining count.
 *
 * @param {mongoose.Types.ObjectId} entitlementId
 * @param {mongoose.Types.ObjectId} propertyId — the listing being un-charged
 * @param {mongoose.Types.ObjectId} adminId — the admin performing the restore
 * @param {string} reason — e.g. 'admin_manual_restore', 'system_migration'
 * @returns {Promise<Object|null>} updated entitlement document, or null if not found
 */
async function restoreManual(entitlementId, propertyId, adminId, reason = 'admin_manual_restore') {
  const updated = await RealEstateListingEntitlement.findOneAndUpdate(
    { _id: entitlementId, consumedCount: { $gt: 0 } },
    {
      $inc: { consumedCount: -1 },
      $set: {
        statusReason: `Manual restore by admin ${adminId}: ${reason}`,
      },
    },
    { new: true }
  );

  if (!updated) return null;

  await auditService.record({
    eventType: 'ENTITLEMENT_RESTORED',
    targetType: 'ListingEntitlement',
    targetId: updated._id,
    // BR-05: "Admin can restore manually, with a recorded reason." The reason is required,
    // so `recordOrThrow` — a lost audit row here means an untracked balance change.
    actor: adminId,
    actorType: 'ADMIN',
    reason,
    before: { consumedCount: updated.consumedCount + 1 },
    after: { consumedCount: updated.consumedCount },
    metadata: { property: String(propertyId) },
  });

  // Mark the specific consumption entry as restored rather than pushing a second one.
  // Two entries for the same listing would make the array disagree with consumedCount,
  // and BR-05 asks whether a listing was restored, which a single mutated entry answers.
  await RealEstateListingEntitlement.updateOne(
    { _id: entitlementId },
    { $set: { 'consumptions.$[entry].restoredAt': new Date(), 'consumptions.$[entry].restoreReason': reason, 'consumptions.$[entry].restoredBy': adminId } },
    { arrayFilters: [{ 'entry.property': propertyId, 'entry.restoredAt': { $exists: false } }] }
  );

  return RealEstateListingEntitlement.findById(entitlementId);
}

/**
 * Find all active entitlements for a vendor that have remaining capacity.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @returns {Promise<Array>} array of entitlement docs with remaining > 0
 */
async function findActiveForVendor(vendorId) {
  const now = new Date();

  return RealEstateListingEntitlement.find({
    vendor: vendorId,
    status: 'ACTIVE',
    effectiveTo: { $gte: now },
    $or: [
      { totalCount: null },
      { $expr: { $lt: ['$consumedCount', '$totalCount'] } },
    ],
  })
    .sort({ effectiveFrom: 1 })
    .lean();
}

/**
 * Grant one entitlement, recording which order paid for it.
 *
 * Called when an order reaches `PAID`. Per the order model's class doc, the two documents
 * are kept separate precisely so a half-finished payment leaves a trace: an unpaid order
 * has no entitlement, and a paid order always has one.
 *
 * ## Why `order` matters for the index
 *
 * `one_entitlement_per_order` is partial on `order` being an ObjectId, so an entitlement
 * granted administratively (no order) never collides with another. Recording the order is
 * what makes "one order yields at most one entitlement" enforceable rather than a comment.
 *
 * ## Idempotent
 *
 * If the order already has an entitlement, the existing one is returned untouched rather
 * than a second being created. Payment webhooks retry; a double-granted entitlement is
 * free listings that nobody paid for.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {mongoose.Types.ObjectId} packageId
 * @param {Object} packageSnapshot — frozen copy of the package at purchase (BR-15)
 * @param {mongoose.Types.ObjectId} [orderId] — the order that paid
 * @returns {Promise<Object>} the entitlement document
 */
async function grant(vendorId, packageId, packageSnapshot, orderId) {
  const pkg = await RealEstateListingPackage.findById(packageId).lean();
  if (!pkg) throw new Error('Package not found');

  const effectiveTo = pkg.durationDays
    ? new Date(Date.now() + pkg.durationDays * 24 * 60 * 60 * 1000)
    : undefined;

  const doc = {
    vendor: vendorId,
    package: packageId,
    packageSnapshot: { ...packageSnapshot, frozenAt: new Date() },
    // `null` means unlimited. Not a large number — the service checks for null explicitly.
    totalCount: pkg.listingCount === undefined ? null : pkg.listingCount,
    consumedCount: 0,
    effectiveFrom: new Date(),
    effectiveTo,
    status: 'ACTIVE',
  };
if (orderId) doc.order = orderId;

  const createdEntitlement = await RealEstateListingEntitlement.create(doc);

  // BR-20 “ entitlement grant is a money movement (it creates the right to list).
  // Audit it separately so the audit row has the full entitlement document.
  await auditService.record({
    eventType: 'ENTITLEMENT_GRANTED',
    targetType: 'ListingEntitlement',
    targetId: createdEntitlement._id,
    actorType: 'SYSTEM',
    after: { totalCount: createdEntitlement.totalCount, status: createdEntitlement.status },
    metadata: {
      order: orderId ? String(orderId) : null,
      packageCode: packageSnapshot && packageSnapshot.code,
      vendor: String(vendorId),
    },
  });

  return createdEntitlement;
}

/**
 * Return an entitlement for an order if one already exists.
 *
 * @param {mongoose.Types.ObjectId} orderId
 * @returns {Promise<Object|null>}
 */
async function findByOrder(orderId) {
  return RealEstateListingEntitlement.findOne({ order: orderId }).lean();
}

/**
 * Consume from the vendor's entitlement balance, guarding against exhaustion.
 *
 * This is a convenience wrapper around `consume()` that returns a descriptive
 * error if no entitlement is available, rather than returning null.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {mongoose.Types.ObjectId} propertyId
 * @returns {Promise<Object>} { success, entitlement, message }
 */
async function consumeSafe(vendorId, propertyId) {
  const entitlement = await consume(vendorId, propertyId);

  if (!entitlement) {
    return {
      success: false,
      message: 'No active entitlements remaining for this vendor.',
    };
  }

  return {
    success: true,
    entitlement,
    message: 'Entitlement consumed successfully.',
  };
}

module.exports = {
  LISTING_PROGRESSION,
  SPENT_AT,
  consume,
  consumeSafe,
  restoreIfEligible,
  restoreManual,
  findActiveForVendor,
  auditConsumption,
  grant,
  findByOrder,
};