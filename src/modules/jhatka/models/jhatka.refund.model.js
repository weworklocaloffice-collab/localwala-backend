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
 * JhatkaRefund — money going back to a customer. Always a document. BR-19.
 *
 * ## Why never mutate the order amount in place
 *
 * Because "the customer's order was ₹400 and is now ₹368" is not a fact anyone
 * can audit. It is a row that changed. A refund document is a row that was added,
 * with a reason, a status history, a gateway reference and a reversal path.
 *
 * This is the same lesson as the stores refund model, and the same reason its
 * `timeline[]` array exists. What Jhatka adds is that refunds here are largely
 * MECHANICAL rather than discretionary — a weight shortfall produces one
 * automatically (BR-21), with no support ticket and no human decision. Which
 * makes the document more important, not less: the thing that happens without a
 * human in the loop needs a record more than the thing that does not.
 *
 * ## `componentKey` mirrors `StoreRefund`, deliberately
 *
 * `weight:<orderItemId>` for a weight adjustment, `item:<id>` for a line
 * cancellation, `delivery_fee` for a delivery failure. The unique index on
 * `{order, componentKey}` is what stops a double refund when two requests race —
 * the second write collides rather than paying twice.
 *
 * ## The gateway call is mandatory here — F-5
 *
 * `stores.refund.service.js` records refunds and NEVER calls a gateway;
 * `gatewayRefundId` is written by nothing in that file. The state machine is
 * complete and the money never moves. This model exists to make that impossible
 * here: a refund in `REFUNDED` status with no `gatewayRefundId` is an invalid
 * state, and the verify suite asserts it cannot be reached.
 */
const REFUND_REASONS = [
  'WEIGHT_ADJUSTMENT',
  'SHORT_DELIVERY',
  'QUALITY_ISSUE',
  'WRONG_ITEM',
  'ITEM_UNAVAILABLE',
  'OUTLET_REJECTED',
  'PAYMENT_FAILED',
  'CUSTOMER_CANCELLATION',
  'DELIVERY_FAILED',
  'GOODWILL',
  'OTHER',
];

const REFUND_STATUSES = ['REFUND_PENDING', 'PROCESSING', 'REFUNDED', 'FAILED', 'REVERSED'];

/**
 * The state machine, copied from `stores.refund.service.js`.
 *
 * `REFUNDED → REVERSED` is legal because a chargeback can arrive after the money
 * is gone. `FAILED → PROCESSING` is legal because a gateway timeout is not a
 * permanent failure and must be retryable. Everything else is terminal.
 */
const REFUND_TRANSITIONS = {
  REFUND_PENDING: ['PROCESSING', 'REVERSED'],
  PROCESSING: ['REFUNDED', 'FAILED', 'REVERSED'],
  REFUNDED: ['REVERSED'],
  FAILED: ['PROCESSING'],
  REVERSED: [],
};

