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
const { BOOKING_MODES } = require('../constants/booking.modes');

/**
 * LocalService — platform service definition (bookable concept).
 * Partners publish offerings against this; price lives on offering/variant,
 * behaviour (modes/duration) lives here + versioned config snapshot.
 */
const localServiceServiceSchema = mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9_]+$/ },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true },
    category: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceCategory', required: true },
    categoryKey: { type: String, required: false, lowercase: true, trim: true },
    bookingMode: { type: String, required: true, enum: BOOKING_MODES },
    pricingMode: {
      type: String,
      required: true,
      enum: ['FIXED', 'VARIANT', 'HOURLY', 'UNIT_BASED', 'DATE_BASED', 'QUOTE', 'INSPECTION_QUOTE'],
    },
    baseDurationMinutes: { type: Number, required: false, default: 60, min: 0 },
    inspectionRequired: { type: Boolean, required: false, default: false },
    quoteRequired: { type: Boolean, required: false, default: false },
    // Partner price bands (0 = no band). Enforced in offering creation.
    minPrice: moneyField(0),
    maxPrice: moneyField(0),
    // Inspection fee rule (INSPECTION_QUOTE): additional = on top of quote,
    // credited = adjusted against final invoice. Must be displayed pre-booking.
    inspectionFee: moneyField(0),
    inspectionFeeTreatment: { type: String, required: false, enum: ['additional', 'credited'], default: 'additional' },
    // Gateway payment timing: 0 = full prepayment, 1-99 = deposit now and
    // balance later, 100 = full prepayment.
    depositPercent: { type: Number, required: false, min: 0, max: 100, default: 0 },
    // Permitted payment modes for this service. Booking paymentMode must be listed.
    allowedPaymentModes: {
      type: [String],
      required: false,
      default: ['gateway'],
    },
    configVersion: { type: Number, required: false, default: 1 },
    status: { type: String, required: true, enum: ['draft', 'active', 'inactive'], default: 'draft' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceServiceSchema.plugin(toJSON);
localServiceServiceSchema.plugin(paginate);

localServiceServiceSchema.index({ key: 1 }, { unique: true });
localServiceServiceSchema.index({ category: 1, status: 1 });
localServiceServiceSchema.index({ status: 1 });

const LocalServiceService = mongoose.model('LocalServiceService', localServiceServiceSchema);

module.exports = LocalServiceService;
