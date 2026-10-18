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

const statementRowSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    reference: { type: String, required: true, trim: true },
    // Paise integer — parsed once at upload, matched exactly.
    amountPaise: { type: Number, required: true },
    direction: { type: String, required: true, enum: ['CREDIT', 'DEBIT'] },
    balancePaise: { type: Number, required: false },
  },
  { _id: false }
);

const statementMatchSchema = new mongoose.Schema(
  {
    // Statement row indexes (0-based into `rows`) with no ledger twin.
    unmatchedStatementRows: { type: [Number], default: [] },
    // Ledger entry ids with no statement twin (within the window).
    unmatchedLedgerEntries: { type: [mongoose.SchemaTypes.ObjectId], default: [] },
    matchedCount: { type: Number, default: 0 },
    matchedAt: { type: Date, required: false },
  },
  { _id: false }
);

/**
 * RealEstateCustodyStatement — one uploaded custodial-account statement.
 *
 * Phase B external leg (ManualCustody provider): the bank's statement
 * as CSV, parsed once, matched against ledger rows. The ApiCustody
 * provider (RazorpayX/Cashfree webhooks) will write rows in this same
 * shape later — matching logic stays identical, only ingestion changes.
 *
 * Expected CSV (header required, UTF-8):
 *   date,reference,amount,direction
 *   2026-10-01,HLD-123456-0001,50000.00,CREDIT
 * `date` ISO (YYYY-MM-DD), `amount` rupees with optional decimals,
 * `direction` CREDIT (inflow to custodial) or DEBIT (payout/refund).
 * An optional 5th column `balance` (rupees) is stored, never matched.
 */
const realEstateCustodyStatementSchema = mongoose.Schema(
  {
    filename: { type: String, required: true, trim: true },
    uploadedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    rowCount: { type: Number, required: true },
    rows: { type: [statementRowSchema], default: [] },
    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'MATCHED'],
    },
    match: { type: statementMatchSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateCustodyStatementSchema.plugin(toJSON);
realEstateCustodyStatementSchema.plugin(paginate);

realEstateCustodyStatementSchema.index({ createdAt: -1 });
realEstateCustodyStatementSchema.index({ status: 1, createdAt: -1 });

/**
 * @typedef RealEstateCustodyStatement
 */
const RealEstateCustodyStatement = mongoose.model(
  'RealEstateCustodyStatement',
  realEstateCustodyStatementSchema
);

module.exports = RealEstateCustodyStatement;
