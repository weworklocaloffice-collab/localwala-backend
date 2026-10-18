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
 * RealEstateCommission — a frozen payout, never a live computation.
 *
 * `ruleSnapshot` is BR-15 in one field: rule id, version, type, rate,
 * basis and effectiveFrom as they were at resolution time. A later
 * rate change never restates this row.
 *
 * Referral and executive shares are percentages of LOCALWALA's
 * commission, never of the sale value (BR-16) — enforced in the
 * service, with the basis frozen here so a reader can verify it.
 */
const ruleSnapshotSchema = new mongoose.Schema(
  {
    ruleId: { type: mongoose.SchemaTypes.ObjectId, ref: 'RealEstateCommissionRule', required: false },
    version: { type: Number, required: false },
    type: { type: String, required: false },
    rate: { type: Number, required: false },
    basis: { type: String, required: false },
    effectiveFrom: { type: Date, required: false },
  },
  { _id: false }
);

const realEstateCommissionSchema = mongoose.Schema(
  {
    commissionNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    sale: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateSale',
      required: false,
    },

    hold: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyHold',
      required: false,
    },

    loanApplication: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLoanApplication',
      required: false,
    },

    listingOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateListingOrder',
      required: false,
    },

    rule: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateCommissionRule',
      required: false,
    },

    /** Frozen at resolution time (BR-15). */
    ruleSnapshot: {
      type: ruleSnapshotSchema,
      required: true,
    },

    // ── OD-04 tax snapshot ─────────────────────────────────────
    // Tax classification + rate + invoice treatment as approved when this
    // commission was computed. Later Admin tax edits must not restate it.
    // Stays empty (inactive) until a written determination is approved.
    taxSnapshot: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },

    beneficiaryType: {
      type: String,
      required: true,
      enum: ['LOCALWALA', 'VENDOR', 'EXECUTIVE', 'REFERRER', 'BANK'],
    },

    beneficiary: {
      type: mongoose.SchemaTypes.ObjectId,
      required: false,
    },

    /** The figure the rate was applied to (paise inside). */
    baseAmount: moneyField(0),

    /** Frozen percentage points, e.g. 2.0 for 2%. */
    rate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    /** Computed payout (paise inside). */
    amount: moneyField(0),

    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'VERIFIED', 'EARNED', 'SETTLEMENT_CREATED', 'PAID', 'REVERSED'],
    },

    settlement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateSettlement',
      required: false,
    },

    /** Compensating entry for a clawback / correction. */
    reversedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateCommission',
      required: false,
    },

    resolvedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateCommissionSchema.plugin(toJSON);
realEstateCommissionSchema.plugin(paginate);

realEstateCommissionSchema.index({ commissionNo: 1 }, { unique: true });
realEstateCommissionSchema.index({ beneficiaryType: 1, beneficiary: 1, status: 1 });
realEstateCommissionSchema.index({ sale: 1 }, { sparse: true });
realEstateCommissionSchema.index({ settlement: 1 }, { sparse: true });
realEstateCommissionSchema.index({ status: 1, createdAt: -1 });

/**
 * @typedef RealEstateCommission
 */
const RealEstateCommission = mongoose.model('RealEstateCommission', realEstateCommissionSchema);

module.exports = RealEstateCommission;
