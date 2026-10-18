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
 * DairyMilkCollection — one intake event from a provider.
 *
 * Every collection records the full quality picture at the moment of intake,
 * because that record is what a provider dispute is settled against. Fat and SNF
 * measured at intake is the only figure that matters; re-measuring later proves
 * nothing.
 *
 * Only an **accepted** collection becomes a `DairyMilkBatch`. Rejected milk never
 * enters stock, which is what keeps batch quantities trustworthy.
 */
const dairyMilkCollectionSchema = mongoose.Schema(
  {
    collectionNo: {
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
    quantityL: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Milk fat percentage, measured at intake. */
    fat: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Solids Not Fat percentage — the protein/sugar fraction, and the main quality driver. */
    snf: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Intake temperature in °C. Above the configured limit means unrefrigerated too long. */
    temperature: {
      type: Number,
      required: false,
    },
    /** Percentage of fat and SNF, for reference at payout time. */
    fatSnfPercentage: {
      type: Number,
      required: false,
    },
    /**
     * Duplicated from the provider at intake so a later rate change does not
     * retroactively alter what this delivery was worth.
     */
    ratePerLitre: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    amount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    collectedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    /** Who weighed and recorded the intake. */
    recordedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    /** Machine or device reading, when the dairy unit has one. */
    deviceId: {
      type: String,
      required: false,
    },
    /**
     * pending  — awaiting a QC decision
     * accepted — passed QC and became a batch
     * rejected — failed QC, never enters stock
     */
    qualityStatus: {
      type: String,
      required: false,
      default: 'pending',
    },
    /**
     * Why QC passed or failed, in words. Populated automatically for a hard
     * reject and by the operator for a judgement call.
     */
    qualityNotes: {
      type: String,
      required: false,
    },
    rejectionReason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyMilkRejectionReason',
      required: false,
    },
    rejectedAt: {
      type: Date,
      required: false,
    },
    /** Set once accepted milk has been turned into a batch. */
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyMilkBatch',
      required: false,
    },
    /** Payable state, settled per collection. */
    payableStatus: {
      type: String,
      required: false,
      default: 'pending', // pending, approved, paid, disputed
    },
    payableSettledAt: {
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
dairyMilkCollectionSchema.plugin(toJSON);
dairyMilkCollectionSchema.plugin(paginate);
dairyMilkCollectionSchema.index({ collectionNo: 1 }, { unique: true });
// The procurement officer's working queue.
dairyMilkCollectionSchema.index({ business: 1, qualityStatus: 1, collectedAt: -1 });
dairyMilkCollectionSchema.index({ provider: 1, collectedAt: -1 });
dairyMilkCollectionSchema.index({ payableStatus: 1, collectedAt: -1 });

/**
 * @typedef DairyMilkCollection
 */
const DairyMilkCollection = mongoose.model('DairyMilkCollection', dairyMilkCollectionSchema);

module.exports = DairyMilkCollection;