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
 * RealEstateHoldRefund — one refund of a hold principal (and, in the
 * listing-withdrawn case, the fee too).
 *
 * Flow (plan §6.5): create PENDING → admin verifies + initiates payout
 * through the EXISTING payment stack
 * (`paymentFrom: 'property_hold_refund'`) → gateway confirms → in one
 * transaction: hold → REFUNDED, refund → COMPLETED, ledger CREDITs.
 * The refund never bypasses the payment stack.
 */
const realEstateHoldRefundSchema = mongoose.Schema(
  {
    hold: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyHold',
      required: true,
    },

    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /** Principal returned (paise inside). */
    principalAmount: moneyField(0),

    /** Fee returned — zero except listing-withdrawn (plan §6.2). */
    feeAmount: moneyField(0),

    reason: {
      type: String,
      required: true,
      enum: ['CANCELLATION', 'EXPIRY', 'LISTING_WITHDRAWN', 'SALE_ABORTED', 'ADMIN'],
      default: 'CANCELLATION',
    },

    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    },

    paymentInitiation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentInitiation',
      required: false,
    },

    requestedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    processedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    completedAt: { type: Date, required: false },
    failureReason: { type: String, required: false, trim: true },
    // ── OD-01/OD-04 snapshots ──────────────────────────────────
    // Refund SLA + custody + tax as they were when the refund was
    // requested. Reports/invoices render from here, never from live config.
    custodySnapshot: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },
    taxSnapshot: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },
    refundSLASnapshot: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateHoldRefundSchema.plugin(toJSON);
realEstateHoldRefundSchema.plugin(paginate);

realEstateHoldRefundSchema.index({ hold: 1, createdAt: -1 });
realEstateHoldRefundSchema.index({ customer: 1, status: 1 });
realEstateHoldRefundSchema.index({ status: 1, createdAt: -1 });

/**
 * @typedef RealEstateHoldRefund
 */
const RealEstateHoldRefund = mongoose.model('RealEstateHoldRefund', realEstateHoldRefundSchema);

module.exports = RealEstateHoldRefund;
