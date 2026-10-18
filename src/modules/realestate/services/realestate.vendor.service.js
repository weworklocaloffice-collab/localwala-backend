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

const RealEstateVendor = require('../models/realestate.vendor.model');
const entitlementService = require('./realestate.listing.entitlement.service');

/**
 * Vendor service — registration, KYC state, document management.
 *
 * Exported functions (used by the route handlers):
 *   - registerVendor(payload, userId)           → create + save
 *   - submitForReview(vendorId, userId)         → move PENDING → UNDER_REVIEW
 *   - approveVendor(vendorId, adminId)          → move → APPROVED
 *   - rejectVendor(vendorId, adminId, reason)   → move → REJECTED
 *   - suspendVendor(vendorId, adminId, reason)  → move → SUSPENDED
 *   - findByUser(userId)                       → get vendor by login
 *   - findActiveVendors()                     → list ACTIVE vendors
 *   - verifyDocument(vendorId, docCategory)    → mark a doc as verified
 *   - getVendorDashboard(vendorId)            → counters + status
 */

/**
 * Register a new vendor account.
 *
 * Creates the RealEstateVendor document linked to the User account.
 * The vendor starts in a KYC‑pending state; only APPROVED vendors may publish
 * listings (BR-03, BR-04).
 *
 * @param {Object} payload — { businessName, businessType, displayName, ... }
 * @param {mongoose.Types.ObjectId} userId — the User account doing the registering
 * @returns {Promise<Object>} the saved vendor document
 */
async function registerVendor(payload, userId) {
  const vendor = new RealEstateVendor({
    user: userId,
    businessName: payload.businessName,
    businessType: payload.businessType || 'INDIVIDUAL',
    displayName: payload.displayName,
    description: payload.description,
    logo: payload.logo,

    // Contact
    contactPerson: payload.contactPerson,
    contactEmail: payload.contactEmail,
    contactMobile: payload.contactMobile,
    contactCountryCode: payload.contactCountryCode || '+91',

    // KYC / tax
    pan: payload.pan,
    gstin: payload.gstin,
    reraNumber: payload.reraNumber,
    aadhaarLast4: payload.aadhaarLast4,

    // Bank
    bank: {
      accountName: payload.bankAccountName,
      accountNumber: payload.bankAccountNumber,
      ifsc: payload.bankIfsc,
      bankName: payload.bankName,
      branch: payload.branch,
      upiId: payload.upiId,
    },

    // Status flow: PENDING → (UNDER_REVIEW|REJECTED) / APPROVED / SUSPENDED
    status: 'PENDING',
    verificationStatus: 'PENDING',

    // Empty arrays — will be populated on upload
    documents: [],

    // Counters
    activeListings: 0,
    totalListings: 0,

    // Generated slug from businessName
    slug: `${payload.businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`,
  });

  await vendor.save();
  return vendor;
}

/**
 * Move a vendor from PENDING to UNDER_REVIEW, recording the submission time.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {mongoose.Types.ObjectId} userId — the vendor's own user id
 * @returns {Promise<Object>} updated vendor doc
 */
async function submitForReview(vendorId, userId) {
  const vendor = await RealEstateVendor.findById(vendorId);
  if (!vendor) throw new Error('Vendor not found');

  vendor.status = 'UNDER_REVIEW';
  vendor.verificationStatus = 'UNDER_REVIEW';
  vendor.submittedAt = new Date();
  vendor.verifiedBy = userId; // the vendor self‑submitting

  await vendor.save();
  return vendor;
}

/**
 * Admin approves a vendor — moves verification to APPROVED.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {mongoose.Types.ObjectId} adminId — the admin user id
 * @returns {Promise<Object>} updated vendor doc
 */
async function approveVendor(vendorId, adminId) {
  const vendor = await RealEstateVendor.findById(vendorId);
  if (!vendor) throw new Error('Vendor not found');

  vendor.verificationStatus = 'APPROVED';
  vendor.verifiedAt = new Date();
  vendor.verifiedBy = adminId;
  vendor.verificationReason = undefined;
  vendor.changeRequests = [];

  await vendor.save();
  return vendor;
}

/**
 * Admin rejects a vendor — records the reason.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {mongoose.Types.ObjectId} adminId
 * @param {string} reason — free‑text explanation
 * @returns {Promise<Object>} updated vendor doc
 */
async function rejectVendor(vendorId, adminId, reason) {
  const vendor = await RealEstateVendor.findById(vendorId);
  if (!vendor) throw new Error('Vendor not found');

  vendor.verificationStatus = 'REJECTED';
  vendor.verifiedAt = new Date();
  vendor.verifiedBy = adminId;
  vendor.verificationReason = reason;

  await vendor.save();
  return vendor;
}

