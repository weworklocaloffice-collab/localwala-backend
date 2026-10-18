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
 * DairyOrderStatusHistory — append-only order timeline.
 *
 * Append-only for the same reason as `DairyCanLedger` and
 * `DairySubscriptionEvent`: milk orders are perishable and disputes are about
 * *when* something happened, which a mutable `status` field cannot answer. It also
 * records the rider's own notes, which is often the only record of why a
 * delivery failed.
 */
const dairyOrderStatusHistorySchema = mongoose.Schema(
  {
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyOrder',
      required: true,
    },
    fromStatus: {
      type: String,
      required: false,
    },
    toStatus: {
      type: String,
      required: true,
    },
    /** partner | customer | driver | admin | system */
    actorType: {
      type: String,
      required: false,
      default: 'system',
    },
    actor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    reason: {
      type: String,
      required: false,
    },
    note: {
      type: String,
      required: false,
    },
    /**
     * GPS at the time of the transition, so a delivered order carries proof of
     * where it happened.
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
    proof: {
      photo: {
        type: String,
        required: false,
      },
      signature: {
        type: String,
        required: false,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyOrderStatusHistorySchema.plugin(toJSON);
dairyOrderStatusHistorySchema.plugin(paginate);
dairyOrderStatusHistorySchema.index({ order: 1, createdAt: 1 });
dairyOrderStatusHistorySchema.index({ toStatus: 1, createdAt: -1 });

/**
 * @typedef DairyOrderStatusHistory
 */
const DairyOrderStatusHistory = mongoose.model(
  'DairyOrderStatusHistory',
  dairyOrderStatusHistorySchema
);

module.exports = DairyOrderStatusHistory;