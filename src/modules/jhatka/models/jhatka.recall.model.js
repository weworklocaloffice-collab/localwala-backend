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
const { assessRecallScope } = require('../utils/compliance.arithmetic');

/**
 * JhatkaRecall — a compromised batch and everyone who ate it. §5.4.
 *
 * ## The operation that runs under time pressure
 *
 * A batch is implicated. Somebody needs to know which customers received stock
 * from it, and they need to know in minutes. That is one indexed lookup:
 *
 *   JhatkaBatchAllocation.find({ batch: id, allocationType: 'CONSUMPTION' })
 *     .populate('orderItem', 'order customer lifecycle deliveredAt')
 *
 * and then this document holds the answer so the second person to be asked does
 * not repeat the query.
 *
 * ## `affectedCustomers` is written down, not assumed
 *
 * Without this array, "we notified everyone" is not a claim anyone can verify. It
 * is the single most important field in a food-safety document: it converts a
 * process from "we did the thing" into "here is the list, here is who acknowledged,
 * here is who we could not reach".
 *
 * ## The three severities, and they are not interchangeable
 *
 *   advisory   — a note. Product is fine; the customer may wish to know.
 *   withdraw   — stop selling it. No customer contact required.
 *   recall     — stop selling it AND tell everyone who ate it. The only severity
 *                that produces notifications.
 *
 * A `withdraw` that quietly generates a customer list trains people to ignore the
 * one time it matters, so `severity` gates the notification step in the service.
 */
const RECALL_SEVERITIES = ['advisory', 'withdraw', 'recall'];

const RECALL_STATUSES = ['open', 'notifying', 'closed'];

const jhatkaRecallSchema = mongoose.Schema(
  {
    recallNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** The implicated batch. One batch per recall — a shared cause is two recalls. */
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaBatch',
      required: true,
    },
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
     * The supplier, when the cause is upstream. Present on nearly every recall in
     * practice, and it is what turns this into a supplier conversation rather than
     * an internal note.
     */
    supplier: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSupplier',
      required: false,
      default: undefined,
    },
    severity: {
      type: String,
      required: true,
      enum: RECALL_SEVERITIES,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => typeof v === 'string' && v.trim().length >= 10,
        message: 'reason must be at least 10 characters — this is the document that explains a food-safety action',
      },
    },
    initiatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    initiatedByName: { type: String, required: false, trim: true },
    initiatedAt: { type: Date, required: true },

    /**
     * THE ANSWER, written down at query time.
     *
     * `orderItemIds` is a SAMPLE of up to 100 — enough to prove the query was
     * scoped correctly, without embedding thousands of ids in a document that
     * gets opened in a browser. `count` is the real number.
     */
    affectedOrderItems: {
      queriedAt: { type: Date, required: false },
      count: { type: Number, required: false, default: 0, min: 0 },
      sampleOrderItemIds: {
        type: [mongoose.SchemaTypes.ObjectId],
        required: false,
        default: [],
      },
    },
    /**
     * Who was told, and who acknowledged. §5.4.
     *
     * `acknowledgedCount < notifiedCount` is the number that stays on a compliance
     * report, because it is the one that says "we did not reach everyone".
     */
    affectedCustomers: [
      {
        _id: false,
        customer: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
        orders: [
          {
            _id: false,
            order: { type: mongoose.SchemaTypes.ObjectId, ref: 'JhatkaOrder', required: true },
            deliveredAt: { type: Date, required: false },
          },
        ],
        notifiedAt: { type: Date, required: false },
        channel: {
          type: String,
          required: false,
          enum: ['sms', 'push', 'email', 'call', 'in_app'],
        },
        acknowledgedAt: { type: Date, required: false },
      },
    ],
    notifiedCount: { type: Number, required: false, default: 0, min: 0 },
    /**
     * How many of the affected customers the fan-out actually REACHED.
     *
     * §5.4 makes `notifiedCount` the operator's proof that a recall was communicated.
     * The first implementation wrote `affectedCustomers.length` into it — the count of
     * people we INTENDED to reach — before a single message had left the process, and
     * `fullyAcknowledged()` above would then report a recall as complete that nobody
     * had ever been told about.
     *
     * It is now written only by `jhatka.notify.service.markNotified`, from what the
     * transport returned. A partial fan-out writes a partial number. That is
     * uncomfortable and it is correct: an under-reported recall gets finished, an
     * over-reported one does not.
     */
    notificationAttemptedCount: { type: Number, required: false, default: 0, min: 0 },
    /** Why the last fan-out did not fully succeed: no_admin_app, no_token, send_failed. */
    notificationFailureReason: { type: String, required: false, trim: true },
    /**
     * Where a chunked fan-out got to. A recall with thousands of affected customers
     * cannot go out in one request, and a cursor is what stops a resumed run from
     * re-notifying the first thousand people on every retry.
     */
    notificationCursor: { type: Number, required: false, default: 0, min: 0 },
    acknowledgedCount: { type: Number, required: false, default: 0, min: 0 },
    /**
     * Orders NOT yet delivered when the batch was implicated.
     *
     * Reported separately from `affectedCustomers` so the console can say "14
     * customers notified, 3 more orders blocked at the outlet" rather than dropping
     * the second group. Those orders still need a `ON_HOLD` transition — they just
     * need a different message.
     */
    undeliveredCount: { type: Number, required: false, default: 0, min: 0 },
    status: {
      type: String,
      required: false,
      enum: RECALL_STATUSES,
      default: 'open',
    },
    closedAt: { type: Date, required: false },
    closedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    resolutionNote: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaRecallSchema.plugin(toJSON);
