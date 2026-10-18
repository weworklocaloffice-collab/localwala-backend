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
 * DeliveryPOD — proof of delivery for one stop.
 *
 * Kept as its own collection rather than embedded on `DeliveryStop` because the
 * rider captures proof while offline and uploads in a queue on reconnect.
 * Rewriting a large stop document on every sync would fight the outbox in
 * `DairyPartner_app` for writes.
 *
 * `clientRef` carries the same idempotency key as the can-scan outbox so a
 * retried upload cannot create duplicate proof records.
 */
const deliveryPodSchema = mongoose.Schema(
  {
    stop: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryStop',
      required: true,
    },
    run: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryRun',
      required: true,
    },
    clientRef: {
      type: String,
      required: false,
    },
    photo: {
      type: String,
      required: false,
    },
    signature: {
      type: String,
      required: false,
    },
    /** No nested Point default — see the note on `DeliveryStop.location`. */
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
    note: {
      type: String,
      required: false,
    },
    capturedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    capturedAt: {
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
deliveryPodSchema.plugin(toJSON);
deliveryPodSchema.plugin(paginate);
deliveryPodSchema.index({ location: '2dsphere' });
deliveryPodSchema.index({ stop: 1 });
deliveryPodSchema.index({ clientRef: 1 }, { unique: true, sparse: true });

/**
 * @typedef DeliveryPOD
 */
const DeliveryPOD = mongoose.model('DeliveryPOD', deliveryPodSchema);

module.exports = DeliveryPOD;