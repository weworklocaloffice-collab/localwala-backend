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
const {
  deriveComplianceStatus,
  daysToExpiry,
  isBlockingDocument,
} = require('../utils/compliance.arithmetic');

/**
 * JhatkaCompliance — an outlet's compliance record. §12.1.
 *
 * ## Two rules from `DairyCompliance`, carried deliberately
 *
 * **1. `status` is derived, never asserted.** `deriveComplianceStatus` in
 * `utils/compliance.arithmetic` is the single implementation and this model's
 * `deriveStatus` delegates to it. A human-entered status drifts from the dates
 * within a day.
 *
 * **2. Nothing is blocked in the model itself.** `DairyCompliance`'s header states
 * the rule verbatim: *"Encoding a hard block in the model would silently make
 * compliance a trading decision."* So `isBlocking` is DATA here, and
 * `canAcceptNewOrders()` answers a question without enforcing anything — the
 * service decides.
 *
 * ## Why the model is not `Business.qualityConfig` (defect D-1)
 *
 * `Business.qualityConfig` is 100% dairy: `minFatPercentage`, `minSnfPercentage`,
 * `rejectBelowFat`. Adding meat fields there produces an outlet carrying SNF
 * thresholds it cannot evaluate. This model is a separate collection for that
 * reason and no other.
 *
 * ## The expiry sweep's index
 *
 * Copied from dairy's `dairyComplianceSchema.index({ status: 1, 'fssai.expiresAt': 1 })`.
 * Without it, "which licences expire in the next 30 days" is a scan across every
 * outlet's documents.
 */
const COMPLIANCE_STATUSES = ['pending', 'valid', 'expiring', 'expired'];

const jhatkaComplianceSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /**
     * FSSAI. Required for activation. The class (registration / state / central)
     * varies by state and by business model, so it is an open enum here and
     * validated in the compliance slice, not hard-coded. OD-08.
     */
    fssai: {
      licenceNumber: { type: String, required: true, trim: true },
      category: {
        type: String,
        required: true,
        enum: ['registration', 'state_licence', 'central_licence'],
      },
      issuedAt: { type: Date, required: false },
      expiresAt: { type: Date, required: true },
      documentUrl: { type: String, required: false },
    },
    gstin: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },
    tradeLicence: {
      number: { type: String, required: false, trim: true },
      issuedAt: { type: Date, required: false },
      expiresAt: { type: Date, required: false },
      documentUrl: { type: String, required: false },
    },
    premisesLease: {
      documentUrl: { type: String, required: false },
      expiresAt: { type: Date, required: false },
    },
    /**
     * Supplier-side compliance, rolled up from `JhatkaSupplierDocument`.
     *
     * Read-only. A single bad supplier must not stop an outlet that has three
     * others — §12.2's blast-radius rule applied to the supply chain.
     */
    supplierCompliance: {
      verifiedCount: { type: Number, required: false, default: 0, min: 0 },
      nonCompliantCount: { type: Number, required: false, default: 0, min: 0 },
      lastEvaluatedAt: { type: Date, required: false },
    },
    /**
     * §12.3. Food-safety checks, not paperwork checks.
     *
     * `hygieneChecks` with `nextDueAt` is what a FSSAI inspector actually asks
     * about, and it is absent from the source blueprint entirely.
     */
    hygieneChecks: [
      {
        _id: false,
        checkType: {
          type: String,
          required: true,
          enum: [
            'cold_chain_temperature',
            'storage_hygiene',
            'staff_hygiene',
            'pest_control',
            'waste_disposal',
            'cross_contamination',
            'personal_hygiene',
            'water_quality',
            'equipment_cleaning',
          ],
        },
        result: {
          type: String,
          required: true,
          enum: ['pass', 'fail', 'conditional'],
        },
        checkedAt: { type: Date, required: true },
        checkedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        checkedByName: { type: String, required: false, trim: true },
        nextDueAt: { type: Date, required: false },
        notes: { type: String, required: false, trim: true },
        proofUrls: { type: [String], required: false, default: [] },
      },
    ],
    /**
     * `isBlocking` is DATA. The service decides what a block means. See the header
     * rule from `DairyCompliance`: a model that blocks is a model that has made a
     * trading decision.
     */
    documents: [
      {
        _id: false,
        type: {
          type: String,
          required: true,
          enum: ['fssai', 'gst_registration', 'trade_licence', 'premises_lease', 'other'],
        },
        reference: { type: String, required: false, trim: true },
        issuedAt: { type: Date, required: false },
        expiresAt: { type: Date, required: false, default: undefined },
        fileUrl: { type: String, required: false },
        isBlocking: { type: Boolean, required: false, default: false },
      },
    ],
    /**
     * DERIVED, never asserted. Written by `refreshStatus`, stamped with
     * `statusEvaluatedAt`.
     */
    status: {
      type: String,
      required: false,
      enum: COMPLIANCE_STATUSES,
      default: 'pending',
    },
    statusEvaluatedAt: { type: Date, required: false },
    notes: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaComplianceSchema.plugin(toJSON);
