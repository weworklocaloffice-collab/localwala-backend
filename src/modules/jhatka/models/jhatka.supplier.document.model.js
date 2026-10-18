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
 * JhatkaSupplierDocument — a licence, certificate or registration, with an expiry.
 *
 * ## Split out so an expiry sweep does not load a supplier
 *
 * The reason this is its own model is on the index below. `JhatkaSupplier` carries
 * bank details, addresses and contact numbers; a daily sweep that had to read a
 * supplier to check whether its licence lapsed would be reading all of that once a
 * day for every supplier, to answer one date question.
 *
 * `DairyCompliance` declares `{ 'fssai.expiresAt': 1 }` with the comment "expiry
 * sweeps look for licences expiring soon across all outlets". This model is that
 * idea generalised: `{ expiresAt: 1 }` covers every document type at once.
 *
 * ## `isBlocking` decides what expiry actually stops
 *
 * This is the field that keeps the blast radius right. An expired MSME
 * registration is paperwork; an expired FSSAI licence means we may not legally
 * receive goods from that supplier. `DairyCompliance`'s model header states the
 * rule plainly — nothing is blocked in the model itself, the caller decides — and
 * this schema honours that: it records `isBlocking` as DATA and leaves enforcement
 * to the service.
 */
const DOCUMENT_TYPES = [
  'fssai',
  'gst_registration',
  'trade_licence',
  'msme',
  'lab_report',
  'insurance',
  'other',
];

/** Only FSSAI legally stops goods entering the building. The rest is paperwork. */
const BLOCKING_TYPES = ['fssai'];

const jhatkaSupplierDocumentSchema = mongoose.Schema(
  {
    supplier: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSupplier',
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: DOCUMENT_TYPES,
    },
    reference: {
      type: String,
      required: false,
      trim: true,
    },
    issuedAt: {
      type: Date,
      required: false,
    },
    expiresAt: {
      type: Date,
      required: false,
      default: undefined,
    },
    fileUrl: {
      type: String,
      required: false,
    },
    /**
     * Whether expiry of THIS document blocks a delivery. Defaults from `type` at
     * write time and is overridable, because a trade licence genuinely can be
     * operationally blocking depending on the municipality.
     */
    isBlocking: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * Status is DERIVED from `expiresAt`, never asserted by a person — the same
     * rule as `DairyCompliance.deriveStatus`, and for the same reason.
     */
    status: {
      type: String,
      required: false,
      enum: ['pending', 'valid', 'expiring', 'expired', 'rejected'],
      default: 'pending',
    },
    statusEvaluatedAt: {
      type: Date,
      required: false,
    },
    rejectedReason: {
      type: String,
      required: false,
      trim: true,
    },
    verifiedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    verifiedByName: { type: String, required: false, trim: true },
    verifiedAt: { type: Date, required: false },
    uploadedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    notes: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaSupplierDocumentSchema.plugin(toJSON);
jhatkaSupplierDocumentSchema.plugin(paginate);
// THE EXPIRY SWEEP. Every document type at once, without loading a supplier.
jhatkaSupplierDocumentSchema.index({ expiresAt: 1, status: 1 });
jhatkaSupplierDocumentSchema.index({ supplier: 1, type: 1 });
// "Which suppliers are blocked right now?" — the receipt guard's hot query.
jhatkaSupplierDocumentSchema.index({ supplier: 1, isBlocking: 1, status: 1, expiresAt: 1 });
// A supplier's document pack on the admin screen.
jhatkaSupplierDocumentSchema.index({ supplier: 1, updatedAt: -1 });

jhatkaSupplierDocumentSchema.statics.DOCUMENT_TYPES = DOCUMENT_TYPES;
jhatkaSupplierDocumentSchema.statics.BLOCKING_TYPES = BLOCKING_TYPES;

/**
 * Derive status from the expiry date. Pure, module-level, no `this`.
 *
 * Exactly the shape of `dairy.compliance.service.deriveStatus`, including its two
 * rules: no expiry date means `pending` rather than `valid` (we have not been told
 * it lapses, and treating silence as permission is how a supplier turns up in year
 * three with an expired licence), and the returned value is stored alongside
 * `statusEvaluatedAt` rather than trusted as the source of truth.
 *
 * Declared OUTSIDE the schema and re-exported as a static, because an instance
 * method needs it and statics are not reachable via `this` on a document —
 * `doc.deriveStatus` is undefined no matter how it is declared.
 *
 * @param {{expiresAt?: Date, status?: string}} doc
 * @param {Date} [now]
 * @param {number} [warningDays]
 * @returns {'pending'|'valid'|'expiring'|'expired'|'rejected'}
 */
function deriveStatus(doc, now = new Date(), warningDays = 30) {
  // A human rejection outranks everything: a rejected licence is rejected even if
  // its expiry date is still in the future.
  if (doc.status === 'rejected') return 'rejected';
  if (!doc.expiresAt) return 'pending';

  const remaining = new Date(doc.expiresAt).getTime() - now.getTime();
  const days = Math.ceil(remaining / (24 * 3600 * 1000));

  if (days < 0) return 'expired';
  if (days <= warningDays) return 'expiring';
  return 'valid';
}

jhatkaSupplierDocumentSchema.statics.deriveStatus = deriveStatus;

/**
 * Days until expiry, or null when there is no date. Null rather than zero, because
 * "expires today" and "we do not know" are different states and the UI must not
 * render them identically.
 */
jhatkaSupplierDocumentSchema.methods.daysToExpiry = function (now = new Date()) {
  if (!this.expiresAt) return null;
  return Math.ceil((new Date(this.expiresAt).getTime() - now.getTime()) / (24 * 3600 * 1000));
};

/**
 * Is THIS document the thing that legally stops a delivery?
 *
 * Calls the module-level `deriveStatus` rather than `this.deriveStatus`, because
 * statics are not accessible from a document instance.
 */
jhatkaSupplierDocumentSchema.methods.blocksDelivery = function (now = new Date()) {
  if (!this.isBlocking) return false;
  return deriveStatus(this, now) === 'expired';
};

/**
 * @typedef JhatkaSupplierDocument
 */
const JhatkaSupplierDocument = mongoose.model(
  'JhatkaSupplierDocument',
  jhatkaSupplierDocumentSchema
);

module.exports = JhatkaSupplierDocument;