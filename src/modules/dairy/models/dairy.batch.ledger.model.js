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
 * DairyBatchLedger — append-only record of every movement in and out of a batch.
 *
 * **Never updated.** Corrections are compensating entries. This is what makes
 * shrinkage auditable: when wastage looks high at month end, the full history of
 * who consumed what and who wrote off what is replayable.
 *
 * Litres are signed from the batch's perspective: positive adds to the batch,
 * negative removes.
 */
const dairyBatchLedgerSchema = mongoose.Schema(
  {
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyMilkBatch',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /**
     * created        — intake became stock
     * allocated      — reserved against an order
     * released       — an allocation was returned to the pool
     * consumed       — used (sale or processing)
     * shrinkage      — written off as spillage or processing loss
     * expired        — past expiry, removed from usable stock
     * transferred    — moved between storage tanks
     * adjusted       — manual correction
     */
    eventType: {
      type: String,
      required: true,
    },
    /** Signed litres. Negative for anything leaving the batch. */
    quantityL: {
      type: Number,
      required: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyOrder',
      required: false,
    },
    stop: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryStop',
      required: false,
    },
    /** Where a write-off went, for shrinkage reporting. */
    shrinkageReason: {
      type: String,
      required: false,
    },
    note: {
      type: String,
      required: false,
    },
    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyBatchLedgerSchema.plugin(toJSON);
dairyBatchLedgerSchema.plugin(paginate);
dairyBatchLedgerSchema.index({ batch: 1, createdAt: 1 });
dairyBatchLedgerSchema.index({ business: 1, eventType: 1, createdAt: -1 });
dairyBatchLedgerSchema.index({ order: 1 });

/**
 * @typedef DairyBatchLedger
 */
const DairyBatchLedger = mongoose.model('DairyBatchLedger', dairyBatchLedgerSchema);

module.exports = DairyBatchLedger;