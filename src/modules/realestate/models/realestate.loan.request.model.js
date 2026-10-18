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
 * RealEstateLoanRequest — a customer's loan enquiry before a bank
 * is chosen. Becomes one or more `RealEstateLoanApplication` rows
 * once banks are engaged.
 */
const realEstateLoanRequestSchema = mongoose.Schema(
  {
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

    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: false,
    },

    requestedAmount: moneyField(0),

    tenureMonths: { type: Number, required: false, min: 1 },

    /**
     * Borrower profile captured by the request form (Flow 12). The
     * banks see these on the lead — amount alone prices nothing.
     * Optional because older requests predate the fields.
     */
    employment: {
      type: String,
      required: false,
      enum: ['SALARIED', 'SELF_EMPLOYED', 'BUSINESS', 'OTHER'],
    },

    monthlyIncome: moneyField(0),

    status: {
      type: String,
      required: true,
      default: 'REQUIRED',
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
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateLoanRequestSchema.plugin(toJSON);
realEstateLoanRequestSchema.plugin(paginate);

realEstateLoanRequestSchema.index({ customer: 1, createdAt: -1 });
realEstateLoanRequestSchema.index({ property: 1, customer: 1 });

/**
 * @typedef RealEstateLoanRequest
 */
const RealEstateLoanRequest = mongoose.model('RealEstateLoanRequest', realEstateLoanRequestSchema);

module.exports = RealEstateLoanRequest;
