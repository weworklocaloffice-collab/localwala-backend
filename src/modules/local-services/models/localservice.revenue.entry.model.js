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
 * LocalServiceRevenueEntry — append-only ledger line per qualifying transaction.
 *
 * One row per (booking/idempotencyKey + ruleVersion). Retries reuse the same
 * idempotencyKey and hit the unique index instead of double-charging.
 * Refunds/cancellations create a NEW entry with negative amounts, never an edit.
 */
const localServiceRevenueEntrySchema = mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true, trim: true },
    bookingId: { type: String, required: false, trim: true },
    paymentId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PaymentInitiation', required: false },
    rule: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceRevenueRule', required: true },
    ruleSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    // Inputs (rupees at edges via moneyField)
    labourAmount: moneyField(0),
    partsAmount: moneyField(0),
    serviceValue: moneyField(0),
    discountAmount: moneyField(0),
    // Outputs
    bookingFee: moneyField(0),
    commissionBase: moneyField(0),
    commissionAmount: moneyField(0),
    customerTotal: moneyField(0),
    providerPayable: moneyField(0),
    platformRevenue: moneyField(0),
    currency: { type: String, required: true, default: 'INR' },
    payer: { type: String, required: true, default: 'customer' },
    qualifyingEvent: { type: String, required: true, default: 'COMPLETION_VERIFIED' },
    entryType: { type: String, required: true, enum: ['charge', 'reversal'], default: 'charge' },
    status: { type: String, required: true, enum: ['pending', 'applied', 'reversed', 'void'], default: 'applied' },
    settlement: { type: mongoose.SchemaTypes.ObjectId, ref: 'Settlement', required: false },
    note: { type: String, required: false, trim: true },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceRevenueEntrySchema.plugin(toJSON);
localServiceRevenueEntrySchema.plugin(paginate);

localServiceRevenueEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
localServiceRevenueEntrySchema.index({ bookingId: 1, createdAt: -1 });
localServiceRevenueEntrySchema.index({ rule: 1, createdAt: -1 });
localServiceRevenueEntrySchema.index({ status: 1, createdAt: -1 });

const LocalServiceRevenueEntry = mongoose.model('LocalServiceRevenueEntry', localServiceRevenueEntrySchema);

module.exports = LocalServiceRevenueEntry;
