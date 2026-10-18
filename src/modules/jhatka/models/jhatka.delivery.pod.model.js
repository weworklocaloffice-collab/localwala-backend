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
 * JhatkaDeliveryPOD — proof of delivery, with the cold-chain reading.
 *
 * ## `clientRef` is the offline idempotency key
 *
 * Copied verbatim from `kernel/delivery/DeliveryPOD`, which uses it for the same
 * purpose: *"clientRef carries the same idempotency key as the can-scan outbox so a
 * rider's queued stop survives a flaky connection."*
 *
 * A rider in a basement with no signal takes the photo, it queues locally, and the
 * upload lands whenever it can — possibly twice if the app retries. `clientRef`
 * UNIQUE SPARSE means the second attempt collides and is ignored rather than
 * creating a second proof against the same delivery.
 *
 * ## `deliveredTempC` is the reason this is not `DeliveryPOD`
 *
 * The kernel POD records photo, signature, location and note. It has no
 * temperature, because milk is not temperature-sensitive in the same way that a
 * 1 kg pack of chicken curry cut is. BR-12 requires the delivery-time reading, and
 * a post-delivery breach must raise a complaint automatically — the customer should
 * not have to report that the chicken arrived warm.
 */
const jhatkaDeliveryPODSchema = mongoose.Schema(
  {
    delivery: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaDelivery',
      required: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: true,
    },
    /**
     * The rider's client-generated idempotency key.
     *
     * SPARSE and UNIQUE. Sparse because not every POD has one — a web-recorded
     * delivery has no client outbox — and a non-sparse unique index would reject
     * every such record as a duplicate null.
     */
    clientRef: {
      type: String,
      required: false,
      trim: true,
    },
    photo: { type: String, required: false },
    signature: { type: String, required: false },
    /** No nested `default: 'Point'` — see the platform-wide geometry convention. */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: { type: [Number], required: false },
    },
    /**
     * BR-12. The cold-chain reading at the door.
     *
     * Compared against `JhatkaOutlet.qualityPolicy.maxStorageTemperatureC`. A
     * breach here raises a `JhatkaComplaint` automatically.
     */
    deliveredTempC: { type: Number, required: false },
    /** The band it was judged against, frozen so the judgement is auditable. */
    maxTempC: { type: Number, required: false },
    coldChainBreached: {
      type: Boolean,
      required: false,
      default: false,
    },
    /** Set by the service when a breach raises a complaint. BR-12. */
    complaint: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaComplaint',
      required: false,
      default: undefined,
    },
    /**
     * COD collected, duplicated here so the proof carries the money claim. The
     * delivery remains authoritative; this is what the rider photographed.
     */
    codCollected: moneyField(0),
    codReceiptPhoto: { type: String, required: false },
    /** Customer OTP confirming receipt, where the flow requires it. */
    otp: { type: String, required: false },
    receiverName: { type: String, required: false, trim: true },
    note: { type: String, required: false, trim: true },
    capturedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    capturedByName: { type: String, required: false, trim: true },
    capturedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaDeliveryPODSchema.plugin(toJSON);
jhatkaDeliveryPODSchema.plugin(paginate);
/**
 * THE OFFLINE IDEMPOTENCY ANCHOR.
 *
 * UNIQUE + SPARSE, copied from `kernel/delivery/DeliveryPOD`'s
 * `{clientRef: 1}, {unique: true, sparse: true}`. A rider's queued upload that
 * arrives twice collides here and is ignored.
 */
jhatkaDeliveryPODSchema.index({ clientRef: 1 }, { unique: true, sparse: true });
/** One proof per delivery. Two proofs means two claims against one order. */
jhatkaDeliveryPODSchema.index({ delivery: 1 }, { unique: true });
// The cold-chain report: deliveries that arrived warm.
jhatkaDeliveryPODSchema.index({ coldChainBreached: 1, capturedAt: -1 });
// "Every POD for this order" — a support query.
jhatkaDeliveryPODSchema.index({ order: 1 });

/**
 * Did this delivery arrive inside the cold chain?
 *
 * Returns an object rather than a boolean because a caller needs to know WHY, and
 * "no temperature recorded" is materially different from "recorded and fine" — one
 * is compliance, the other is an unmeasured delivery.
 *
 * @returns {{ breached: boolean, unmeasured: boolean, reason: string }}
 */
jhatkaDeliveryPODSchema.methods.assessColdChain = function () {
  if (this.deliveredTempC === undefined || this.deliveredTempC === null) {
    return { breached: false, unmeasured: true, reason: 'no temperature recorded at delivery' };
  }
  const max = this.maxTempC ?? 4;
  const breached = this.deliveredTempC > max;
  return {
    breached,
    unmeasured: false,
    reason: breached
      ? `delivered at ${this.deliveredTempC}°C, above the ${max}°C limit`
      : `delivered at ${this.deliveredTempC}°C, within the ${max}°C limit`,
  };
};

/**
 * @typedef JhatkaDeliveryPOD
 */
const JhatkaDeliveryPOD = mongoose.model('JhatkaDeliveryPOD', jhatkaDeliveryPODSchema);

module.exports = JhatkaDeliveryPOD;