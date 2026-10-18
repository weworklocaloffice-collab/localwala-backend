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
 * DairyCanLedger — append-only record of every can movement.
 *
 * **Never updated.** Corrections are new compensating entries. This is what
 * makes reconciliation auditable: an admin can always answer "who held can
 * C-1042 on 12 March" by replaying the log.
 *
 * `clientRef` is the idempotency key. The rider captures scans while offline in
 * `DairyPartner_app/lib/app/core/services/offline_can_scan_queue.dart` and
 * replays them on reconnect, so the same movement can be submitted more than
 * once. Without a unique index here a retry would double-count a can and the
 * depot gate would never balance.
 */
const dairyCanLedgerSchema = mongoose.Schema(
  {
    can: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyCan',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /**
     * Two families of event.
     *
     * **Custody** — who holds the can:
     *   pickup           — sealed can loaded at the depot onto the rider's crate
     *   issue            — handed to a customer at a stop
     *   collect          — empty can taken off a customer at a stop
     *   return_to_store  — brought back to the depot at end of run
     *   lost             — written off
     *
     * **Lifecycle** — what stage the can is in, for the two-bottle rotation
     * model. These do NOT change custody:
     *   assigned         — reserved to a customer under rotation
     *   released         — reservation ended
     *   swapped          — rotation handed over the sibling can
     *   sent_to_wash     — returned can entered the wash line
     *   washed           — completed the wash
     *   inspected_ok     — passed QA, refillable
     *   inspected_fail   — quarantined, must never be issued
     *   refilled         — refilled and returned to service
     *   scrapped         — end of life
     */
    eventType: {
      type: String,
      required: true,
      enum: [
        'pickup',
        'issue',
        'collect',
        'return_to_store',
        'lost',
        'assigned',
        'released',
        'swapped',
        'sent_to_wash',
        'washed',
        'inspected_ok',
        'inspected_fail',
        'refilled',
        'scrapped',
        // Deposit movements, recorded against the same can for a single audit
        // trail rather than a parallel one.
        'deposit_held',
        'deposit_released',
        'deposit_adjusted',
      ],
    },
    clientRef: {
      type: String,
      required: false,
    },
    run: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryRun',
      required: false,
    },
    stop: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryStop',
      required: false,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyOrder',
      required: false,
    },
    agent: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    /**
     * Previous holder type, so a single ledger row is self-describing when the
     * log is replayed rather than read alongside `DairyCan`.
     */
    fromHolder: {
      type: String,
      required: false,
    },
    toHolder: {
      type: String,
      required: false,
    },
    /**
     * Signed deposit movement for this event, in paise.
     * `deposit_held` is positive (customer owes), `deposit_released` negative.
     */
    amount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
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
dairyCanLedgerSchema.plugin(toJSON);
dairyCanLedgerSchema.plugin(paginate);
// Idempotency for offline replay. Sparse so admin entries need no clientRef.
dairyCanLedgerSchema.index({ clientRef: 1 }, { unique: true, sparse: true });
dairyCanLedgerSchema.index({ can: 1, createdAt: -1 });
dairyCanLedgerSchema.index({ run: 1, eventType: 1 });
dairyCanLedgerSchema.index({ customer: 1, createdAt: -1 });
dairyCanLedgerSchema.index({ business: 1, createdAt: -1 });

/**
 * @typedef DairyCanLedger
 */
const DairyCanLedger = mongoose.model('DairyCanLedger', dairyCanLedgerSchema);

module.exports = DairyCanLedger;