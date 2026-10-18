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
 * StoreComplianceDocument — a business licence, certificate or registration.
 *
 * OUTLET-SCOPED, NOT CHAIN-SCOPED, because licences attach to a premises and a
 * registration number. Each outlet of a chain carries its own set, which is why the
 * invoice series is per outlet.
 *
 * Note the contrast with StoreSubscription, which is CHAIN-scoped: a partner pays once
 * for the brand, but a licence belongs to the specific building it was issued for. Two
 * outlets in the same chain, two shops, two GST registrations, two sets of documents.
 * An earlier draft of this comment claimed compliance is why subscriptions are per
 * outlet, which was wrong — it argued the opposite of the decision that was actually
 * made, and would have misled anyone reading the model to add an `outlet` field to
 * StoreSubscription later.
 *
 * Every document has an expiry. An expired document must remove an approval on its
 * own — a nightly sweep recomputes `status`, the same pattern as organic
 * verification and brand certification. Nobody should have to remember to revoke
 * anything.
 *
 * Documents are NEVER deleted. A revoked document keeps its row with the reason and
 * the reviewer, because "why was this outlet suspended in March" needs an answer.
 *
 * @typedef StoreComplianceDocument
 */
const storeComplianceDocumentSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },

    type: {
      type: String,
      required: true,
      enum: [
        'gst_registration',
        'trade_licence',
        'shop_and_establishment',
        'fssai',
        'pharmacy_registration',
        'drug_licence',
        'fire_noc',
        'shops_establishment',
        'fssai_registration',
        'professional_tax',
        'other',
      ],
    },

    number: {
      type: String,
      required: false,
      trim: true,
    },
    issuingAuthority: {
      type: String,
      required: false,
      trim: true,
    },
    issuedAt: {
      type: Date,
      required: false,
    },
    // null means perpetual. Anything else is swept nightly.
    expiresAt: {
      type: Date,
      required: false,
    },

    file: {
      type: String,
      required: false,
    },
    fileType: {
      type: String,
      required: false,
    },

    status: {
      type: String,
      required: false,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected', 'expired'],
    },

    // Which kinds of document must exist before this outlet may go active.
    // Consulted by assertActive in the lifecycle service.
    isMandatory: {
      type: Boolean,
      required: false,
      default: false,
    },

    verifiedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    verifiedAt: {
      type: Date,
      required: false,
    },
    verifiedByRole: {
      type: String,
      required: false,
    },
    rejectionReason: {
      type: String,
      required: false,
      trim: true,
    },
    // Set by the nightly expiry sweep so a human can see it was automatic.
    expiredAt: {
      type: Date,
      required: false,
    },
    notes: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

storeComplianceDocumentSchema.plugin(toJSON);
storeComplianceDocumentSchema.plugin(paginate);

storeComplianceDocumentSchema.index({ outlet: 1, type: 1, status: 1 });
storeComplianceDocumentSchema.index({ outlet: 1, status: 1, isMandatory: 1 });
// Drives the expiry sweep and the "expiring in 30/15/7 days" admin console.
storeComplianceDocumentSchema.index({ status: 1, expiresAt: 1 });
storeComplianceDocumentSchema.index({ chain: 1 });

/**
 * Is this document currently valid?
 * A perpetual document is always valid; an expired one never is, whatever its
 * stored status says.
 */
storeComplianceDocumentSchema.statics.isCurrentlyValid = function isCurrentlyValid(doc) {
  if (!doc || doc.status !== 'approved') return false;
  if (!doc.expiresAt) return true;
  return doc.expiresAt > new Date();
};

/**
 * Documents expiring within `withinDays`, for the admin console.
 */
storeComplianceDocumentSchema.statics.expiringSoon = async function expiringSoon(withinDays = 30) {
  const now = new Date();
  const until = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  return this.find({
    status: 'approved',
    expiresAt: { $ne: null, $gte: now, $lte: until },
  }).sort({ expiresAt: 1 });
};

const StoreComplianceDocument = mongoose.model(
  'StoreComplianceDocument',
  storeComplianceDocumentSchema
);

module.exports = StoreComplianceDocument;