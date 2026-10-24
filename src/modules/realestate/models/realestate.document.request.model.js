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
 * RealEstateDocumentRequest — a bank asking the customer for a document.
 *
 * ## Why this is not a `RealEstatePropertyDocument`
 *
 * A property document is a FILE attached to a listing: the sale deed, the
 * approved plan, the encumbrance certificate. It is uploaded by the
 * vendor, verified by an admin, and its visibility decides who may read
 * it (BR-18).
 *
 * A document REQUEST is the opposite: it is a row created by a bank
 * during underwriting ("send me your latest salary slip"), addressed to
 * the customer, answered by the customer, and reviewed by the bank.
 *
 * Conflating the two would be a category error with a security cost:
 * the answer to a request is the customer's own paperwork (a bank
 * statement, an Aadhaar scan), and it must never be readable by another
 * bank, by a vendor, or by a competing applicant. The property-document
 * visibility classes cannot express that.
 *
 * ## The answer is stored on the request, not on a property
 *
 * The customer's response (`fileUrl`) lives here. It is deliberately not
 * a `RealEstatePropertyDocument`: the property document collection is
 * indexed by property and read by `documentAccess`, which would expose
 * the customer's KYC to the property's other parties.
 *
 * ## Status
 *
 *   REQUESTED -> SUBMITTED -> ACCEPTED
 *                         -> REJECTED  (the customer can resubmit)
 *   REQUESTED -> CANCELLED  (the bank withdrew the request)
 */
const realEstateDocumentRequestSchema = mongoose.Schema(
  {
    /** The loan application this request belongs to. */
    loanApplication: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLoanApplication',
      required: true,
    },

    /** The parent loan request, denormalised for the customer's list. */
    loanRequest: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLoanRequest',
      required: false,
    },

    /** The customer who must answer. */
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /** The bank that asked. */
    bank: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateBank',
      required: true,
    },

    /** The property the loan is against, for the customer's context. */
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: false,
    },

    /**
     * What the bank asked for. A closed enum, not a free string: a
     * request list that renders "Salary Slip" and "salary slip" as two
     * different asks is a list nobody can action.
     */
    category: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: [
        'AADHAAR',
        'PAN',
        'SALARY_SLIP',
        'SELF_EMPLOYED_INCOME',
        'BANK_STATEMENT',
        'KYC',
        'CREDIT_REPORT',
        'CERTIFICATE',
        'OTHER',
      ],
    },

    /** Human label, so a bank can say "Salary slips - last 3 months". */
    title: { type: String, required: true, trim: true },

    /** What the bank wants, in the bank's words. */
    notes: { type: String, required: false, trim: true },

    status: {
      type: String,
      required: true,
      default: 'REQUESTED',
      enum: ['REQUESTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'CANCELLED'],
    },

    /** The customer's answer. */
    fileUrl: { type: String, required: false, trim: true },
    fileName: { type: String, required: false, trim: true },
    mimeType: { type: String, required: false, trim: true },
    sizeBytes: { type: Number, required: false },

    /** When the customer answered. */
    uploadedAt: { type: Date, required: false },

    /** The bank member who asked. */
    requestedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    /** When the bank accepted or rejected the answer. */
    reviewedAt: { type: Date, required: false },
    reviewedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    /** Why the bank rejected the answer - the customer sees this. */
    reviewNote: { type: String, required: false, trim: true },

    /** Optional deadline the bank set for the customer. */
    dueDate: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

realEstateDocumentRequestSchema.plugin(toJSON);
realEstateDocumentRequestSchema.plugin(paginate);

/** The timeline of one application's requests. */
realEstateDocumentRequestSchema.index({ loanApplication: 1, createdAt: -1 });

/** The customer's own outstanding asks across every application. */
realEstateDocumentRequestSchema.index({ customer: 1, status: 1, createdAt: -1 });

/**
 * One open request per category per application.
 *
 * A bank that asks twice for the same document produces two open rows
 * and the customer cannot tell which one to answer. The partial index
 * makes the second request a duplicate-key error the service turns into
 * a 409.
 */
realEstateDocumentRequestSchema.index(
  { loanApplication: 1, category: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['REQUESTED', 'SUBMITTED'] } },
    name: 'one_open_request_per_category',
  }
);

/**
 * @typedef RealEstateDocumentRequest
 */
const RealEstateDocumentRequest = mongoose.model(
  'RealEstateDocumentRequest',
  realEstateDocumentRequestSchema
);

module.exports = RealEstateDocumentRequest;
