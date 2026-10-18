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
 * RealEstateBankAgreement — versioned commission terms with a bank
 * (plan §5.10).
 *
 * Example: loan ₹45,00,000 disbursed at 1.0% of LOAN_DISBURSED →
 * bank commission ₹45,000 REVENUE → LOCALWALA, party BANK.
 * TDS is a settlement-term field, not a hardcoded deduction.
 */
const realEstateBankAgreementSchema = mongoose.Schema(
  {
    bank: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateBank',
      required: true,
    },

    commissionType: {
      type: String,
      required: true,
      enum: ['DISBURSED', 'SANCTIONED'],
    },

    /** Percent, e.g. 1.0 for 1%. */
    rate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    calculationBasis: {
      type: String,
      required: true,
      enum: ['LOAN_DISBURSED', 'SANCTION_AMOUNT'],
    },

    minLoan: moneyField(0),
    maxLoan: moneyField(0),

    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, required: false },

    settlementTerms: {
      payoutCycle: { type: String, required: false, trim: true },
      tdsPercentage: { type: Number, required: false, min: 0, max: 100 },
    },

    /** Per-bank customer visibility flag (OD-06). */
    offerVisibleToCustomer: { type: Boolean, default: true },

    version: { type: Number, required: true, default: 1, min: 1 },

    status: {
      type: String,
      required: true,
      default: 'DRAFT',
      enum: ['DRAFT', 'ACTIVE', 'EXPIRED'],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateBankAgreementSchema.plugin(toJSON);
realEstateBankAgreementSchema.plugin(paginate);

realEstateBankAgreementSchema.index({ bank: 1, status: 1, effectiveFrom: -1 });
realEstateBankAgreementSchema.index({ status: 1, effectiveFrom: 1 });

/**
 * @typedef RealEstateBankAgreement
 */
const RealEstateBankAgreement = mongoose.model('RealEstateBankAgreement', realEstateBankAgreementSchema);

module.exports = RealEstateBankAgreement;
