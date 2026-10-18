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
 * JhatkaDelivery — one rider, one order, one customer. §13.3.
 *
 * ## Not a run
 *
 * `DeliveryRun` is a milk-can manifest with `cansOut`, `cansIn`, a pickup leg and a
 * return-leg variance reconciliation gate. A grocery delivery has none of those.
 * This model is the stores shape — `StoreDelivery`, one driver per order — because
 * that is the shape the use case actually has.
 *
 * ## §3.6: `codCollectionAmount` is frozen at WEIGHT_CONFIRMED
 *
 * This is the field that makes BR-06 work at the door. It is written once, when
 * the weight is confirmed, and it is `min(ceiling, actual)` — never more than the
 * estimate plus the COD tolerance. The rider is shown one number before pickup and
 * collects that number, and the app shows the customer the same number.
 *
 * If it were computed at dispatch instead, a rider would arrive holding a figure
 * that no document behind them supports.
 *
 * ## `coldChain` is computed, not documented. BR-12.
 *
 * `transitMinutes > maxTransitMinutes` BLOCKS dispatch at `PICKED_UP`. Fresh meat
 * above 4 °C is unsafe, and this is the last moment at which that is still
 * fixable by assigning a closer rider rather than after the fact.
 */
const DELIVERY_STATUSES = [
  'assigned',
  'accepted',
  'picked_up',
  'out_for_delivery',
  'delivered',
  'failed',
  'cancelled',
];

const DELIVERY_TRANSITIONS = {
  assigned: ['accepted', 'cancelled', 'failed'],
  accepted: ['picked_up', 'cancelled', 'failed'],
  // The transit-time guard fires HERE, not at dispatch assignment.
  picked_up: ['out_for_delivery', 'failed'],
  out_for_delivery: ['delivered', 'failed'],
  delivered: [],
  failed: [],
  cancelled: [],
};

const COD_STATUSES = ['not_applicable', 'pending', 'collected', 'reconciled', 'failed'];

const jhatkaDeliverySchema = mongoose.Schema(
  {
    deliveryNo: {
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
    /**
     * Null until assigned. A platform-pool rider has `driver.outlet === null`,
     * which is a different thing from no driver assigned at all.
     */
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaDriver',
      required: false,
      default: undefined,
    },
    /**
     * Copied at assignment time, not read from the outlet at settlement time.
     * An outlet changing its delivery mode mid-day must not retroactively change
     * who paid last week's riders.
     */
agentMode: {
    type: String,
    required: false,
    enum: ['own_fleet', 'platform_pool'],
    /**
     * Defaults to the outlet's own riders, NOT `platform_pool`.
     *
     * Jhatka has no platform pool — every rider is outlet-owned, and the driver UI
     * lives in Partner_app. This field previously defaulted to `platform_pool`, so any
     * dispatch that did not set it explicitly produced a delivery booked against a
     * pool that does not exist. `platform_pool` is retained in the enum only for
     * rows that genuinely describe pooled work; it must be chosen deliberately.
     */
    default: 'own_fleet',
    },
    status: {
      type: String,
      required: false,
      enum: DELIVERY_STATUSES,
      default: 'assigned',
    },

    // ---- COD. §3.6 ----
    codStatus: {
      type: String,
      required: false,
      enum: COD_STATUSES,
      default: 'not_applicable',
    },
    /**
     * FROZEN AT WEIGHT CONFIRMATION. `min(ceiling, actual)`.
     *
     * The one number the rider quotes and the customer agreed to. Never more than
     * `estimatedAmount × (1 + codTolerancePct)` — the ceiling exists precisely so an
     * over-delivery cannot become a demand for more cash at the door.
     */
    codCollectionAmount: moneyField(0),
    codCollectedAmount: moneyField(0),
    codCollectedAt: { type: Date, required: false },
    codCollectedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    codReceiptUrl: { type: String, required: false },
    codReconciledAt: { type: Date, required: false },
    codReconciledBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    /**
     * Frozen at WEIGHT_CONFIRMED. A rider cannot quote a different figure from the
     * app, and a mismatch is a reconciliation exception rather than a judgement.
     */
    codFrozenAt: { type: Date, required: false },
    codVariance: moneyField(0),

    // ---- address ----
    addressSnapshot: { type: mongoose.SchemaTypes.Mixed, required: false },
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },
    receiverName: { type: String, required: false, trim: true },
    receiverContact: { type: Number, required: false },
    /** No nested `default: 'Point'` — see the platform-wide geometry convention. */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: { type: [Number], required: false },
    },

    // ---- cold chain. BR-12 ----
    /**
     * BR-12, and the reason this model is not just `StoreDelivery`.
     *
     * `transitMinutes > maxTransitMinutes` BLOCKS the `picked_up` transition. Fresh
     * meat above 4 °C is unsafe, and this is the last point at which assigning a
     * closer rider fixes it.
     */
    coldChain: {
      packingTempC: { type: Number, required: false },
      packingAt: { type: Date, required: false },
      pickedUpTempC: { type: Number, required: false },
      pickedUpAt: { type: Date, required: false },
      deliveredTempC: { type: Number, required: false },
      deliveredAt: { type: Date, required: false },
      transitMinutes: { type: Number, required: false },
      maxTransitMinutes: { type: Number, required: false },
      /** Set when the transit-time guard refuses the pickup. */
      blockedAt: { type: Date, required: false },
      blockedReason: { type: String, required: false, trim: true },
      /**
       * A post-delivery temperature breach RAISES A COMPLAINT AUTOMATICALLY. The
       * customer should not have to report that the chicken arrived warm.
       */
      breachDetectedAt: { type: Date, required: false },
      breachComplaint: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'JhatkaComplaint',
        required: false,
        default: undefined,
      },
    },

    slot: {
      windowStart: { type: Date, required: false },
      windowEnd: { type: Date, required: false },
      arrivedAt: { type: Date, required: false },
      completedAt: { type: Date, required: false },
    },

    estimatedDistanceKm: { type: Number, required: false },
    actualDistanceKm: { type: Number, required: false },
    estimatedEta: { type: Date, required: false },
    actualEta: { type: Date, required: false },
    attempts: { type: Number, required: false, default: 1, min: 0 },
    maxAttempts: { type: Number, required: false, default: 2, min: 1 },
    failedAt: { type: Date, required: false },
    failureReason: {
      type: String,
      required: false,
      enum: [
        'customer_unavailable',
        'address_unreachable',
        'cod_not_paid',
        'refused_by_customer',
        'cold_chain_breach',
        'vehicle_failure',
        'other',
      ],
    },
    failureNote: { type: String, required: false, trim: true },
    proofOfDelivery: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaDeliveryPOD',
      required: false,
      default: undefined,
    },
    /**
     * Rider's settlement. BR-24: this is why drivers are never deleted.
     */
    codSettlement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaDeliverySettlement',
      required: false,
      default: undefined,
    },
    assignedAt: { type: Date, required: false },
    assignedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaDeliverySchema.plugin(toJSON);
