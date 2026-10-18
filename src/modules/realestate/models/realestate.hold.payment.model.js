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
 * RealEstateHoldPayment — the payment trail for one hold.
 *
 * Money moves through the EXISTING payment stack
 * (`paymentFrom: 'property_hold'`); this document is the Real Estate
 * side of that attempt. No refund path bypasses the stack (plan §6.5).
 */
const realEstateHoldPaymentSchema = mongoose.Schema(
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

    /** principal + serviceFee as charged. */
    amount: moneyField(0),

    paymentInitiation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentInitiation',
      required: false,
    },

    paymentRef: {
      type: String,
      required: false,
      trim: true,
    },

    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
    },

    paidAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateHoldPaymentSchema.plugin(toJSON);
realEstateHoldPaymentSchema.plugin(paginate);

realEstateHoldPaymentSchema.index({ hold: 1, createdAt: -1 });
realEstateHoldPaymentSchema.index({ customer: 1, createdAt: -1 });

/**
 * Production: one PENDING payment per hold. `initiateHoldPayment`
 * check-then-creates, so two concurrent taps both passed the `findOne
 * initiated` check and wrote two initiations + two payment rows. The
 * gateway callback is idempotent, but the duplicate initiation is a
 * double-charge attempt the customer sees. This partial unique makes
 * the second writer fail loudly with E11000, and the service catches
 * it and returns the existing initiation instead.
 */
realEstateHoldPaymentSchema.index(
  { hold: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING'] } },
    name: 'one_pending_hold_payment_per_hold',
  }
);

/**
 * @typedef RealEstateHoldPayment
 */
const RealEstateHoldPayment = mongoose.model('RealEstateHoldPayment', realEstateHoldPaymentSchema);

module.exports = RealEstateHoldPayment;
