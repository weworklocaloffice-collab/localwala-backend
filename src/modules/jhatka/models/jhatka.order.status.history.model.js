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

// `moneyField` is deliberately NOT imported. Nothing on this document is money —
// it records WHICH states an order passed through and WHO moved it. A status
// history with a rupee field on it would invite someone to mutate a recorded
// amount, which is exactly the F-5 shape this log exists to make impossible.

/**
 * JhatkaOrderStatusHistory — the append-only lifecycle log. §8.2.
 *
 * ## Why the order's own `lifecycle` is not enough
 *
 * `JhatkaOrder.lifecycle` holds WHERE the order is. This holds HOW IT GOT THERE.
 * Those are different questions and only the second one is answerable after the
 * fact: a disputed weight needs to know which reading produced it and when, an
 * `ON_HOLD` needs its reason, and an operator dispute needs the actor and not just
 * the state.
 *
 * Never updated, never pruned. `DairyOrderStatusHistory` is the precedent and the
 * same reasoning applies — this is what makes a support conversation about a
 * specific order resolvable without anyone guessing.
 *
 * ## `onHold` carries its own fields
 *
 * Because `ON_HOLD` is the state with a reason and an SLA clock. A generic
 * `reason` string on every transition would lose the batch that triggered it,
 * which is the thing an operator needs in front of them.
 */
const HISTORY_STATUSES = [
  'CREATED',
  'PAYMENT_PENDING',
  'PAID',
  'OUTLET_RECEIVED',
  'ACCEPTED',
  'PREPARING',
  'WEIGHING',
  'WEIGHT_CONFIRMED',
  'PACKING',
  'READY',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'REFUND_PENDING',
  'REFUNDED',
  'ON_HOLD',
];

const ACTOR_TYPES = ['customer', 'outlet', 'admin', 'system', 'rider', 'cron'];

const jhatkaOrderStatusHistorySchema = mongoose.Schema(
  {
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: false,
      default: undefined,
    },
    fromStatus: {
      type: String,
      required: false,
      enum: HISTORY_STATUSES,
      default: undefined,
    },
    toStatus: {
      type: String,
      required: true,
      enum: HISTORY_STATUSES,
    },
    /**
     * WHO moved it, and WHAT KIND of actor.
     *
     * `actorType` is separate from the user ref because a cron-generated
     * transition and an operator transition have different accountability. The
     * 10-minute `escalateStuckOnHold` job writes `actorType: 'cron'` and needs no
     * user, and a `system`-triggered `ON_HOLD` from a batch quarantine needs no
     * operator either.
     */
    actorType: {
      type: String,
      required: true,
      enum: ACTOR_TYPES,
    },
    actor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
      default: undefined,
    },
    /**
     * The name, denormalised so the record survives the user being deleted.
     * "Who released this hold" must remain answerable in three years.
     */
    actorName: {
      type: String,
      required: false,
      trim: true,
    },
    reason: {
      type: String,
      required: false,
      trim: true,
    },
    note: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * §12.4 / BR-12. Populated on a temperature or cold-chain transition.
     */
    coldChain: {
      tempC: { type: Number, required: false },
      withinBand: { type: Boolean, required: false, default: undefined },
      maxTempC: { type: Number, required: false },
    },
    /** The weight confirmation that produced a `WEIGHT_CONFIRMED` transition. */
    weightConfirmation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaWeightConfirmation',
      required: false,
      default: undefined,
    },
    /** The cron run or batch reference, for a `cron` actor. */
    batchRef: {
      type: String,
      required: false,
      trim: true,
    },
    /** Client-supplied id, for idempotent offline transitions. */
    clientRef: {
      type: String,
      required: false,
      trim: true,
    },
    at: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaOrderStatusHistorySchema.plugin(toJSON);
jhatkaOrderStatusHistorySchema.plugin(paginate);
/**
 * The order's timeline, in order. The single most common support query.
 */
jhatkaOrderStatusHistorySchema.index({ order: 1, at: 1 });
/**
 * Idempotency for offline transitions. A rider in a basement retries a status
 * change and must not produce two timeline entries. Same idea as
 * `DeliveryPOD.clientRef`, and SPARSE because web transitions have none.
 */
jhatkaOrderStatusHistorySchema.index({ clientRef: 1 }, { unique: true, sparse: true });
// The `escalateStuckOnHold` cron.
jhatkaOrderStatusHistorySchema.index({ actorType: 1, at: -1 });
// The cold-chain report: every blocked or breached transition.
jhatkaOrderStatusHistorySchema.index({ 'coldChain.withinBand': 1, at: -1 });
// The outlet's activity feed.
jhatkaOrderStatusHistorySchema.index({ outlet: 1, at: -1 });

jhatkaOrderStatusHistorySchema.statics.STATUSES = HISTORY_STATUSES;
jhatkaOrderStatusHistorySchema.statics.ACTOR_TYPES = ACTOR_TYPES;

/**
 * Did this transition freeze the order?
 *
 * The `ON_HOLD` predicate, separated so the cron cannot drift from the state it is
 * meant to escalate.
 */
jhatkaOrderStatusHistorySchema.methods.isHold = function () {
  return this.toStatus === 'ON_HOLD';
};

/**
 * Was this a human decision?
 *
 * `system` and `cron` transitions are automated; everything else had a person
 * behind it. Used to separate "an operator rejected this" from "a batch was
 * quarantined" in an activity report.
 */
jhatkaOrderStatusHistorySchema.methods.wasHumanAction = function () {
  return !['system', 'cron'].includes(this.actorType);
};

/**
 * @typedef JhatkaOrderStatusHistory
 */
const JhatkaOrderStatusHistory = mongoose.model(
  'JhatkaOrderStatusHistory',
  jhatkaOrderStatusHistorySchema
);

module.exports = JhatkaOrderStatusHistory;