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
const { toJSON } = require('./plugins');

/**
 * DeliveryZoneHistory — append-only snapshot of every zone publish.
 *
 * Written on create, full-replace publish, surgical move and retire. A row is
 * never updated or deleted: the history of a zone reads as the sequence of
 * versions it was. Disputes ("who moved Kompally out of Northgate, and when")
 * and week-over-week metrics both answer from here.
 */
const deliveryZoneHistorySchema = mongoose.Schema(
  {
    zone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryZone',
      required: true,
      index: true,
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },
    version: {
      type: Number,
      required: true,
    },
    name: {
      type: String,
      required: false,
      default: '',
    },
    localities: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Locality' }],
      default: [],
    },
    // created | republished | moved_in | moved_out | renamed | retired
    change: {
      type: String,
      required: false,
      default: 'republished',
    },
    updatedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    reason: {
      type: String,
      required: false,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

deliveryZoneHistorySchema.plugin(toJSON);
deliveryZoneHistorySchema.index({ zone: 1, version: 1 });

/**
 * @typedef DeliveryZoneHistory
 */
const DeliveryZoneHistory = mongoose.model('DeliveryZoneHistory', deliveryZoneHistorySchema);

module.exports = DeliveryZoneHistory;
