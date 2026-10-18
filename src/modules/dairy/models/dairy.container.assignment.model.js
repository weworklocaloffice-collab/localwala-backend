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
 * DairyContainerAssignment — a customer's dedicated set of reusable cans.
 *
 * This is what makes the **two-bottle rotation** model work. Without it, cans are
 * a fungible pool and any available can satisfies any order. Rotation requires
 * *identity continuity*: the customer's Bottle A must come back and that same A
 * goes out again, while B sits with them. Only an assignment can express that.
 *
 * Day 1  A → customer
 * Day 2  A ← customer,  B → customer
 * Day 3  B ← customer,  A → customer
 *
 * Applies ONLY to reusable-container recurring milk deliveries. Packaged dairy
 * (curd, ghee, butter, paneer, cheese, cream) has no assignment and no rotation —
 * see `DairySku.reusableContainer`.
 */
const dairyContainerAssignmentSchema = mongoose.Schema(
  {
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * The recurring plan this rotation serves. Set for subscription deliveries;
     * null for a customer enrolled in rotation without a plan.
     */
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySubscription',
      required: false,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /**
     * The dedicated cans. Two for the standard two-bottle model.
     */
    cans: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'DairyCan',
        required: false,
      },
    ],
    /**
     * 2 for two-bottle rotation. Larger values are legal (a 3-can cycle staggers
     * washing load) but anything below 2 breaks the model, because with one can
     * the customer must return it before the next can can be delivered.
     */
    rotationSize: {
      type: Number,
      required: false,
      default: 2,
      min: 2,
    },
    /**
     * Identifies the rotation pair. Mirrored onto each `DairyCan.rotationGroup`
     * so both bottles can be selected without joining through this document on
     * every read.
     */
    rotationGroup: {
      type: String,
      required: false,
    },
    /**
     * Which can is currently with the customer, so the next delivery knows what
     * to collect and which sibling to hand over.
     */
    activeCan: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyCan',
      required: false,
    },
    /**
     * Last delivery outcome, kept for dispute resolution when a customer claims
     * they returned a can that our ledger says they still hold.
     */
    lastSwappedAt: {
      type: Date,
      required: false,
    },
    lastCollectedCan: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyCan',
      required: false,
    },
    status: {
      type: String,
      required: false,
      default: 'active', // active, paused, released
    },
    releasedAt: {
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
dairyContainerAssignmentSchema.plugin(toJSON);
dairyContainerAssignmentSchema.plugin(paginate);
dairyContainerAssignmentSchema.index({ customer: 1, business: 1, status: 1 });
dairyContainerAssignmentSchema.index({ subscription: 1 });
dairyContainerAssignmentSchema.index({ cans: 1 });

/**
 * @typedef DairyContainerAssignment
 */
const DairyContainerAssignment = mongoose.model(
  'DairyContainerAssignment',
  dairyContainerAssignmentSchema
);

module.exports = DairyContainerAssignment;