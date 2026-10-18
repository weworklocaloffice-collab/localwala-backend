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

module.exports.PROVIDER_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'CLOSED',
  'REJECTED',
]);

/**
 * LocalServiceProvider — onboarding identity (realestate Vendor pattern).
 * `status` (moderation) vs `bookable` (commerce) are separate axes:
 * approved but incomplete setup = not bookable.
 */
const localServiceProviderSchema = mongoose.Schema(
  {
    owner: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: false },
    businessName: { type: String, required: true, trim: true },
    contactName: { type: String, required: false, trim: true },
    contactPhone: { type: String, required: false, trim: true },
    providerType: {
      type: String,
      required: false,
      enum: ['independent', 'business', 'salon', 'hotel', 'rental', 'trainer', 'multi_location'],
      default: 'independent',
    },
    serviceKeys: { type: [String], required: false, default: [] },
    status: {
      type: String,
      required: true,
      enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'CLOSED', 'REJECTED'],
      default: 'DRAFT',
    },
    bookable: { type: Boolean, required: false, default: false },
    rejectReason: { type: String, required: false, trim: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceProviderSchema.plugin(toJSON);
localServiceProviderSchema.plugin(paginate);

localServiceProviderSchema.index({ owner: 1 });
localServiceProviderSchema.index({ status: 1, createdAt: -1 });

const LocalServiceProvider = mongoose.model('LocalServiceProvider', localServiceProviderSchema);

module.exports = LocalServiceProvider;