jhatkaDeliverySchema.plugin(paginate);
jhatkaDeliverySchema.index({ deliveryNo: 1 }, { unique: true });
/** One delivery per order. Two deliveries means the customer got two orders. */
jhatkaDeliverySchema.index({ order: 1 }, { unique: true });
// The rider's run sheet.
jhatkaDeliverySchema.index({ driver: 1, status: 1, createdAt: -1 });
// The outlet's delivery board.
jhatkaDeliverySchema.index({ outlet: 1, status: 1, createdAt: -1 });
// The COD reconciliation console.
jhatkaDeliverySchema.index({ outlet: 1, codStatus: 1, codCollectedAt: 1 });
// The cold-chain report: deliveries that ran hot or breached transit.
jhatkaDeliverySchema.index({ outlet: 1, 'coldChain.breachDetectedAt': -1 });

jhatkaDeliverySchema.statics.STATUSES = DELIVERY_STATUSES;
jhatkaDeliverySchema.statics.DELIVERY_TRANSITIONS = DELIVERY_TRANSITIONS;
jhatkaDeliverySchema.statics.COD_STATUSES = COD_STATUSES;

/** May this delivery move from `from` to `to`? */
jhatkaDeliverySchema.statics.canTransition = function (from, to) {
  const allowed = DELIVERY_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * BR-12. May the rider pick this up?
 *
 * The dispatch guard, as one predicate. Blocking here rather than at dispatch
 * assignment is deliberate: the van is loaded, the rider is present, and reassigning
 * is a conversation rather than a database write.
 *
 * @returns {{ ok: boolean, reason: string|null }}
 */
jhatkaDeliverySchema.methods.canBePickedUp = function () {
  const cc = this.coldChain || {};

  if (
    typeof cc.transitMinutes === 'number' &&
    typeof cc.maxTransitMinutes === 'number' &&
    cc.transitMinutes > cc.maxTransitMinutes
  ) {
    return {
      ok: false,
      reason: `transit ${cc.transitMinutes}min exceeds the ${cc.maxTransitMinutes}min cold-chain limit — assign a closer rider or offer a later slot`,
    };
  }

  // A packing-time breach cannot be undone by a faster journey, so it blocks too.
  if (cc.packingTempC !== undefined && cc.packingAt && cc.breachDetectedAt) {
    return { ok: false, reason: `cold chain already breached at packing (${cc.packingTempC}°C)` };
  }

  return { ok: true, reason: null };
};

/**
 * Is this delivery COD?
 */
jhatkaDeliverySchema.methods.isCod = function () {
  return this.codStatus !== 'not_applicable';
};

/**
 * Does the collected amount match what the customer was told to pay?
 *
 * A mismatch is a reconciliation exception, not something to write off. This is
 * the check `reconcileCod` performs.
 */
jhatkaDeliverySchema.methods.codMatchesQuoted = function () {
  return Number(this.codCollectedAmount || 0) === Number(this.codCollectionAmount || 0);
};

/**
 * @typedef JhatkaDelivery
 */
const JhatkaDelivery = mongoose.model('JhatkaDelivery', jhatkaDeliverySchema);

module.exports = JhatkaDelivery;