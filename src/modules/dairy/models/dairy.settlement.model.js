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
 * DairySettlement — a periodic statement of what a partner owes or is owed.
 *
 * Covers both commercial shapes, distinguished by `settlementType`:
 *
 *   commission — the platform owes the partner a cut of their sales
 *   franchise  — the franchisee owes the platform a revenue share
 *
 * One document rather than two, because the arithmetic is the same and the
 * approval/payout flow is shared. Keeping them apart would duplicate the
 * approval state machine for no gain.
 *
 * `lineItems` freezes the orders counted. A settlement is an immutable financial
 * statement: later refunds must not retroactively change a statement that has
 * already been paid, or a partner's balance would move under them.
 */
const dairySettlementSchema = mongoose.Schema(
  {
    settlementNo: {
      type: Number,
      required: true,
    },
    settlementType: {
      type: String,
      required: true,
      // commission, franchise
    },
    /** Partner agreement, or franchise agreement. */
    partner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyPartner',
      required: false,
    },
    franchise: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyFranchise',
      required: false,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /**
     * The period covered. Derived from the period type so daily, weekly and
     * monthly statements all normalise to a comparable date range.
     */
    period: {
      type: String,
      required: true,
      // daily, weekly, monthly, custom
    },
    from: {
      type: Date,
      required: true,
    },
    to: {
      type: Date,
      required: true,
    },
    /**
     * Frozen breakdown of what was counted. Money in rupees.
     */
    totals: {
      orderCount: {
        type: Number,
        required: false,
        default: 0,
      },
      /** Goods revenue in the period. */
      grossSales: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** Delivery charges collected, counted only when the basis includes them. */
      deliveryCharges: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** Refunds deducted from the period. */
      refunds: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** The base commission or share was charged on. */
      commissionBase: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** Rate applied, recorded so a later renegotiation cannot restate this. */
      ratePercentage: {
        type: Number,
        required: false,
        default: 0,
      },
      /** commission for a partner, revenueShare for a franchisee. */
      commissionAmount: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      royalty: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** Fixed fee such as a franchise joining fee, amortised into the period. */
      joiningFee: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      /** Positive: the platform owes the partner. Negative: the partner owes the platform. */
      netAmount: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
    },
    /**
     * The orders counted, frozen. A settlement is a financial statement and must
     * not change after it is approved.
     */
    lineItems: {
      type: Array,
      default: [],
    },
    /**
     * draft   — computed, editable
     * submitted — awaiting platform approval
     * approved — locked and awaiting payout
     * paid    — settled
     * disputed — queried by the partner
     * void    — cancelled before payout
     */
    status: {
      type: String,
      required: false,
      default: 'draft',
    },
    payoutMethod: {
      type: String,
      required: false,
      default: 'wallet',
    },
    approvedAt: {
      type: Date,
      required: false,
    },
    approvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    paidAt: {
      type: Date,
      required: false,
    },
    payoutReference: {
      type: String,
      required: false,
    },
    dispute: {
      raisedAt: {
        type: Date,
        required: false,
      },
      reason: {
        type: String,
        required: false,
      },
      resolvedAt: {
        type: Date,
        required: false,
      },
      resolution: {
        type: String,
        required: false,
      },
    },
    notes: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairySettlementSchema.plugin(toJSON);
dairySettlementSchema.plugin(paginate);
dairySettlementSchema.index({ settlementNo: 1 }, { unique: true });
// One live settlement per partner per period — the guard against double-paying.
dairySettlementSchema.index(
  { partner: 1, period: 1, from: 1, status: 1 },
  { sparse: true }
);
dairySettlementSchema.index({ franchise: 1, period: 1, from: 1, status: 1 }, { sparse: true });
dairySettlementSchema.index({ business: 1, from: 1, to: 1 });
dairySettlementSchema.index({ status: 1, createdAt: -1 });

/**
 * @typedef DairySettlement
 */
const DairySettlement = mongoose.model('DairySettlement', dairySettlementSchema);

module.exports = DairySettlement;