/**
 * Admin suspends a vendor — blocks them from publishing.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {mongoose.Types.ObjectId} adminId
 * @param {string} reason — e.g. 'conduct', 'KYC_fail'
 * @returns {Promise<Object>} updated vendor doc
 */
async function suspendVendor(vendorId, adminId, reason) {
  const vendor = await RealEstateVendor.findById(vendorId);
  if (!vendor) throw new Error('Vendor not found');

  vendor.status = 'SUSPENDED';
  vendor.verificationStatus = 'REJECTED';
  vendor.verifiedAt = new Date();
  vendor.verifiedBy = adminId;
  vendor.verificationReason = reason;

  await vendor.save();
  return vendor;
}

/**
 * Find a vendor by the underlying User id.
 *
 * @param {mongoose.Types.ObjectId} userId
 * @returns {Promise<Object|null>} vendor doc or null
 */
async function findByUser(userId) {
  return RealEstateVendor.findOne({ user: userId }).lean();
}

/**
 * List all vendors that are currently ACTIVE (verificationStatus === APPROVED).
 *
 * @returns {Promise<Array>} array of vendor docs
 */
async function findActiveVendors() {
  return RealEstateVendor.find({
    status: 'ACTIVE',
    verificationStatus: 'APPROVED',
  })
    .sort({ businessName: 1 })
    .lean();
}

/**
 * Mark a vendor document as verified.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {string} docCategory — one of the document categories
 * @returns {Promise<Object>} updated vendor doc
 */
async function verifyDocument(vendorId, docCategory) {
  const vendor = await RealEstateVendor.findById(vendorId);
  if (!vendor) throw new Error('Vendor not found');

  // Ensure documents array exists
  if (!vendor.documents) {
    vendor.documents = [];
  }

  // Push or update the document entry for this category
  const existingIdx = vendor.documents.findIndex(
    (d) => d.category === docCategory
  );

  if (existingIdx >= 0) {
    vendor.documents[existingIdx].status = 'VERIFIED';
    vendor.documents[existingIdx].verifiedAt = new Date();
  } else {
    vendor.documents.push({
      category: docCategory,
      status: 'VERIFIED',
      fileUrl: null,
      fileName: null,
      verifiedAt: new Date(),
    });
  }

  await vendor.save();
  return vendor;
}

/**
 * Build the dashboard data for a vendor's listing panel.
 *
 * Returns: activeListings, totalListings, verificationStatus, status,
 *          how many entitlements remain, and a flag whether they may publish.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @returns {Promise<Object>} dashboard summary
 */
async function getVendorDashboard(vendorId) {
  const vendor = await RealEstateVendor.findById(vendorId).lean();
  if (!vendor) throw new Error('Vendor not found');

  // How many entitlements remain?
  //
  // This calls `findActiveForVendor`, a *service* function. It was never imported, so
  // this line threw `ReferenceError: RealEstateListingEntitlement is not defined` at
  // request time — the vendor dashboard has been a 500 for every caller, and no test
  // reached it. The model has no such static method either, so the service is the right
  // target.
  const activeEntitlements = await entitlementService.findActiveForVendor(vendorId);

  let remaining = 0;
  if (activeEntitlements.length > 0) {
    remaining = activeEntitlements.reduce(
      (sum, ent) => sum + (ent.totalCount - ent.consumedCount),
      0
    );
    // If any package is unlimited, remaining is effectively unlimited
    if (activeEntitlements.some((e) => e.totalCount === null)) {
      remaining = -1; // sentinel for "unlimited"
    }
  }

  return {
    vendorId: vendor._id,
    businessName: vendor.businessName,
    displayName: vendor.displayName,
    businessType: vendor.businessType,
    verificationStatus: vendor.verificationStatus,
    status: vendor.status,
    activeListings: vendor.activeListings,
    totalListings: vendor.totalListings,
    remainingEntitlements: remaining, // >= 0 or -1 for unlimited
    mayPublish:
      vendor.verificationStatus === 'APPROVED' && vendor.status === 'ACTIVE',
    submittedAt: vendor.submittedAt,
    verifiedAt: vendor.verifiedAt,
  };
}

module.exports = {
  registerVendor,
  submitForReview,
  approveVendor,
  rejectVendor,
  suspendVendor,
  findByUser,
  findActiveVendors,
  verifyDocument,
  getVendorDashboard,
};