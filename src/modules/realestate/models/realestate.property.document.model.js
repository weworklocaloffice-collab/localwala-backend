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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstatePropertyDocument — one document attached to a listing.
 *
 * ## The visibility class is the whole point of this model (BR-18)
 *
 * Blueprint §48: "Not every document should be customer-visible." So every document
 * carries a `visibility` class, and `realestate.document.access.js` filters on it in
 * **middleware**, not in a response mapper.
 *
 * A response mapper is one forgotten `.select()` away from leaking a vendor's PAN
 * into a customer payload. A middleware is one missing route-mount away. The second
 * fails less often, and when it fails it fails in one place.
 *
 *   CUSTOMER_VISIBLE  ownership and approval documents a buyer is entitled to see
 *   BANK_VISIBLE      income and tax papers a lender needs for assessment
 *   INTERNAL          working papers, visible to the owning vendor and admins
 *   ADMIN_ONLY        reviewer material, never leaves the admin surface
 *
 * ## A separate model, not a subdocument on the property
 *
 * Subdocuments would be read with every property read, which means every search result
 * carries its document list. Documents are read by a dedicated endpoint and joined.
 *
 * ## Never hard-deleted
 *
 * `checksum` lets a re-uploaded file be recognised as the same document, and
 * `supersededBy` records a replacement without destroying the original. A property
 * that has had a title deed challenged needs the trail intact (BR-21).
 */
const realEstatePropertyDocumentSchema = mongoose.Schema(
  {
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    /**
     * Which category of document this is. Drives the verification checklist — an
     * `APPROVED` property must have cleared `OWNERSHIP` and `APPROVAL`, and which
     * categories those are differs by property type.
     *
     * A real enum, not a free string with a comment listing the values. A free string
     * makes "OWNERSHIP", "Ownership" and "ownership" three different categories, and
     * the verification checklist matches on this value — so a typo would silently mean
     * "this property has no ownership document" rather than failing.
     */
    category: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: ['OWNERSHIP', 'APPROVAL', 'TAX', 'ENCUMBRANCE', 'PROJECT', 'SELLER', 'OTHER'],
    },

    /** BR-18. The access class. See the class doc. */
    visibility: {
      type: String,
      required: true,
      default: 'INTERNAL',
      enum: ['INTERNAL', 'CUSTOMER_VISIBLE', 'BANK_VISIBLE', 'ADMIN_ONLY'],
    },

    /** Human label, e.g. "Sale Deed" or "Encumbrance Certificate". */
    title: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * The file. Stored through `media.service` like an image; `url` is what the
     * authorised reader resolves, and it is never returned to an unauthorised one.
     */
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: false,
      trim: true,
    },
    mimeType: {
      type: String,
      required: false,
      trim: true,
    },
    sizeBytes: {
      type: Number,
      required: false,
      min: 0,
    },

    /**
     * Content hash of the uploaded file.
     *
     * Lets a re-upload be recognised as the same document, and lets two properties
     * sharing a template document be spotted in an audit. Not a security control —
     * authorisation does not depend on it.
     */
    checksum: {
      type: String,
      required: false,
      trim: true,
    },

    /** Free-text note from the uploader or the reviewer. */
    notes: {
      type: String,
      required: false,
      trim: true,
    },

    // --------------------------------------------------------- verification

    /**
     * Whether a reviewer has confirmed this document.
     *
     * Separate from the property's `verifiedAt`: a property can be half-verified, and
     * the reviewer needs to see exactly which paper is still outstanding.
     */
    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'REPLACED'],
    },
    verifiedAt: {
      type: Date,
      required: false,
    },
    verifiedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    rejectionReason: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * Set when this document is replaced by a newer upload.
     *
     * The original is kept, not deleted — a challenged title needs the full trail
     * (BR-21), and "the old deed disappeared" is not an answer anyone can give.
     */
    supersededBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyDocument',
      required: false,
    },

    uploadedBy: {
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

// add plugin that converts mongoose to json
realEstatePropertyDocumentSchema.plugin(toJSON);
realEstatePropertyDocumentSchema.plugin(paginate);

/**
 * The verification queue for a property, admin side: pending first, oldest first.
 */
realEstatePropertyDocumentSchema.index({ property: 1, status: 1, createdAt: 1 });

/**
 * "Show this customer the paperwork they are entitled to" is the query behind the
 * property page, so `visibility` leads the index rather than `property`.
 */
realEstatePropertyDocumentSchema.index({ property: 1, visibility: 1 });

/**
 * Bank document review. The compound key puts the property first because a reviewer
 * works one application at a time, not one bank at a time.
 */
realEstatePropertyDocumentSchema.index({ visibility: 1, property: 1, category: 1, status: 1 });

/**
 * One ACCEPTED document per (property, category).
 *
 * A property should not hold two accepted versions of its own sale deed. A partial
 * unique index rather than a validator, because the rule is about the collection's
 * current state and not about any single document — a validator cannot see the other
 * rows.
 */
realEstatePropertyDocumentSchema.index(
  { property: 1, category: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'ACCEPTED' },
    name: 'one_accepted_document_per_category',
  }
);

/**
 * A superseded document is not counted toward anything.
 */
realEstatePropertyDocumentSchema.index({ property: 1, supersededBy: 1 });

/**
 * @typedef RealEstatePropertyDocument
 */
const RealEstatePropertyDocument = mongoose.model(
  'RealEstatePropertyDocument',
  realEstatePropertyDocumentSchema
);

module.exports = RealEstatePropertyDocument;
