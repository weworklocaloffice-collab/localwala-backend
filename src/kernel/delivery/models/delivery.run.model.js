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
 * DeliveryRun — one rider's assigned route for one service date.
 *
 * This is the concept the platform does not currently have. Delivery today is
 * one driver per order (see `services/orders.service.js`); a dairy route needs
 * one rider across many customers, so `DeliveryRun` is new to the platform and
 * built vertical-agnostic so grocery and pharmacy can adopt it later.
 *
 * `pickup` and `returnLeg` are legs on the run rather than stops, matching the
 * specified flow (Route → Pickup → Customer Delivery → Completed) without
 * polluting the rider's stop list.
 */
const deliveryRunSchema = mongoose.Schema(
  {
    runNo: {
      type: Number,
      required: true,
    },
    vertical: {
      type: String,
      required: true,
      default: 'dairy',
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    serviceDate: {
      type: Date,
      required: true,
    },
    /**
     * The assigned rider. Set for both own-fleet and platform-pool agents; the
     * two are distinguished by `agentMode`.
     */
    agent: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyDriver',
      required: false,
    },
    agentMode: {
      type: String,
      required: false,
      default: 'platform_pool', // own_fleet, platform_pool
    },
    slot: {
      startTime: {
        type: String,
        required: false,
      },
      endTime: {
        type: String,
        required: false,
      },
    },
    status: {
      type: String,
      required: false,
      default: 'planned', // planned, dispatched, in_progress, completed, cancelled
    },
    /**
     * Denormalised so the rider manifest renders without aggregating stops on
     * every pull, which matters on a low-coverage route.
     */
    totals: {
      stopCount: {
        type: Number,
        required: false,
        default: 0,
      },
      orderCount: {
        type: Number,
        required: false,
        default: 0,
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
      amountToCollect: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
    },
    route: {
      polyline: {
        type: [Number],
        required: false,
      },
      distanceKm: {
        type: Number,
        required: false,
        default: 0,
      },
      sequence: {
        type: [Number],
        required: false,
      },
    },
    /**
     * Depot leg. `cansLoaded` is what the rider takes out for issue;
     * `cansLoadedForReturn` is the empty cans taken out to collect back.
     */
    pickup: {
      completedAt: {
        type: Date,
        required: false,
      },
      location: {
        type: String,
        required: false,
      },
      cansLoaded: {
        type: Number,
        required: false,
        default: 0,
      },
      cansLoadedForReturn: {
        type: Number,
        required: false,
        default: 0,
      },
    },
    /**
     * Depot return leg and the reconciliation verdict.
     *
     * `variance = cansReturned - (cansLoaded - cansIssued)`. A non-zero variance
     * requires `adjustmentReason`; the shift cannot otherwise be closed.
     */
    returnLeg: {
      completedAt: {
        type: Date,
        required: false,
      },
      cansReturned: {
        type: Number,
        required: false,
        default: 0,
      },
      variance: {
        type: Number,
        required: false,
        default: 0,
      },
      adjustmentReason: {
        type: String,
        required: false,
      },
    },
    startedAt: {
      type: Date,
      required: false,
    },
    endedAt: {
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
deliveryRunSchema.plugin(toJSON);
deliveryRunSchema.plugin(paginate);
deliveryRunSchema.index({ business: 1, serviceDate: 1 });
deliveryRunSchema.index({ agent: 1, serviceDate: 1 });
deliveryRunSchema.index({ status: 1, serviceDate: -1 });
deliveryRunSchema.index({ vertical: 1, status: 1 });
deliveryRunSchema.index({ runNo: 1 }, { unique: true });

/**
 * @typedef DeliveryRun
 */
const DeliveryRun = mongoose.model('DeliveryRun', deliveryRunSchema);

module.exports = DeliveryRun;