jhatkaRecallSchema.plugin(paginate);
jhatkaRecallSchema.index({ recallNo: 1 }, { unique: true });
/** The open-recall console. */
jhatkaRecallSchema.index({ status: 1, initiatedAt: -1 });
// An outlet's recall history.
jhatkaRecallSchema.index({ outlet: 1, initiatedAt: -1 });
// The supplier conversation: "what did this supplier get recalled for?"
jhatkaRecallSchema.index({ supplier: 1, initiatedAt: -1 });
// The batch → recall chain, so "which recalls touched this batch" is one read.
jhatkaRecallSchema.index({ batch: 1, initiatedAt: -1 });

jhatkaRecallSchema.statics.SEVERITIES = RECALL_SEVERITIES;
jhatkaRecallSchema.statics.STATUSES = RECALL_STATUSES;

/**
 * Scope a recall from this batch's allocations. Delegates to the shared function.
 *
 * The one place the reverse-traceability query is interpreted. Kept as a method so
 * the console has something to call and the logic stays testable.
 *
 * @param {Array} allocations `JhatkaBatchAllocation` docs for this batch
 */
jhatkaRecallSchema.methods.scopeFrom = function (allocations) {
  return assessRecallScope(allocations);
};

/**
 * Does this severity require contacting customers?
 *
 * Only `recall` does. A `withdraw` that generates a customer list trains people to
 * ignore the one notification that matters, so this is enforced rather than left to
 * the service to remember.
 */
jhatkaRecallSchema.methods.requiresCustomerNotification = function () {
  return this.severity === 'recall';
};

/**
 * Is every notified customer accounted for?
 *
 * `acknowledgedCount === notifiedCount`. This is the number that stays on a
 * compliance report, and it being false is the honest statement "we did not reach
 * everyone".
 */
jhatkaRecallSchema.methods.fullyAcknowledged = function () {
  return this.notifiedCount > 0 && this.acknowledgedCount === this.notifiedCount;
};

/**
 * @typedef JhatkaRecall
 */
const JhatkaRecall = mongoose.model('JhatkaRecall', jhatkaRecallSchema);

module.exports = JhatkaRecall;