const jhatkaRefundSchema = mongoose.Schema(
  {
    refundNo: {
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
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * What is being refunded. `weight:<orderItemId>` is the common case and the
     * reason this model exists at all.
     */
    componentKey: {
      type: String,
      required: true,
      trim: true,
    },
    /** Pre-tax amount going back. */
    amount: moneyField(0),
    /**
     * The proportional tax reversal, computed from the FROZEN snapshot rate
     * (BR-20), never from the current `TaxConfiguration`.
     */
    taxAmount: moneyField(0),
    /** `amount + taxAmount`. What actually leaves the platform. */
    netAmount: moneyField(0),
    reason: {
      type: String,
      required: true,
      enum: REFUND_REASONS,
    },
    reasonNote: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * Who bears the cost. `platform_absorbed` is the normal case for a weight
     * adjustment: the customer is made whole and the platform records the loss,
     * which is what makes BR-06 affordable rather than aspirational.
     */
    fundingSource: {
      type: String,
      required: true,
      enum: ['platform_absorbed', 'outlet_credit', 'cash_payout', 'supplier_chargeback'],
    },
    /**
     * The weighing that produced this refund. Present for `WEIGHT_ADJUSTMENT` and
     * `SHORT_DELIVERY`, absent for a cancellation.
     */
    weightConfirmation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaWeightConfirmation',
      required: false,
      default: undefined,
    },
    /** BR-19 / F-5: mandatory before `REFUNDED` can be reached. */
    gatewayRefundId: {
      type: String,
      required: false,
      trim: true,
    },
    gateway: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * The original charge to refund AGAINST.
     *
     * Distinct from `gatewayRefundId`, which is the id of the REFUND. Without this,
     * `jhatka.refund.settlement.js` cannot know which payment to reverse — it would
     * find `gatewayRefundId` blank, and the refund would sit `REFUND_PENDING` for ever.
     * This is the field whose absence made F-5 impossible to satisfy.
     */
    gatewayPaymentId: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * Why `gateway` / `gatewayPaymentId` are what they are.
     *
     * Written by `resolveRefundGateway` at raise time. When a gateway refund sits
     * `FAILED` with "no gateway or gatewayPaymentId recorded", this field is what
     * distinguishes "the order had no initiation to read" from "the payResponse had
     * no recognisable charge id" — two different problems with two different owners.
     * Without it the failure reason is a dead end.
     */
    gatewayResolutionNote: { type: String, required: false, trim: true },

    /**
     * How the money actually moved: `gateway` (provider refund), `cod` (nothing was
     * collected; the customer hands over less), or `credit` (platform absorbs it).
     *
     * Recorded because `REFUNDED` alone does not say whether anyone was ever PAID.
     * A COD refund and a gateway refund are the same status and completely different
     * events, and an audit that cannot tell them apart cannot answer "did the customer
     * get their money back".
     */
    settlementRoute: {
      type: String,
      required: false,
      enum: ['gateway', 'cod', 'credit'],
    },

    /** When the money actually moved. NOT the same as the last attempt. */
    settledAt: {
      type: Date,
      required: false,
    },
    settledBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    settledByName: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * Set when a refund exhausts its attempts and needs a human.
     *
     * Retrying a gateway that has definitively refused will never succeed, and a
     * refund left in `FAILED` with no marker is indistinguishable from one that is
     * merely waiting for its next sweep.
     */
    parkedAt: {
      type: Date,
      required: false,
    },

    status: {
      type: String,
      required: false,
      enum: REFUND_STATUSES,
      default: 'REFUND_PENDING',
    },
    /** Append-only status history. Every transition appends. */
    timeline: [
      {
        _id: false,
        status: {
          type: String,
          required: true,
          enum: REFUND_STATUSES,
        },
        at: { type: Date, required: true },
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        byName: { type: String, required: false, trim: true },
        note: { type: String, required: false, trim: true },
      },
    ],
    failureReason: {
      type: String,
      required: false,
      trim: true,
    },
    reversedAt: {
      type: Date,
      required: false,
    },
    reversedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    reversedByName: {
      type: String,
      required: false,
      trim: true,
    },
    /** The gateway's own retry attempts. A failed refund is a support queue. */
    attempts: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    lastAttemptAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaRefundSchema.plugin(toJSON);
jhatkaRefundSchema.plugin(paginate);
jhatkaRefundSchema.index({ refundNo: 1 }, { unique: true });
/**
 * The double-refund guard.
 *
 * UNIQUE on `{order, weightConfirmation}` - so two racing requests for the SAME
 * weight adjustment collide on insert rather than paying twice, and so are retries
 * of one weigh.
 *
 * Keyed on `weightConfirmation`, NOT `componentKey`. A `{order, componentKey}`
 * index also blocks a *legitimate* second weigh: VW-10 requires that re-weighing the
 * same line after a mis-read scale produces a NEW refund for the new attempt, and
 * `weight:<sku>` is identical across attempts, so the second refund died with E11000
 * and the endpoint returned 500. One refund per CONFIRMATION is exactly the right
 * granularity: one attempt, one refund. `componentKey` remains required because it
 * says WHAT was refunded, but it no longer carries uniqueness.
 *
 * PARTIAL, because `weightConfirmation` is optional: refund types that do not come
 * from a weigh (line cancellation, delivery failure) leave it null, and a plain
 * unique index would collide every one of them against each other.
 */
jhatkaRefundSchema.index(
  { order: 1, weightConfirmation: 1 },
  {
    unique: true,
    partialFilterExpression: { weightConfirmation: { $type: 'objectId' } },
  }
);
// The failed-refund console: what needs retrying.
jhatkaRefundSchema.index({ status: 1, createdAt: -1 });
// The outlet's refund history and the customer's refund history.
jhatkaRefundSchema.index({ outlet: 1, status: 1, createdAt: -1 });
jhatkaRefundSchema.index({ customer: 1, createdAt: -1 });
// BR-19: find every refund raised by a weighing, for a recall investigation.
jhatkaRefundSchema.index({ weightConfirmation: 1 });

jhatkaRefundSchema.statics.REFUND_STATUSES = REFUND_STATUSES;
jhatkaRefundSchema.statics.REFUND_TRANSITIONS = REFUND_TRANSITIONS;
jhatkaRefundSchema.statics.REASONS = REFUND_REASONS;

/** May this refund move from `from` to `to`? */
jhatkaRefundSchema.statics.canTransition = function (from, to) {
  const allowed = REFUND_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * Is `REFUNDED` reachable without a gateway reference?
 *
 * This is F-5 expressed as a method. `stores.refund.service.js` can reach
 * `REFUNDED` with `gatewayRefundId` empty, because nothing ever writes it — the
 * state machine is complete and the money never leaves. Making this a method means
 * the service can assert it, and the verify suite can test it.
 *
 * @returns {boolean} true means the state is INVALID
 */
jhatkaRefundSchema.methods.isRefundedWithoutGatewayId = function () {
  return this.status === 'REFUNDED' && !this.gatewayRefundId;
};

/**
 * Is this refund the automatic consequence of a weight shortfall?
 *
 * BR-21: under-delivery is not a support ticket. If it was raised by a human, the
 * process is working; if it was not, the automatic path is being exercised and
 * should be reported on.
 */
jhatkaRefundSchema.methods.wasAutomatic = function () {
  return (
    this.reason === 'WEIGHT_ADJUSTMENT' &&
    !!this.weightConfirmation &&
    !this.timeline?.some((t) => t.by)
  );
};

/**
 * @typedef JhatkaRefund
 */
const JhatkaRefund = mongoose.model('JhatkaRefund', jhatkaRefundSchema);

module.exports = JhatkaRefund;