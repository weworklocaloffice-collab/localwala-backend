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

/** Days before expiry at which a licence is treated as needing attention. */
const EXPIRY_WARNING_DAYS = 30;

/**
 * DairyCompliance — an outlet's regulatory and hygiene standing.
 *
 * A dairy outlet cannot legally trade without a valid FSSAI licence, and that
 * licence expires on a date nobody remembers. This holds the licence, the hygiene
 * check history, and any other dated paperwork, so "is this outlet still allowed
 * to sell" is a question with an answer rather than an assumption.
 *
 * Two deliberate choices:
 *
 *   1. **`status` is derived, not asserted.** `refreshStatus()` recomputes it from
 *      the dates, so a licence cannot be marked `valid` by hand while it is
 *      actually expired. It is still persisted, because dashboards need to filter
 *      and sort on it without recomputing for every outlet.
 *   2. **Nothing is blocked on expiry here.** An expired licence is surfaced as
 *      `expired`, and it is up to the caller to decide whether that refuses an
 *      order. Encoding a hard block in the model would silently make compliance a
 *      trading decision, which is not what this record is for.
 */
const dairyComplianceSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /** The FSSAI (Food Safety and Standards Authority of India) licence. */
    fssai: {
      licenceNumber: {
        type: String,
        required: false,
        trim: true,
      },
      issuedAt: {
        type: Date,
        required: false,
      },
      expiresAt: {
        type: Date,
        required: false,
      },
      documentUrl: {
        type: String,
        required: false,
      },
      /**
       * Licence category. `petrol`/`state_licence` are FSSAI's own tiers and
       * carry different turnover thresholds, so the tier is recorded rather than
       * inferred from revenue.
       */
      category: {
        type: String,
        required: false,
        default: 'petrol', // petrol | state_licence | central_licence | registration
      },
    },
    /**
     * Hygiene and food-safety checks. Append-only in practice: a failed check is
     * evidence, so records are never edited, only added.
     */
    hygieneChecks: [
      {
        checkType: {
          type: String,
          required: true,
          trim: true,
        },
        result: {
          type: String,
          required: true,
          // `conditional` is real: "passed with a note" must not look like a pass.
          enum: ['pass', 'fail', 'conditional'],
        },
        checkedAt: {
          type: Date,
          required: true,
        },
        checkedBy: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'User',
          required: false,
        },
        /** Set when the check itself must be repeated. */
        nextDueAt: {
          type: Date,
          required: false,
        },
        notes: {
          type: String,
          required: false,
        },
        /** Photos or reports attached to the check. */
        proofUrls: {
          type: [String],
          default: [],
        },
      },
    ],
    /**
     * Any other dated paperwork the outlet must hold — pesticide residue reports,
     * milk quality certificates, fire NOC, GST registration.
     */
    documents: [
      {
        type: {
          type: String,
          required: true,
          trim: true,
        },
        reference: {
          type: String,
          required: false,
        },
        issuedAt: {
          type: Date,
          required: false,
        },
        expiresAt: {
          type: Date,
          required: false,
        },
        fileUrl: {
          type: String,
          required: false,
        },
      },
    ],
    /**
     * Cached compliance state. Recomputed by `refreshStatus()`; see note 1 above.
     * `pending` means no licence has been recorded yet.
     */
    status: {
      type: String,
      required: false,
      default: 'pending', // pending | valid | expiring | expired
    },
    /** When `status` was last recomputed. */
    statusEvaluatedAt: {
      type: Date,
      required: false,
    },
    notes: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

/**
 * Whole days until the FSSAI licence expires.
 *
 * Null when there is no licence or no expiry — deliberately not zero, because
 * "no licence on file" and "expired today" are different problems.
 */
dairyComplianceSchema.virtual('daysToExpiry').get(function daysToExpiry() {
  if (!this.fssai || !this.fssai.expiresAt) {
    return null;
  }
  const ms = new Date(this.fssai.expiresAt).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
});

dairyComplianceSchema.plugin(toJSON);
dairyComplianceSchema.plugin(paginate);

// One compliance record per outlet. Not unique on `business` alone because a
// franchise group may keep a group-level record alongside per-outlet ones later;
// the partial index below enforces one record per business per compliance kind.
dairyComplianceSchema.index({ business: 1 });
dairyComplianceSchema.index({ status: 1, 'fssai.expiresAt': 1 });
// Expiry sweeps look for licences expiring soon across all outlets.
dairyComplianceSchema.index({ 'fssai.expiresAt': 1 });
dairyComplianceSchema.index({ 'documents.expiresAt': 1 });

/**
 * @typedef DairyCompliance
 */
const DairyCompliance = mongoose.model(
  'DairyCompliance',
  dairyComplianceSchema
);

DairyCompliance.EXPIRY_WARNING_DAYS = EXPIRY_WARNING_DAYS;

module.exports = DairyCompliance;
