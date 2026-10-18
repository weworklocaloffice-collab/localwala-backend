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
 * DairyMilkBatch — accepted raw milk, ready for processing or sale.
 *
 * Created only from an **accepted** `DairyMilkCollection`. This is the guarantee
 * that makes batch quantities trustworthy: rejected milk never becomes stock.
 *
 * Consumed **FEFO** — First Expiry, First Out. Raw milk is perishable, so the
 * oldest batch must go out first regardless of which batch a given order would
 * nominally draw from. See `dairy.procurement.service.allocateByFEFO`.
 */
const dairyMilkBatchSchema = mongoose.Schema(
  {
    batchNo: {
      type: Number,
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    provider: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyMilkProvider',
      required: true,
    },
    /**
     * The intake this batch came from. One collection yields at most one batch.
     *
     * Named `sourceCollection` rather than `collection` because `collection` is a
     * reserved Mongoose schema pathname and triggers a warning on every model
     * load.
     */
    sourceCollection: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyMilkCollection',
      required: true,
    },
    /** Litres received. */
    quantityL: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Litres still available. Drives every allocation decision. */
    availableQtyL: {
      type: Number,
      required: false,
      default: 0,
    },
    /** Cumulative litres consumed. Denormalised for reporting. */
    consumedQtyL: {
      type: Number,
      required: false,
      default: 0,
    },
    /**
     * Cumulative litres written off as spillage, curdling or processing loss.
     * Tracked separately from consumption so wastage is visible rather than
     * silently absorbed into shrinkage.
     */
    shrinkageL: {
      type: Number,
      required: false,
      default: 0,
    },
    fat: {
      type: Number,
      required: true,
    },
    snf: {
      type: Number,
      required: true,
    },
    collectedAt: {
      type: Date,
      required: true,
    },
    /** FEFO anchor. Derived from `collectedAt` plus the business shelf life. */
    expiry: {
      type: Date,
      required: true,
    },
    /**
     * Storage location — a chilling tank or a numbered can at the unit. Milk from
     * different collections must not share a tank if their test results differ.
     */
    storageTank: {
      type: String,
      required: false,
      trim: true,
    },
    /** source   — collected milk
     *  blended  — two or more lots mixed in a tank
     *  opened   — tank opened for processing
     *  consumed — fully used
     *  expired  — past expiry, unusable
     *  discarded — written off */
    status: {
      type: String,
      required: false,
      default: 'source',
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json.
// No `slugGenerator`: batches are identified by `batchNo`, not a slug, and the
// plugin dereferences `schema.tree.slug.source` — which throws when no slug field
// exists.
dairyMilkBatchSchema.plugin(toJSON);
dairyMilkBatchSchema.plugin(paginate);
dairyMilkBatchSchema.index({ batchNo: 1 }, { unique: true });
// The FEFO query: earliest expiry first, only what is still available.
dairyMilkBatchSchema.index({ business: 1, status: 1, expiry: 1, availableQtyL: 1 });
dairyMilkBatchSchema.index({ provider: 1, collectedAt: -1 });
dairyMilkBatchSchema.index({ sourceCollection: 1 });

/**
 * Litres still usable right now.
 *
 * @param {Date} [now]
 * @returns {number}
 */
dairyMilkBatchSchema.methods.usableQtyL = function usableQtyL(now) {
  const at = now || new Date();
  if (this.status !== 'source' && this.status !== 'blended') return 0;
  if (this.expiry <= at) return 0;
  return this.availableQtyL;
};

/**
 * @typedef DairyMilkBatch
 */
const DairyMilkBatch = mongoose.model('DairyMilkBatch', dairyMilkBatchSchema);

module.exports = DairyMilkBatch;