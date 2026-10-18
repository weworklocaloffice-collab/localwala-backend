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
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate, slugGenerator } = require('../../../models/plugins');

/**
 * RealEstateVendor — a property vendor, agent or developer.
 *
 * ## The account and the vendor are different things
 *
 * `user` is the login. This document is the business identity that account operates as.
 * One account could in principle hold more than one vendor record (a developer with two
 * registered firms); the vendor is what a listing belongs to, and what a package is sold
 * to. Nothing in the vertical keys off `user` for ownership.
 *
 * ## Documents are embedded, and that is a deliberate trade
 *
 * A vendor has a small, bounded set of papers — identity, business registration, bank
 * proof. Unlike property documents, which are per-listing and grow, these are per-vendor
 * and stabilise. Embedding means one read answers "is this vendor verified" without a
 * join, which is the question asked on every listing submit.
 *
 * The cost is that a document cannot be queried across vendors without `$unwind`. That
 * is acceptable here because the cross-vendor question — "show me every PAN on file" —
 * is an audit query that runs rarely, and property documents (which do need that) live
 * in their own collection with the BR-18 visibility classes.
 *
 * ## `status` vs `verificationStatus`
 *
 * `status` is the account: may this vendor operate at all? `verificationStatus` is the
 * KYC gate: has an admin read the papers? They look similar and are not:
 *
 *   a vendor can be `status: ACTIVE` and `verificationStatus: PENDING`
 *     — registered, listing drafts, buying a package, but nothing publishes
 *   a vendor can be `status: SUSPENDED` and `verificationStatus: APPROVED`
 *     — verified once, suspended later for a conduct issue
 *
 * Collapsing them would make "suspend this vendor" imply "un-verify them", and the
 * papers were genuinely verified — the audit trail would then be a lie.
 */
const realEstateVendorSchema = mongoose.Schema(
  {
    /** The login this vendor operates as. */
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    // ---------------------------------------------------------------- business

    /**
     * What kind of vendor. Drives which documents are required — an individual needs
     * PAN and address proof; a developer also needs incorporation and GST papers.
     */
    businessType: {
      type: String,
      required: true,
      enum: ['INDIVIDUAL', 'AGENCY', 'DEVELOPER'],
      default: 'INDIVIDUAL',
    },

    businessName: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * How the vendor appears to a customer on a listing.
     *
     * Separate from `businessName` because a developer's registered name ("Sri Venkateswara
     * Infra Projects Pvt Ltd") is not what a customer should read ("Sri Venkateswara
     * Infra"). Blueprint §14 puts "Vendor Information" on the property page, so this is
     * customer-facing and is validated as such.
     */
    displayName: {
      type: String,
      required: false,
      trim: true,
    },

    description: {
      type: String,
      required: false,
      trim: true,
    },

    logo: {
      type: String,
      required: false,
      trim: true,
    },

    // -------------------------------------------------------------- contact

    contactPerson: {
      type: String,
      required: true,
      trim: true,
    },
    contactEmail: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
    },
    contactMobile: {
      type: String,
      required: false,
      trim: true,
    },
    contactCountryCode: {
      type: String,
      required: false,
      trim: true,
      default: '+91',
    },

    // ------------------------------------------------------------ tax and KYC
    //
    // Stored in clear. PAN and GSTIN are not secrets in the way a password is, and a
    // reviewer has to read them to verify them. `aadhaarLast4` holds only the last four
    // digits: the full number is never stored, because a leaked Aadhaar is a much bigger
    // problem than a leaked PAN and nothing in the vertical needs the whole number.

    pan: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },
    gstin: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },
    reraNumber: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },
    aadhaarLast4: {
      type: String,
      required: false,
      trim: true,
      maxlength: 4,
    },

    // -------------------------------------------------------------- bank
    //
    // Where a commission or refund is paid. Money destination, so this is
    // OWNER-only on the read side — see `stores.profile.service.js` for the same
    // pattern with bank details.

    bank: {
      accountName: { type: String, required: false, trim: true },
      accountNumber: { type: String, required: false, trim: true },
      ifsc: { type: String, required: false, trim: true, uppercase: true },
      bankName: { type: String, required: false, trim: true },
      branch: { type: String, required: false, trim: true },
      upiId: { type: String, required: false, trim: true },
    },

    // ------------------------------------------------------------ documents
    //
    // Embedded. See the class doc. `category` mirrors the property document vocabulary
    // so one admin component can render both.

    documents: {
      type: Array,
      default: undefined,
    },

    // --------------------------------------------------------------- status

    /**
     * Whether the account may operate. Independent of KYC — see the class doc.
     */
    status: {
      type: String,
      required: true,
      default: 'ACTIVE',
      enum: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
    },

    /**
     * The KYC gate. Only `APPROVED` may publish a listing (BR-03, BR-04).
     */
    verificationStatus: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUIRED'],
    },

    submittedAt: { type: Date, required: false },
    verifiedAt: { type: Date, required: false },
    verifiedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    /**
     * Why a vendor was rejected, suspended or asked for changes.
     *
     * Required on the write path for the same reason a property's `statusReason` is:
     * a vendor told "rejected" with no reason sends the same application back.
     */
    verificationReason: { type: String, required: false, trim: true },

    /**
     * The change requests from the last review, as a list.
     *
     * Separate from `verificationReason` because the vendor app renders this as a
     * checklist and the resubmission path compares against it.
     */
    changeRequests: {
      type: Array,
      default: undefined,
    },

    // --------------------------------------------------------- denormalised

    /**
     * Rolling counters for the vendor dashboard (blueprint §38).
     *
     * Denormalised for the same reason the property counters are: the dashboard sorts
     * and paginates on them.
     */
    activeListings: { type: Number, required: false, default: 0, min: 0 },
    totalListings: { type: Number, required: false, default: 0, min: 0 },

    slug: {
      type: String,
      source: 'businessName',
      unique: true,
    },

    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
realEstateVendorSchema.plugin(toJSON);
realEstateVendorSchema.plugin(paginate);
realEstateVendorSchema.plugin(slugGenerator);

// `unique: true` is on the slug field above, so it is NOT repeated here — repeating it
// makes Mongoose warn about a duplicate index on every boot. Same rule as
// vertical.model.js.

realEstateVendorSchema.index({ verificationStatus: 1, submittedAt: 1 });
realEstateVendorSchema.index({ status: 1, createdAt: -1 });
// Admin search by business name or contact.
realEstateVendorSchema.index({ businessName: 'text', displayName: 'text', contactPerson: 'text' });

/**
 * One vendor per user.
 *
 * Not a partial unique index: a user operating two firms is a real scenario, but it is
 * not one this phase supports and a unique index is the honest way to say so. Lifting it
 * later is a migration; leaving it off and discovering the dashboard double-counts is
 * worse.
 *
 * This is the ONLY `{ user: 1 }` index. Declaring a plain one above as well creates two
 * indexes over the same key pattern, which MongoDB rejects with IndexKeySpecsConflict on
 * first sync — the same defect the category model hit (F-23's neighbourhood).
 */
realEstateVendorSchema.index({ user: 1 }, { unique: true, name: 'one_vendor_per_user' });

/**
 * @typedef RealEstateVendor
 */
const RealEstateVendor = mongoose.model('RealEstateVendor', realEstateVendorSchema);

module.exports = RealEstateVendor;
