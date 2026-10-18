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
const moneyField = require('../../../utils/money.field');

/**
 * RealEstatePropertyHold — the model the hold/refund story rests on.
 *
 * ## The split (plan §6.1)
 *
 * Hold principal ₹50,000 = customer money held in trust → LIABILITY.
 * Hold service fee ₹2,500 = platform revenue → REVENUE, earned when
 * the hold becomes ACTIVE. One customer charge, TWO ledger entries —
 * never one entry with a memo, because a single entry cannot be both
 * a liability and revenue.
 *
 * ## One active hold per property (BR-12)
 *
 * Enforced by the partial unique index below — a DATABASE constraint,
 * not application logic, because application logic fails under
 * concurrency. A second hold request on a held property is rejected,
 * not queued.
 *
 * ## Policy frozen at creation (BR-15)
 *
 * `policySnapshot` carries the hold-policy version in force. A later
 * admin edit never restates a live hold.
 */
const policySnapshotSchema = new mongoose.Schema(
  {
    policyId: { type: mongoose.SchemaTypes.ObjectId, ref: 'RealEstateHoldPolicy', required: false },
    version: { type: Number, required: false },
    principalAmount: moneyField(0),
    serviceFeePercent: { type: Number, required: false },
    serviceFeeMin: moneyField(0),
    serviceFeeMax: moneyField(0),
    durationDays: { type: Number, required: false },
    gracePeriodHours: { type: Number, required: false },
    cancellationRefundable: { type: Boolean, required: false },
    expiryRefundable: { type: Boolean, required: false },
    feeRefundableOnListingWithdrawal: { type: Boolean, required: false },
    forfeitureRequiresDualControl: { type: Boolean, required: false },
    effectiveFrom: { type: Date, required: false },
    // ── OD-01/OD-04 runtime snapshots ──────────────────────────
    // Frozen at hold creation (BR-15). Later Admin edits to custody or
    // tax config must never restate this hold, its invoices, refunds or
    // settlement rows. Updating Admin settings must not rewrite history.
    custodySnapshot: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },
    taxSnapshot: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },
  },
  { _id: false }
);

const realEstatePropertyHoldSchema = mongoose.Schema(
  {
    holdCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: false,
    },

    policy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateHoldPolicy',
      required: false,
    },

    /** Frozen terms at creation (BR-15). */
    policySnapshot: {
      type: policySnapshotSchema,
      required: true,
    },

    /** Customer money, LIABILITY, never revenue (BR-13). */
    principal: moneyField(0),

    /** Platform revenue, earned at ACTIVATION (BR-14). */
    serviceFee: moneyField(0),

    /** principal + serviceFee. */
    total: moneyField(0),

    status: {
      type: String,
      required: true,
      default: 'PENDING_PAYMENT',
      enum: [
        'PENDING_PAYMENT',
        'ACTIVE',
        'EXPIRED',
        'CANCELLED',
        'CONVERTED_TO_SALE',
        'REFUND_PENDING',
        'REFUNDED',
        'ADJUSTED',
      ],
    },

    placedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    activatedAt: { type: Date, required: false },

    convertedSale: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateSale',
      required: false,
    },

    refund: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateHoldRefund',
      required: false,
    },

    ledgerPrincipal: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLedgerEntry',
      required: false,
    },

    ledgerServiceFee: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLedgerEntry',
      required: false,
    },

    cancelledAt: { type: Date, required: false },
    cancelledBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    cancellationReason: { type: String, required: false, trim: true },

    /** Dual-control forfeiture (plan §6.2): requester ≠ approver. */
    forfeitureRequestedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    forfeitureApprovedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    forfeitureReason: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstatePropertyHoldSchema.plugin(toJSON);
realEstatePropertyHoldSchema.plugin(paginate);

realEstatePropertyHoldSchema.index({ holdCode: 1 }, { unique: true });
realEstatePropertyHoldSchema.index({ customer: 1, createdAt: -1 });
realEstatePropertyHoldSchema.index({ status: 1, expiresAt: 1 });

/**
 * BR-12: at most ONE active hold per property. Partial, because a
 * property may have any number of terminal holds in its history.
 */
realEstatePropertyHoldSchema.index(
  { property: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING_PAYMENT', 'ACTIVE'] } },
    name: 'one_active_hold_per_property',
  }
);

/**
 * @typedef RealEstatePropertyHold
 */
const RealEstatePropertyHold = mongoose.model('RealEstatePropertyHold', realEstatePropertyHoldSchema);

module.exports = RealEstatePropertyHold;