jhatkaComplianceSchema.plugin(paginate);
/** One compliance record per outlet. */
jhatkaComplianceSchema.index({ outlet: 1 }, { unique: true });
/**
 * THE EXPIRY SWEEP.
 *
 * Copied from dairy's dedicated FSSAI index, with the comment it carries there:
 * "expiry sweeps look for licences expiring soon across all outlets".
 */
jhatkaComplianceSchema.index({ status: 1, 'fssai.expiresAt': 1 });
jhatkaComplianceSchema.index({ 'fssai.expiresAt': 1 });
jhatkaComplianceSchema.index({ 'documents.expiresAt': 1 });
// The hygiene-check schedule.
jhatkaComplianceSchema.index({ 'hygieneChecks.nextDueAt': 1 });

jhatkaComplianceSchema.statics.STATUSES = COMPLIANCE_STATUSES;
jhatkaComplianceSchema.statics.EXPIRY_WARNING_DAYS = 30;

/**
 * Derive status. Delegates to the shared function.
 *
 * The delegation is the point: `JhatkaSupplierDocument` has the same rule as its
 * own static, and two implementations of "when is a document expired" is how one
 * of them ends up disagreeing with the other.
 *
 * ## It passes `this.fssai`, NOT `this`
 *
 * `deriveComplianceStatus` reads `doc.expiresAt`, and on THIS model the date lives
 * at `fssai.expiresAt`. Passing the whole record — the obvious thing to write — made
 * the function see an undefined date and return `pending` unconditionally.
 *
 * The consequence was total and silent: every outlet read as PENDING forever,
 * `canAcceptNewOrders()` was permanently false, and no outlet could take an order.
 * Nothing throws, nothing logs, every test that did not check the return value
 * passed.
 *
 * The nested shape is the whole risk of a shared function with a flat parameter,
 * and the fix is to make the call site explicit about which object it means.
 */
jhatkaComplianceSchema.statics.deriveStatus = function (compliance, now = new Date(), warningDays = 30) {
  return deriveComplianceStatus(compliance?.fssai, now, warningDays);
};

/**
 * May this outlet take NEW orders?
 *
 * ## This answers; it does not enforce
 *
 * `DairyCompliance`'s rule: nothing is blocked in the model. This method reports
 * the consequence of the dates; `jhatka.order.service` decides whether to act on
 * it, and mutating services call `assertJhatkaOperational(outlet, operation)` in
 * their own layer.
 *
 * ## `expiring` PERMITS trading — and that is the whole point of the state
 *
 * The check is `!== 'expired' && !== 'pending'`, not `=== 'valid'`.
 *
 * The first version used `=== 'valid'`, which meant an outlet whose FSSAI licence
 * was 29 days from expiry stopped trading — for a month, for no legal reason, on a
 * warning that exists precisely so somebody can renew in time. §12.2 states it
 * directly: *"30 days is not a reason to stop trading."*
 *
 * `pending` still blocks, and correctly: we have never been told the licence
 * lapses, and treating silence as permission is how a shop trades in year three on
 * a licence that expired in year one.
 *
 * ## EXISTING orders are unaffected, and that is deliberate
 *
 * A shop whose licence lapsed at noon still owes the chicken it accepted at 11:55.
 * Blocking fulfilment as well as new commerce converts a compliance problem into a
 * pile of already-paid, unfulfillable orders.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
jhatkaComplianceSchema.methods.canAcceptNewOrders = function (now = new Date()) {
  const status = deriveComplianceStatus(this.fssai, now, 30);
  // `valid` and `expiring` trade. `pending` and `expired` do not.
  return status === 'valid' || status === 'expiring';
};

/**
 * Days until the FSSAI licence expires. Null, not zero, when there is none — a UI
 * rendering "0 days" for an undated licence is telling a shop its paperwork is
 * fine when nobody has checked.
 */
jhatkaComplianceSchema.methods.daysToExpiry = function (now = new Date()) {
  return daysToExpiry(this.fssai, now);
};

/**
 * Is a specific document type one that legally stops trading?
 */
jhatkaComplianceSchema.methods.blocksTrading = function (docType) {
  return isBlockingDocument(docType);
};

/**
 * @typedef JhatkaCompliance
 */
const JhatkaCompliance = mongoose.model('JhatkaCompliance', jhatkaComplianceSchema);

module.exports = JhatkaCompliance;