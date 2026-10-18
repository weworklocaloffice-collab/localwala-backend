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
 * JhatkaComplaint — a customer problem. §45.
 *
 * ## Two complaint populations, and they are not the same thing
 *
 * **Customer-raised.** Wrong item, quality, delivery, payment. A person decided
 * something was wrong.
 *
 * **System-raised.** A cold-chain breach detected at the door (BR-12), a short
 * delivery detected at weighing (BR-21), a recall reaching an undelivered order
 * (§5.4). Nobody decided anything; a threshold was crossed and a record was created.
 *
 * Both live here because both need the same resolution workflow and the same
 * support queue. `source` distinguishes them, and it matters commercially: a
 * system-raised complaint is evidence the control works, and a dashboard that
 * lumps it in with customer complaints makes the control look like a failure.
 *
 * ## A quality complaint NEVER results in meat coming back
 *
 * This is stated on the model because it is the single most important operational
 * rule in fresh-meat support, and it is counterintuitive for a support agent.
 * Fresh meat cannot be returned to stock — it is a food-safety hazard in transit —
 * and building a reverse-logistics flow for it would cost far more than the
 * refunds it prevents.
 *
 * The resolution is a refund or a credit. Never a pickup.
 */
const COMPLAINT_CATEGORIES = [
  'missing_item',
  'wrong_item',
  'quantity_issue',
  'quality_issue',
  'delivery_issue',
  'payment_issue',
  'refund_issue',
  'cold_chain_breach',
  'short_delivery',
  'over_delivery',
  'recall_notice',
];
const COMPLAINT_SOURCES = ['customer', 'system'];
const COMPLAINT_STATUSES = [
  'open',
  'acknowledged',
  'investigating',
  'resolved',
  'rejected',
  'escalated',
];
const COMPLAINT_RESOLUTIONS = [
  'refund_full',
  'refund_partial',
  'goodwill_credit',
  'replacement_on_next_order',
  'outlet_warning',
  'supplier_referred',
  'recall_action',
  'no_action',
];

