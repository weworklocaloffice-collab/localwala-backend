/*
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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema(
  {
    entryNo: {
      type: String,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        'LISTING_PACKAGE_PAYMENT',
        'PROPERTY_HOLD',
        'PROPERTY_HOLD_SERVICE_FEE',
        'BANK_LOAN_COMMISSION',
        'PROPERTY_SALE_COMMISSION',
        'CUSTOMER_REFERRAL_COMMISSION',
        'EXECUTIVE_COMMISSION',
        'REFUND',
        'PAYOUT',
        'REVERSAL',
      ],
      required: true,
    },
    accountType: {
      type: String,
      enum: ['REVENUE', 'LIABILITY', 'PAYABLE', 'RECEIVABLE', 'EXPENSE'],
      required: true,
    },
    direction: {
      type: String,
      enum: ['DEBIT', 'CREDIT'],
      required: true,
    },
    amount: {
      type: mongoose.SchemaTypes.Decimal128,
      required: true,
    },
    currency: {
      type: String,
      enum: ['INR'],
      default: 'INR',
    },
    partyType: {
      type: String,
      enum: ['CUSTOMER', 'VENDOR', 'EXECUTIVE', 'REFERRER', 'BANK', 'LOCALWALA'],
    },
    party: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'partyType',
    },
    sourceModel: {
      type: String,
      required: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
narration: {
      type: String,
    },
    metadata: {
      type: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    custodyReference: {
      type: String,
      description: 'External custodial account reference for this entry',
      default: null,
    },
    settlement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RealEstateSettlement',
    },
    reversesEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RealEstateLedgerEntry',
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  { timestamps: true }
);

// Indexes for common query patterns
ledgerEntrySchema.index({ eventType: 1, accountType: 1, party: 1 });
ledgerEntrySchema.index({ createdAt: -1 });

module.exports = mongoose.model('RealEstateLedgerEntry', ledgerEntrySchema);