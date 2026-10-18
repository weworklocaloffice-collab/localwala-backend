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
const { BOOKING_MODES, BOOKING_STATUSES } = require('../constants/booking.modes');
const { bookingItemSchema } = require('./localservice.catalog.ext.model');

/**
 * LocalServiceBooking — header record. Money frozen here (paise via moneyField),
 * catalogue looked up by snapshot (never live refs for history).
 * One booking = one provider scope; recurring occurrences are separate rows.
 */
const localServiceBookingSchema = mongoose.Schema(
  {
    bookingCode: { type: String, required: true, uppercase: true, trim: true },
    customer: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: false },
    categoryKey: { type: String, required: false, lowercase: true, trim: true },
    subcategoryKey: { type: String, required: false, lowercase: true, trim: true },
    serviceKey: { type: String, required: false, lowercase: true, trim: true },
    bookingMode: { type: String, required: true, enum: BOOKING_MODES },
    status: { type: String, required: true, enum: BOOKING_STATUSES, default: 'DRAFT' },
    // Schedule: slot uses scheduledAt; date-range uses startAt/endAt.
    scheduledAt: { type: Date, required: false },
    startAt: { type: Date, required: false },
    endAt: { type: Date, required: false },
    address: { type: mongoose.SchemaTypes.ObjectId, ref: 'UserAddress', required: false },
    addressSnapshot: { type: mongoose.Schema.Types.Mixed, required: false },
    // Price snapshot (backend-calculated, never trusted from client)
    labourAmount: moneyField(0),
    partsAmount: moneyField(0),
    discountAmount: moneyField(0),
    serviceValue: moneyField(0),
    // Line-item snapshot: service/variant/addon/fee/discount/tax rows frozen at pricing.
    items: { type: [bookingItemSchema], required: false, default: [] },
    // Revenue link (written on COMPLETION_VERIFIED via booking.service hook)
    revenueEntry: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceRevenueEntry', required: false },
    revenueAppliedAt: { type: Date, required: false },
    payment: { type: mongoose.SchemaTypes.ObjectId, ref: 'PaymentInitiation', required: false },
    // gateway = online via shared stack; wallet = shared wallet debit; cod = cash
    // at completion; direct = technician collected (cash/UPI) and declares it —
    // commission becomes a platform receivable netted at settlement (§14-C).
    paymentMode: { type: String, required: true, enum: ['gateway', 'wallet', 'cod', 'direct'], default: 'gateway' },
    paymentStatus: { type: String, required: true, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    cancelReason: { type: String, required: false, trim: true },
    completedAt: { type: Date, required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceBookingSchema.plugin(toJSON);
localServiceBookingSchema.plugin(paginate);

localServiceBookingSchema.index({ bookingCode: 1 }, { unique: true });
localServiceBookingSchema.index({ customer: 1, createdAt: -1 });
localServiceBookingSchema.index({ provider: 1, status: 1, createdAt: -1 });
localServiceBookingSchema.index({ status: 1, scheduledAt: 1 });

const LocalServiceBooking = mongoose.model('LocalServiceBooking', localServiceBookingSchema);

module.exports = LocalServiceBooking;
