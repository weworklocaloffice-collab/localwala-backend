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

/**
 * DeliveryStop — one customer drop on a run.
 *
 * Either `order` (a one-time purchase) or `subscription` (a recurring
 * occurrence) is set, never both. A stop is 1:1 with a delivery, which is why
 * no separate `DeliveryTask` model exists.
 *
 * `cansOut` is what the rider hands over; `cansIn` is the empty cans collected
 * back on the same visit. Both feed the depot reconciliation on `DeliveryRun`.
 */
const deliveryStopSchema = mongoose.Schema(
  {
    run: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryRun',
      required: true,
    },
    sequence: {
      type: Number,
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },
    /**
     * Snapshotted address text. A delivery that has already been routed must
     * not change because the customer later edits their saved address.
     */
    addressRaw: {
      type: String,
      required: false,
    },
    receiverName: {
      type: String,
      required: false,
    },
    receiverContact: {
      type: Number,
      required: false,
    },
    /**
 * Deliberately has NO nested `default: 'Point'`.
     *
     * A nested default would materialise `{ type: 'Point' }` with no
     * `coordinates` on every stop lacking GPS, and a 2dsphere index rejects a
     * malformed point outright: "Can't extract geo keys ... Point must be an
     * array or object, instead got type missing". Most manual and COD stops
     * have no coordinates, so the field must stay genuinely absent instead.
     * MongoDB skips documents with the field missing from a 2dsphere index.
     */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: false,
      },
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyOrder',
      required: false,
    },
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySubscription',
      required: false,
    },
    /**
     * Fresh milk is delivered inside a hard morning window. Unlike food, a late
     * delivery is a spoiled product rather than a late order.
     */
    slot: {
      windowStart: {
        type: String,
        required: false,
      },
      windowEnd: {
        type: String,
        required: false,
      },
      arrivedAt: {
        type: Date,
        required: false,
      },
      completedAt: {
        type: Date,
        required: false,
      },
    },
    cansOut: {
      type: Number,
      required: false,
      default: 0,
    },
    cansIn: {
      type: Number,
      required: false,
      default: 0,
    },
    amountDue: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    amountCollected: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    paymentMode: {
      type: String,
      required: false,
      default: 'cod', // prepaid, cod
    },
    status: {
      type: String,
      required: false,
      default: 'pending', // pending, arrived, delivered, skipped, failed
    },
    skipReason: {
      type: String,
      required: false,
    },
    /**
     * Non-zero only when the rider explicitly overrides the reconciliation
     * arithmetic, which requires a reason at run close.
     */
    varianceOverride: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
deliveryStopSchema.plugin(toJSON);
deliveryStopSchema.plugin(paginate);
deliveryStopSchema.index({ location: '2dsphere' });
deliveryStopSchema.index({ run: 1, sequence: 1 });
deliveryStopSchema.index({ customer: 1, createdAt: -1 });
deliveryStopSchema.index({ status: 1, 'slot.windowStart': 1 });

/**
 * @typedef DeliveryStop
 */
const DeliveryStop = mongoose.model('DeliveryStop', deliveryStopSchema);

module.exports = DeliveryStop;