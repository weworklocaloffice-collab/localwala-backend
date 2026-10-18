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
 * LocalServiceQuote — itemised quotation with revisions + expiry.
 * Accepted quote becomes the booking price (snapshot copied to booking).
 * Revisions preserved; only the latest pending revision is actionable.
 */
const quoteRevisionSchema = new mongoose.Schema(
  {
    _id: false,
    version: { type: Number, required: true },
    labourAmount: { type: Number, required: true },
    partsAmount: { type: Number, required: true },
    note: { type: String, required: false, trim: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const localServiceQuoteSchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: true },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: false },
    labourAmount: moneyField(0),
    partsAmount: moneyField(0),
    scopeOfWork: { type: String, required: false, trim: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ['SUBMITTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED'],
      default: 'SUBMITTED',
    },
    revisions: { type: [quoteRevisionSchema], required: false, default: [] },
    version: { type: Number, required: false, default: 1 },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceQuoteSchema.plugin(toJSON);
localServiceQuoteSchema.plugin(paginate);

localServiceQuoteSchema.index({ booking: 1, createdAt: -1 });
localServiceQuoteSchema.index({ status: 1, expiresAt: 1 });

const LocalServiceQuote = mongoose.model('LocalServiceQuote', localServiceQuoteSchema);

module.exports = LocalServiceQuote;
