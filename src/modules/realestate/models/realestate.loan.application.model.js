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
 * RealEstateLoanApplication — one customer's file at one bank.
 *
 * BR-10: SANCTIONED, REJECTED and DISBURSED are bank-only
 * transitions. Enforced by rights-string absence (those three strings
 * exist ONLY in the `bank` role array) AND mirrored in the loan
 * service, which rejects any non-bank actor with a clear error.
 */
const realEstateLoanApplicationSchema = mongoose.Schema(
  {
    loanRequest: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLoanRequest',
      required: true,
    },

    bank: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateBank',
      required: true,
    },

    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    requestedAmount: moneyField(0),
    sanctionedAmount: moneyField(0),
    disbursedAmount: moneyField(0),

    tenureMonths: { type: Number, required: false, min: 1 },
    interestRate: { type: Number, required: false, min: 0, max: 100 },

    status: {
      type: String,
      required: true,
      default: 'APPLICATION_STARTED',
      enum: [
        'NOT_REQUIRED',
        'REQUIRED',
        'CUSTOMER_WILL_APPLY',
        'LOAN_LEAD_CREATED',
        'OFFERS_PENDING',
        'OFFERS_RECEIVED',
        'CUSTOMER_SELECTING',
        'BANK_SELECTED',
        'APPLICATION_STARTED',
        'DOCUMENTS_PENDING',
        'UNDER_BANK_REVIEW',
        'SANCTIONED',
        'DISBURSED',
        'REJECTED',
        'WITHDRAWN',
      ],
    },

    sanctionedAt: { type: Date, required: false },
    sanctionedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    disbursedAt: { type: Date, required: false },
    rejectedAt: { type: Date, required: false },
    rejectionReason: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateLoanApplicationSchema.plugin(toJSON);
realEstateLoanApplicationSchema.plugin(paginate);

realEstateLoanApplicationSchema.index({ bank: 1, status: 1, createdAt: -1 });
realEstateLoanApplicationSchema.index({ customer: 1, createdAt: -1 });
realEstateLoanApplicationSchema.index({ loanRequest: 1, bank: 1 }, { unique: true });

/**
 * @typedef RealEstateLoanApplication
 */
const RealEstateLoanApplication = mongoose.model('RealEstateLoanApplication', realEstateLoanApplicationSchema);

module.exports = RealEstateLoanApplication;
