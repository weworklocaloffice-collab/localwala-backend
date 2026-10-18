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
 * RealEstateBankOffer — what one bank offers on one application.
 *
 * Bank supplies: interest rate, loan amount, tenure, processing fee,
 * other terms. A bank sees only its own offers (scoped by `bank`).
 */
const realEstateBankOfferSchema = mongoose.Schema(
  {
    loanApplication: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLoanApplication',
      required: true,
    },

    bank: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateBank',
      required: true,
    },

    loanAmount: moneyField(0),
    tenureMonths: { type: Number, required: false, min: 1 },
    interestRate: { type: Number, required: false, min: 0, max: 100 },
    processingFee: moneyField(0),
    otherTerms: { type: String, required: false, trim: true },

    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateBankOfferSchema.plugin(toJSON);
realEstateBankOfferSchema.plugin(paginate);

realEstateBankOfferSchema.index({ loanApplication: 1, bank: 1 });
realEstateBankOfferSchema.index({ bank: 1, status: 1 });

/**
 * @typedef RealEstateBankOffer
 */
const RealEstateBankOffer = mongoose.model('RealEstateBankOffer', realEstateBankOfferSchema);

module.exports = RealEstateBankOffer;
