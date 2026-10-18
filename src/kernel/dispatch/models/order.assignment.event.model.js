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
const { toJSON } = require('../../../models/plugins');

/**
 * OrderAssignmentEvent — the append-only audit trail for food rider assignment.
 *
 * ## Why this exists
 *
 * A disputed assignment ("why did rider X get my order instead of rider Y")
 * is currently unanswerable: `DriverNewOrderStatus` rows show *what* was
 * offered but not *who decided it* or *why the previous choice changed*.
 * `DispatchAttempt` records the engine's rungs but not the four manual paths
 * (Restaurant app, vendor web, admin, city-master) that still override it.
 *
 * This model is the one place every path writes: engine and human alike.
 * Rows are never updated or deleted — a correction is a new row — so the
 * history of an order reads as the sequence of events it was.
 *
 * ## The override rate is the engine's tuning signal
 *
 * Every manual selection after an engine broadcast is an `overridden` row.
 * `overridden / dispatched` per restaurant is the metric that says whether
 * the ranking is trusted: high means vendors keep second-guessing it, which
 * is where tuning effort goes. See `services/dispatch.metrics.service.js`.
 */
const orderAssignmentEventSchema = mongoose.Schema(
  {
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: true,
      index: true,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: false,
      default: null,
    },
    type: {
      type: String,
      required: true,
      // dispatched  a rung was broadcast (one row per rung)
      // offered     one rider received an offer (one row per rider)
      // accepted    a rider's accept claimed the order
      // rejected    a rider declined
      // expired     an offer's TTL ran out
      // escalated   the ladder moved to the next rung
      // overridden  a human replaced a live offer with their own choice
      // notfound    the ladder ran out with nobody assigned
      enum: ['dispatched', 'offered', 'accepted', 'rejected', 'expired', 'escalated', 'overridden', 'notfound'],
    },
    actorType: {
      type: String,
      required: false,
      default: 'system', // system | rider | vendor_app | vendor_web | admin | city_master
    },
    actor: {
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
    pool: {
      type: String,
      required: false,
      default: null, // own_fleet | platform
    },
    distance: {
      type: Number,
      required: false,
      default: null, // kilometres, snapshotted when known
    },
    round: {
      type: Number,
      required: false,
      default: null, // ladder rung, for engine-written rows
    },
    // Customer-side delivery zone (Batch A-4). Best-effort tag; null when
    // unresolvable. Powers the per-zone "what is happening" dashboard.
    zone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryZone',
      required: false,
      default: null,
    },
    zoneVersion: {
      type: Number,
      required: false,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { getters: true },
  }
);

orderAssignmentEventSchema.plugin(toJSON);
orderAssignmentEventSchema.index({ order: 1, createdAt: 1 });
orderAssignmentEventSchema.index({ restaurant: 1, type: 1, createdAt: -1 });

/**
 * @typedef OrderAssignmentEvent
 */
const OrderAssignmentEvent = mongoose.model('OrderAssignmentEvent', orderAssignmentEventSchema);

module.exports = OrderAssignmentEvent;
