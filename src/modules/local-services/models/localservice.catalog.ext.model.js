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
 * LocalServiceTemplate — reusable admin configuration for a service type.
 * Services created from a template inherit its defaults; the resolved terms
 * are frozen into ServiceConfigurationVersion per booking (never live refs).
 */
const templateSchema = mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9_]+$/ },
    name: { type: String, required: true, trim: true },
    bookingMode: { type: String, required: true, enum: ['INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING'] },
    pricingMode: {
      type: String,
      required: true,
      enum: ['FIXED', 'VARIANT', 'HOURLY', 'UNIT_BASED', 'DATE_BASED', 'QUOTE', 'INSPECTION_QUOTE'],
    },
    requiredFacets: { type: [String], required: false, default: [] },
    requiredDocuments: { type: [String], required: false, default: [] },
    inspectionRequired: { type: Boolean, required: false, default: false },
    depositPercent: { type: Number, required: false, min: 0, max: 100, default: 0 },
    cancellationCutoffHours: { type: Number, required: false, min: 0, default: 24 },
    status: { type: String, required: true, enum: ['draft', 'active', 'inactive'], default: 'draft' },
  },
  { timestamps: true, toJSON: { getters: true } }
);
templateSchema.plugin(toJSON);
templateSchema.plugin(paginate);
templateSchema.index({ key: 1 }, { unique: true });
const LocalServiceTemplate = mongoose.model('LocalServiceTemplate', templateSchema);

/**
 * LocalServiceAddon — optional additional work/features per service.
 * Selected at booking time; priced by the pricing engine, snapshotted.
 */
const addonSchema = mongoose.Schema(
  {
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: true },
    name: { type: String, required: true, trim: true },
    price: moneyField(0),
    unit: { type: String, required: false, trim: true, default: 'flat' },
    status: { type: String, required: true, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);
addonSchema.plugin(toJSON);
addonSchema.plugin(paginate);
addonSchema.index({ service: 1, status: 1 });
const LocalServiceAddon = mongoose.model('LocalServiceAddon', addonSchema);

/**
 * LocalServiceConfigVersion — immutable resolved configuration per booking.
 * Changing admin config creates a new version; bookings pin theirs forever.
 */
const configVersionSchema = mongoose.Schema(
  {
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: true },
    version: { type: Number, required: true },
    terms: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);
configVersionSchema.plugin(toJSON);
configVersionSchema.plugin(paginate);
configVersionSchema.index({ service: 1, version: 1 }, { unique: true });
const LocalServiceConfigVersion = mongoose.model('LocalServiceConfigVersion', configVersionSchema);

/**
 * BookingItem — embedded line-item snapshot (schema, not model: Mongoose
 * rejects arrays of models — jhatka order-item pattern).
 */
const bookingItemSchema = new mongoose.Schema(
  {
    _id: false,
    kind: { type: String, required: true, enum: ['service', 'variant', 'addon', 'fee', 'discount', 'tax'] },
    refId: { type: mongoose.SchemaTypes.ObjectId, required: false },
    label: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1, min: 0 },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

/**
 * LocalServiceRefundRequest — customer/provider refund workflow.
 * Component-scoped, linked to payment; gateway reference recorded on completion.
 * Original payment/entries never edited — reversal entries carry the money.
 */
const refundSchema = mongoose.Schema(
  {
    booking: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceBooking', required: true },
    payment: { type: mongoose.SchemaTypes.ObjectId, ref: 'PaymentInitiation', required: false },
    components: { type: [String], required: false, default: [] },
    requestedAmount: moneyField(0),
    approvedAmount: moneyField(0),
    reason: { type: String, required: true, trim: true },
    policyVersion: { type: Number, required: false },
    status: {
      type: String,
      required: true,
      enum: ['requested', 'approved', 'rejected', 'processing', 'completed', 'failed'],
      default: 'requested',
    },
    gatewayRefundReference: { type: String, required: false, trim: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);
refundSchema.plugin(toJSON);
refundSchema.plugin(paginate);
refundSchema.index({ booking: 1, createdAt: -1 });
refundSchema.index({ status: 1 });
const LocalServiceRefundRequest = mongoose.model('LocalServiceRefundRequest', refundSchema);

module.exports = {
  LocalServiceTemplate,
  LocalServiceAddon,
  LocalServiceConfigVersion,
  LocalServiceRefundRequest,
  bookingItemSchema,
};
