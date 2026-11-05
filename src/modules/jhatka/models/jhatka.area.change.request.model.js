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
const toJSON = require('../../../models/plugins/tojson.plugin');
const moneyField = require('../../../utils/money.field');

/**
 * JhatkaAreaChangeRequest — a partner/franchisee proposing a change to the
 * delivery area they serve (OD-12 companion).
 *
 * ## The governance this document exists to enforce
 *
 * The partner knows their streets better than a central admin — but the
 * delivery radius is a COMMERCIAL commitment (where LocalWala is obligated to
 * deliver) and a COLD-CHAIN bound (BR-12 still refuses dispatch past
 * maxTransitMinutes per order). So: the partner PROPOSES, the admin APPROVES,
 * and the platform ceiling is absolute — checked at REQUEST time, not just at
 * approval.
 *
 * Both directions go through approval: an increase changes the delivery
 * promise, and a decrease silently withdraws it from customers who had it.
 * One flow, both visible.
 *
 * On approval the proposed values are applied to `JhatkaOutlet.serviceArea`
 * atomically and stamped — so "why did this outlet start serving the bypass"
 * is always answerable. Nothing here is ever deleted.
 */
const jhatkaAreaChangeRequestSchema = mongoose.Schema(
  {
    requestNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
      index: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    businessModel: {
      type: String,
      required: true,
      enum: ['direct', 'franchise', 'commission_partner'],
    },
    requestedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedByName: { type: String, required: false, trim: true },

    /** The PROPOSED values. Applied verbatim on approval. */
    proposed: {
      /** Free-delivery ring, km. */
      radiusKm: { type: Number, required: true, min: 0 },
      /** Paid ring beyond the free one, km. 0 = no paid band. */
      extendedRadiusKm: { type: Number, required: true, min: 0, default: 0 },
      /**
       * Flat fee for the paid ring. Rupees at the API edge, paise at rest —
       * same `moneyField` pair as `JhatkaOutlet.serviceArea.extendedDeliveryFee`,
       * so approval can write it without a second conversion.
       */
      extendedDeliveryFee: moneyField(0),
    },

    /** What the outlet serves TODAY, frozen for the admin's compare view. */
    current: {
      radiusKm: { type: Number, required: false },
      extendedRadiusKm: { type: Number, required: false },
      extendedDeliveryFee: moneyField(0),
    },

    reason: { type: String, required: true, trim: true, maxlength: 500 },

    status: {
      type: String,
      required: true,
      enum: ['requested', 'approved', 'rejected', 'cancelled'],
      default: 'requested',
      index: true,
    },
    statusReason: { type: String, required: false, trim: true, maxlength: 500 },

    approval: {
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byName: { type: String, required: false, trim: true },
      at: { type: Date, required: false },
    },

    cancelledBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    cancelledAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

jhatkaAreaChangeRequestSchema.plugin(toJSON);

jhatkaAreaChangeRequestSchema.index({ outlet: 1, status: 1, createdAt: -1 });
jhatkaAreaChangeRequestSchema.index({ status: 1, createdAt: -1 });

/** Only one OPEN request per outlet at a time — a queue of competing proposals is ambiguity. */
jhatkaAreaChangeRequestSchema.index(
  { outlet: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'requested' },
    name: 'one_open_area_request_per_outlet',
  }
);

const AREA_REQUEST_TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: [],
  rejected: [],
  cancelled: [],
};

jhatkaAreaChangeRequestSchema.statics.AREA_REQUEST_TRANSITIONS = AREA_REQUEST_TRANSITIONS;
jhatkaAreaChangeRequestSchema.statics.canTransition = function (from, to) {
  return (AREA_REQUEST_TRANSITIONS[from] || []).includes(to);
};

const JhatkaAreaChangeRequest = mongoose.model(
  'JhatkaAreaChangeRequest',
  jhatkaAreaChangeRequestSchema
);

module.exports = JhatkaAreaChangeRequest;
