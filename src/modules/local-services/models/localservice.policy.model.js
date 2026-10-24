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
 * LocalServicePolicy — Admin-configurable booking/commercial policy.
 *
 * ## Why this model exists
 *
 * The checklist (§14.2, §21) makes cancellation, rescheduling, deposit,
 * quote and payment-timing rules Admin configuration, not code constants.
 * They used to be hardcoded in three places:
 *
 *   - `cutoffHours: 24` for cancellation AND rescheduling
 *   - `feeRupees: 0` for a late cancellation
 *   - a partner-supplied `expiresAt` on every quote, with no ceiling
 *
 * So Admin could not change them without a code change, and a partner could
 * set a quote expiry of ten years.
 *
 * ## Scope
 *
 * The scope keys and their precedence are the SAME as revenue rules, so one
 * mental model governs the whole vertical:
 *
 *   provider(4) > service(3) > subcategory(2) > category(1) > platform(0)
 *
 * A service-level value that the catalogue already carries (for example
 * `Service.depositPercent`) still wins over a category policy: the more
 * specific, more explicit configuration is the one Admin set closest to the
 * service.
 *
 * ## Versioning
 *
 * A policy is versioned and dated. Changing a cancellation cutoff creates a
 * NEW version rather than editing a live one, so a booking created last week
 * is judged by the policy that was in force when it was created — the same
 * rule revenue entries already follow.
 */

const POLICY_STATUSES = ['draft', 'active', 'inactive', 'expired'];

const localServicePolicySchema = mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true },

    // Scope keys are STRINGS so Admin can add a category without code changes.
    categoryKey: { type: String, required: false, trim: true, lowercase: true, default: null },
    subcategoryKey: { type: String, required: false, trim: true, lowercase: true, default: null },
    serviceKey: { type: String, required: false, trim: true, lowercase: true, default: null },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: false, default: null },

    // --- Cancellation ---
    cancellationCutoffHours: { type: Number, required: false, min: 0, max: 720, default: 24 },
    // Retained when a customer cancels AFTER the cutoff. Zero means a full refund.
    cancellationFee: moneyField(0),
    // A provider cancellation always refunds in full; this flag lets a
    // category keep a token visit fee even so (the exception matrix in §14-D
    // says no-show and cannot-repair refund in full).
    providerCancellationRefundable: { type: Boolean, required: false, default: true },

    // --- Rescheduling ---
    rescheduleCutoffHours: { type: Number, required: false, min: 0, max: 720, default: 24 },
    rescheduleCountLimit: { type: Number, required: false, min: 0, max: 20, default: 3 },

    // --- Quotes ---
    quoteExpiryHours: { type: Number, required: false, min: 1, max: 720, default: 72 },
    quoteMaxExpiryHours: { type: Number, required: false, min: 1, max: 2160, default: 168 },

    // --- Booking window / notice ---
    advanceBookingDays: { type: Number, required: false, min: 0, max: 365, default: 60 },
    minNoticeHours: { type: Number, required: false, min: 0, max: 720, default: 0 },

    // --- Money ---
    depositPercent: { type: Number, required: false, min: 0, max: 100, default: 0 },
    taxPercent: { type: Number, required: false, min: 0, max: 100, default: 0 },
    taxLabel: { type: String, required: false, trim: true, default: 'Tax' },

    // Permitted payment timing/channels for this scope.
    allowedPaymentModes: {
      type: [String],
      required: false,
      default: [],
    },

    version: { type: Number, required: false, default: 1 },
    supersedes: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServicePolicy', required: false },
    status: { type: String, required: false, enum: POLICY_STATUSES, default: 'draft' },
    effectiveFrom: { type: Date, required: false },
    effectiveTo: { type: Date, required: false, default: undefined },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServicePolicySchema.plugin(toJSON);
localServicePolicySchema.plugin(paginate);

localServicePolicySchema.index({ code: 1, version: 1 }, { unique: true });
localServicePolicySchema.index({ categoryKey: 1, subcategoryKey: 1, serviceKey: 1, status: 1 });
localServicePolicySchema.index({ status: 1, effectiveFrom: 1 });

const LocalServicePolicy = mongoose.model('LocalServicePolicy', localServicePolicySchema);

module.exports = LocalServicePolicy;
module.exports.POLICY_STATUSES = POLICY_STATUSES;