const jhatkaComplaintSchema = mongoose.Schema(
  {
    complaintNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: true,
    },
    orderItem: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrderItem',
      required: false,
      default: undefined,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: COMPLAINT_CATEGORIES,
    },
    /**
     * `system` means a threshold was crossed, not that a person complained. See the
     * header note on why the distinction is load-bearing for reporting.
     */
    source: {
      type: String,
      required: true,
      enum: COMPLAINT_SOURCES,
    },
    /** Set when `source: 'system'`. The evidence that triggered it. */
    triggeredBy: {
      type: String,
      required: false,
      enum: [
        'cold_chain_pod_breach',
        'weight_shortfall',
        'weight_override',
        'recall',
        'cod_mismatch',
        'auto_fulfilled',
      ],
    },
    subject: { type: String, required: true, trim: true },
    description: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: (v) => v === undefined || typeof v === 'string' && v.trim().length >= 10,
        message: 'a complaint description must be at least 10 characters',
      },
    },
    /**
     * Evidence. A quality claim without a photo is an opinion, and a cold-chain
     * claim without a temperature is an anecdote.
     */
    attachments: [
      {
        _id: false,
        fileUrl: { type: String, required: true },
        type: {
          type: String,
          required: true,
          enum: ['photo', 'video', 'invoice', 'packaging', 'temperature_reading', 'other'],
        },
        uploadedAt: { type: Date, required: true },
        uploadedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      },
    ],
    /** The batch, for a quality complaint. Makes it a traceability query, not a search. */
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaBatch',
      required: false,
      default: undefined,
    },
    /** Temperature reading, when a cold-chain complaint. */
    observedTempC: { type: Number, required: false },
    status: {
      type: String,
      required: false,
      enum: COMPLAINT_STATUSES,
      default: 'open',
    },
    /**
     * §8. Quality complaints have a SHORT window; a shortfall has a longer one
     * because it can be found later.
     */
    windowHours: { type: Number, required: false, default: 2 },
    /**
     * NEVER `return_to_outlet` for a quality issue. See the header note.
     */
    resolution: {
      type: String,
      required: false,
      enum: COMPLAINT_RESOLUTIONS,
    },
    resolutionNote: { type: String, required: false, trim: true },
    refund: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaRefund',
      required: false,
      default: undefined,
    },
    refundAmount: moneyField(0),
    creditAmount: moneyField(0),
    resolvedAt: { type: Date, required: false },
    resolvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    resolvedByName: { type: String, required: false, trim: true },
    escalatedAt: { type: Date, required: false },
    escalatedTo: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    timeline: [
      {
        _id: false,
        status: {
          type: String,
          required: true,
          enum: COMPLAINT_STATUSES,
        },
        at: { type: Date, required: true },
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        byName: { type: String, required: false, trim: true },
        note: { type: String, required: false, trim: true },
      },
    ],
    /**
     * Linked to a support CHAT conversation, when the customer raised it in chat.
     *
     * ## This was `ref: 'Support'` and there is no such model
     *
     * The platform's support models are `SupportChatRoom` and
     * `SupportChatConversion`. A bare `Support` ref is a dangling one, and Mongoose
     * resolves refs by NAME at populate time — so it does not fail at load, does
     * not fail at boot, and throws `MissingSchemaError` in production the first
     * time somebody populates it.
     *
     * `verify.jhatka.registration.units.js` now walks every `ref:` in every jhatka
     * schema and asserts the target is registered, which is how this was found.
     *
     * `StoreComplaint` links to nothing support-related at all — the complaint IS
     * the support record. This is the same idea with an optional chat link, and the
     * name says which of the two it is.
     */
    supportConversation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SupportChatConversion',
      required: false,
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaComplaintSchema.plugin(toJSON);
jhatkaComplaintSchema.plugin(paginate);
jhatkaComplaintSchema.index({ complaintNo: 1 }, { unique: true });
// The support queue: open items, oldest first.
jhatkaComplaintSchema.index({ outlet: 1, status: 1, createdAt: 1 });
// The customer's complaint history.
jhatkaComplaintSchema.index({ customer: 1, createdAt: -1 });
// §16's category analytics — the rejection/quality report.
jhatkaComplaintSchema.index({ category: 1, createdAt: -1 });
/**
 * SEPARATE INDEX FOR SYSTEM COMPLAINTS.
 *
 * Because a system-raised cold-chain breach is evidence the control WORKS, and a
 * report that merges it with customer complaints makes a working control look
 * like a failure. This index is what lets the two populations be read apart.
 */
jhatkaComplaintSchema.index({ source: 1, createdAt: -1 });
// A quality complaint against a batch becomes a traceability question.
jhatkaComplaintSchema.index({ batch: 1, category: 1, createdAt: -1 });
// The escalation sweep.
jhatkaComplaintSchema.index({ status: 1, escalatedAt: 1 });

jhatkaComplaintSchema.statics.CATEGORIES = COMPLAINT_CATEGORIES;
jhatkaComplaintSchema.statics.SOURCES = COMPLAINT_SOURCES;
jhatkaComplaintSchema.statics.STATUSES = COMPLAINT_STATUSES;
jhatkaComplaintSchema.statics.RESOLUTIONS = COMPLAINT_RESOLUTIONS;

/**
 * Is this complaint still inside its window?
 *
 * `OD-08` recommends a 2-hour quality window and a 24-hour shortfall window, and
 * the default here follows. The window is per-complaint rather than per-outlet
 * because "how long have I got to complain about the weight" and "how long have I
 * got to complain that it smelled off" are different questions with different
 * answers.
 */
jhatkaComplaintSchema.methods.isWithinWindow = function (now = new Date()) {
  const created = new Date(this.createdAt || this.timestamps?.createdAt || now);
  const hours = (now.getTime() - created.getTime()) / 3600000;
  return hours <= (this.windowHours ?? 2);
};

/**
 * Does resolving this require a refund document?
 *
 * BR-19: no money moves without a document. `goodwill_credit` and `replacement_on_
 * next_order` do not, and saying so here keeps a support agent from "adjusting" an
 * order directly.
 */
jhatkaComplaintSchema.methods.resolutionRequiresRefund = function () {
  return this.resolution === 'refund_full' || this.resolution === 'refund_partial';
};

/**
 * @typedef JhatkaComplaint
 */
const JhatkaComplaint = mongoose.model('JhatkaComplaint', jhatkaComplaintSchema);

module.exports = JhatkaComplaint;