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

const assignmentSchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: true },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    staff: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceStaff', required: false },
    resource: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceResource', required: false },
    startAt: { type: Date, required: false },
    endAt: { type: Date, required: false },
    status: { type: String, required: true, enum: ['assigned', 'released'], default: 'assigned' },
    releasedAt: { type: Date, required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);
assignmentSchema.plugin(toJSON);
assignmentSchema.plugin(paginate);
assignmentSchema.index({ booking: 1 }, { unique: true });
assignmentSchema.index({ staff: 1, status: 1, startAt: 1, endAt: 1 });
assignmentSchema.index({ resource: 1, status: 1, startAt: 1, endAt: 1 });
const LocalServiceAssignment = mongoose.model('LocalServiceAssignment', assignmentSchema);

const lineSchema = new mongoose.Schema(
  {
    _id: false,
    label: { type: String, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const invoiceSchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: true, unique: true },
    lines: { type: [lineSchema], required: true },
    total: moneyField(0),
    status: { type: String, required: true, enum: ['issued', 'void'], default: 'issued' },
  },
  { timestamps: true, toJSON: { getters: true } }
);
invoiceSchema.plugin(toJSON);
invoiceSchema.plugin(paginate);
const LocalServiceInvoice = mongoose.model('LocalServiceInvoice', invoiceSchema);

const reviewSchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: true },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    customer: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: false, trim: true, maxlength: 2000 },
  },
  { timestamps: true, toJSON: { getters: true } }
);
reviewSchema.plugin(toJSON);
reviewSchema.plugin(paginate);
reviewSchema.index({ booking: 1 }, { unique: true });
reviewSchema.index({ provider: 1, createdAt: -1 });
const LocalServiceReview = mongoose.model('LocalServiceReview', reviewSchema);

const complaintSchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: false },
    raisedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: ['open', 'resolved'], default: 'open' },
  },
  { timestamps: true, toJSON: { getters: true } }
);
complaintSchema.plugin(toJSON);
complaintSchema.plugin(paginate);
complaintSchema.index({ status: 1, createdAt: -1 });
const LocalServiceComplaint = mongoose.model('LocalServiceComplaint', complaintSchema);

/** Pure invoice total (rupees). */
function invoiceTotal(lines = []) {
  return Number(lines.reduce((s, l) => s + Number(l.amount || 0), 0).toFixed(2));
}

module.exports = { LocalServiceAssignment, LocalServiceInvoice, LocalServiceReview, LocalServiceComplaint, invoiceTotal };
