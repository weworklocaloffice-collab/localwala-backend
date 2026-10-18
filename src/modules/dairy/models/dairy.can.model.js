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
 * DairyCan — a reusable milk can.
 *
 * Unlike food packaging, a can is a **custodied asset**. Once issued to a
 * customer it holds a refundable deposit and stays in that customer's doorway
 * until collected. Losing track of who holds which can is the single most common
 * failure mode in Indian dairy operations, so custody is a first-class field
 * rather than derived from order history.
 *
 * Movement history lives in `DairyCanLedger` (append-only). This document holds
 * only the current holder, which keeps reconciliation reads cheap.
 */
const dairyCanSchema = mongoose.Schema(
  {
      canCode: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        // A can code identifies a physical can. The scan services
        // (`issueCans`, `collectCans`, `applyScanBatch`) all look up `DairyCan`
        // by `canCode` alone with no business filter, so the database must
        // enforce global uniqueness — otherwise a duplicate code would make
        // those lookups hit two cans and debit the same deposit twice. The
        // comment below used to claim this was already the case while the
        // constraint had actually been dropped, which is what broke
        // verify.dairy.cans.js.
        unique: true,
      },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    canType: {
      type: String,
      required: false,
      default: 'standard', // standard, mini, bulk
    },
    capacityL: {
      type: Number,
      required: false,
      default: 1,
    },
    /**
     * Refundable deposit held while the can is with a customer. Stored in paise
     * via the platform money convention.
     *
     * NOTE: this setter takes RUPEES. Passing `5000` means ₹5,000, not ₹50.
     */
    depositAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    status: {
      type: String,
      required: false,
      default: 'in_store', // in_store, with_agent, with_customer, lost, damaged
    },
    currentHolder: {
      type: {
        type: String,
        enum: ['store', 'customer', 'agent', null],
        default: 'store',
      },
      ref: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
    },
    /**
     * Business the can belongs to when in_store. Kept separate from `business`
     * (the owning outlet) so a can can be flagged for return-to-depot without
     * reassigning ownership.
     */
    heldAt: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: false,
    },
    /**
     * Lifecycle state — orthogonal to `currentHolder`, which says WHO holds it.
     *
     * The two axes are independent on purpose. A can can be held by nobody and
     * still be `dirty` (back at the dairy, awaiting wash), and a can can be with
     * a customer and be `issued`. Conflating them was the original mistake.
     *
     * Full cycle, matching the dairy specification:
     *
     *   ready → issued → dirty → washing → washed → refilled → ready
     *                              └──────────→ quarantined → scrubbing/washing
     *   any → scrapped (end of life)
     *
     * The specification lists cleaning, inspection, refill and return-to-rotation
     * as distinct steps, so `washed`, `refilled` and `ready` are distinct states
     * rather than being collapsed together.
     */
    condition: {
      type: String,
      required: false,
      default: 'ready',
      enum: ['ready', 'issued', 'dirty', 'washing', 'washed', 'refilled', 'quarantined', 'scrapped'],
    },
    /**
     * Customer this can is reserved for under rotation. Set only while an active
     * `DairyContainerAssignment` holds it. This is what stops a can being issued
     * to a different customer.
     */
    assignedTo: {
      type: {
        type: String,
        enum: ['customer', null],
        default: null,
      },
      ref: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
    },
    /**
     * Identifies the rotation pair/group a can belongs to, so both bottles of a
     * customer can be selected together without joining through the assignment
     * on every read.
     */
    rotationGroup: {
      type: String,
      required: false,
    },
    issuedAt: {
      type: Date,
      required: false,
    },
    lastMovementAt: {
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
dairyCanSchema.plugin(toJSON);
dairyCanSchema.plugin(paginate);
// `unique: true` is declared on the field above; repeating it here makes Mongoose
// warn about a duplicate index on every boot.
dairyCanSchema.index({ business: 1, status: 1 });
dairyCanSchema.index({ 'currentHolder.type': 1, 'currentHolder.ref': 1 });
dairyCanSchema.index({ condition: 1, lastMovementAt: -1 });
// Rotation lookups: "which ready cans are reserved for nobody", "what does this
// customer hold".
dairyCanSchema.index({ 'assignedTo.type': 1, 'assignedTo.ref': 1, condition: 1 });
dairyCanSchema.index({ rotationGroup: 1 });

/**
 * @typedef DairyCan
 */
const DairyCan = mongoose.model('DairyCan', dairyCanSchema);

module.exports = DairyCan;