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
 * JhatkaInventoryMovement — the append-only ledger for the `JhatkaInventoryItem`
 * counters.
 *
 * ## Two ledgers, not one, and this is deliberate
 *
 * `JhatkaBatchAllocation` traces batches. This traces *outlet inventory rows*, of
 * which packaging has no batch at all — a bag has no supplier, no FEFO order and
 * no recall. Folding packaging into the batch ledger would mean either giving
 * packaging a meaningless batch or leaving it untraced.
 *
 * So: batch ledger for anything with a batch, this ledger for the row-level
 * counters including packaging. Both are append-only. Both carry `onHandAfter` /
 * `reservedAfter` so a disputed count is answerable by replay.
 *
 * ## Blueprint §23's ten types, plus the six fresh meat actually needs
 *
 * The blueprint lists PURCHASE, RECEIPT, QUALITY_REJECTION, STOCK_IN,
 * ORDER_RESERVATION, ORDER_CONSUMPTION, ADJUSTMENT, WASTAGE, RETURN, TRANSFER.
 * Those ten are all here. Six more are added because fresh meat requires them:
 *
 *   YIELD_SPLIT            raw becoming prepared and trim (BR-11)
 *   RESERVATION_RELEASE    a reservation released when an order was cancelled
 *   RECALL_FREEZE          quarantined without the stock moving (§5.4)
 *   EXPIRY_WRITE_OFF       a batch that was FEFO-skipped and then zeroed
 *   COUNT_ADJUSTMENT       a stocktake correction, distinguished from ADJUSTMENT
 *   SUBSTITUTION           a customer accepted different stock
 */
const MOVEMENT_TYPES = [
  'PURCHASE',
  'RECEIPT',
  'QUALITY_REJECTION',
  'STOCK_IN',
  'ORDER_RESERVATION',
  'ORDER_CONSUMPTION',
  'ADJUSTMENT',
  'COUNT_ADJUSTMENT',
  'WASTAGE',
  'RETURN',
  'TRANSFER',
  'YIELD_SPLIT',
  'RESERVATION_RELEASE',
  'RECALL_FREEZE',
  'EXPIRY_WRITE_OFF',
  'SUBSTITUTION',
];

/** Which counter each type moves, and in which direction. Drives validation. */
const MOVEMENT_EFFECT = {
  PURCHASE: { onHand: 1, reserved: 0 },
  RECEIPT: { onHand: 1, reserved: 0 },
  QUALITY_REJECTION: { onHand: -1, reserved: 0 },
  STOCK_IN: { onHand: 1, reserved: 0 },
  ORDER_RESERVATION: { onHand: 0, reserved: 1 },
  RESERVATION_RELEASE: { onHand: 0, reserved: -1 },
  ORDER_CONSUMPTION: { onHand: -1, reserved: -1 },
  ADJUSTMENT: { onHand: 1, reserved: 0 },
  COUNT_ADJUSTMENT: { onHand: 1, reserved: 0 },
  WASTAGE: { onHand: -1, reserved: 0 },
  RETURN: { onHand: 1, reserved: 0 },
  TRANSFER: { onHand: 1, reserved: 0 },
  YIELD_SPLIT: { onHand: 1, reserved: 0 },
  RECALL_FREEZE: { onHand: 0, reserved: 0 },
  EXPIRY_WRITE_OFF: { onHand: -1, reserved: 0 },
  SUBSTITUTION: { onHand: 0, reserved: -1 },
};

const jhatkaInventoryMovementSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    inventoryItem: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaInventoryItem',
      required: true,
    },
    kind: {
      type: String,
      required: true,
      enum: ['raw', 'prepared', 'packaging'],
    },
    movementType: {
      type: String,
      required: true,
      enum: MOVEMENT_TYPES,
    },
    /** Signed. Negative leaves the row. Integer. Never a money field. */
    qtyDelta: {
      type: Number,
      required: true,
    },
    reservedDelta: {
      type: Number,
      required: false,
      default: 0,
    },
    /** The counters immediately after this entry, so a replay can reconstruct. */
    onHandAfter: {
      type: Number,
      required: true,
    },
    reservedAfter: {
      type: Number,
      required: true,
    },
    /**
     * `onHandAfter - reservedAfter - quarantinedAfter`. Stored for the same reason
     * `availableQty` is stored on the item: FEFO and `findLowStock` filter on it
     * in an indexed comparison.
     */
    availableAfter: {
      type: Number,
      required: false,
    },
    reason: {
      type: String,
      required: false,
      trim: true,
    },
    referenceType: {
      type: String,
      required: false,
      trim: true,
    },
    referenceId: {
      type: mongoose.SchemaTypes.ObjectId,
      required: false,
      default: undefined,
    },
    /**
     * Monotonic per-outlet counter copied from the item, so two movements can be
     * ordered against a known state when a concurrent write is investigated.
     */
    movementSeq: {
      type: Number,
      required: true,
    },
    performedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    performedByName: {
      type: String,
      required: false,
      trim: true,
    },
    notes: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaInventoryMovementSchema.plugin(toJSON);
jhatkaInventoryMovementSchema.plugin(paginate);
// The item's history panel.
jhatkaInventoryMovementSchema.index({ inventoryItem: 1, createdAt: -1 });
// Replay for a disputed count: every movement for one outlet in order.
jhatkaInventoryMovementSchema.index({ outlet: 1, movementSeq: 1 });
// Wastage and shrinkage reports.
jhatkaInventoryMovementSchema.index({ outlet: 1, movementType: 1, createdAt: -1 });
// The reference-based reverse lookup, mirroring the batch ledger's.
jhatkaInventoryMovementSchema.index({ referenceType: 1, referenceId: 1 });
// BR-19: no movement may be deleted or silently edited. Asserted in the verify
// suite by confirming there is no `updatedAt`-based update path in the service.

/**
 * Does this movement type move `onHand`? Used by the service to reject a
 * movement whose `qtyDelta` does not match its declared effect.
 */
jhatkaInventoryMovementSchema.statics.effectOf = function (movementType) {
  return MOVEMENT_EFFECT[movementType] || null;
};

/**
 * @typedef JhatkaInventoryMovement
 */
const JhatkaInventoryMovement = mongoose.model(
  'JhatkaInventoryMovement',
  jhatkaInventoryMovementSchema
);

JhatkaInventoryMovement.MOVEMENT_TYPES = MOVEMENT_TYPES;
JhatkaInventoryMovement.MOVEMENT_EFFECT = MOVEMENT_EFFECT;

module.exports = JhatkaInventoryMovement;