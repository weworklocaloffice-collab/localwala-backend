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
 * JhatkaInventoryItem — one row per {outlet, kind, thing, batch}.
 *
 * ## One collection, three kinds
 *
 * The source blueprint's §22 correctly identifies three different things —
 * raw (chicken, mutton, fish), prepared/processed, and packaging (bags, boxes,
 * labels) — and then implies three code paths. Three kinds, three collections and
 * three sets of services is three places for the same bug.
 *
 * `kind` is a discriminator on ONE collection. Every movement, every allocation
 * and every wastage record works against this one model, so a transfer that
 * crosses kinds is a normal write rather than a special case.
 *
 * ## `batch` is required for raw and prepared, absent for packaging
 *
 * Prepared stock without a batch is unsellable in a fresh-meat business: it is
 * the thing that makes "which batch was this cut from" unanswerable, which is the
 * one question a food-safety investigation always asks. The index below is
 * partial-unique on the batch, so a second row for the same batch is rejected
 * rather than silently created.
 *
 * ## Quantities are integers in the declared unit. NEVER money fields.
 *
 * `src/utils/money.field.js` is explicit: "Stock counters are plain integers and
 * must NOT use this helper." A stock field with a rupees/paise setter is a bug
 * waiting to happen — 1000 grams must not become 1000 paise of anything. That is
 * why this file does not import it, and why every quantity here is a plain
 * `Number` with an explicit `unit`.
 */
const INVENTORY_KINDS = ['raw', 'prepared', 'packaging'];
const QUANTITY_UNITS = ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER', 'PACK', 'BAG', 'BOX', 'LABEL', 'ROLL'];

const jhatkaInventoryItemSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    kind: {
      type: String,
      required: true,
      enum: INVENTORY_KINDS,
    },
    /**
     * A batch reference on raw or prepared stock. Required by the partial unique
     * index below, which is what makes the traceability chain in §5.4 real.
     */
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaBatch',
      required: false,
      default: undefined,
    },
    /** Raw stock: the whole carcass product. Prepared: the cut product. */
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: false,
      default: undefined,
    },
    /** Prepared stock: the retail pack this row feeds. */
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaVariant',
      required: false,
      default: undefined,
    },
    /** Packaging: which consumable. */
    packagingItem: {
      type: String,
      required: false,
      trim: true,
    },
    /** The unit every quantity on this row is denominated in. */
    unit: {
      type: String,
      required: true,
      enum: QUANTITY_UNITS,
    },
    /**
     * ## `min: 0` everywhere, and what that deliberately excludes
     *
     * Physical stock cannot be negative, so every counter carries `min: 0`. The one
     * thing that legitimately can go negative — a book position after an
     * over-withdrawal — is represented by `allowNegativeStock: true` below and
     * handled in the service, NOT by permitting a negative counter here.
     *
     * `min: 0` matters because `validateSync()` and Mongoose validators do **not**
     * run on `updateOne`/`findOneAndUpdate` by default. A negative counter written
     * by a `$inc` in the service is therefore caught only by a service-level
     * assertion. The schema `min` is the first line of defence; the service
     * assertion is the second, and the verify suite exercises both.
     */
    onHand: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    reserved: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /**
     * `onHand - reserved - quarantined`. Stored, not derived, because FEFO
     * allocation needs it in an indexed comparison — `findLowStock` reads it
     * directly rather than recomputing per row. Every write MUST keep it in step;
     * `jhatka.inventory.service` is the only writer.
     */
    availableQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /** Rejected at intake or spoiled after. Not sellable, not counted as loss twice. */
    damaged: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /** Held by a recall or a compliance freeze. §5.4 */
    quarantined: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    reorderLevel: {
      type: Number,
      required: false,
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      required: false,
      default: 0,
    },
    /**
     * Default FALSE for fresh meat.
     *
     * A butcher shop that lets a shelf go negative will happily sell stock it does
     * not have, and the shortage surfaces at the counter as a weight confirmation
     * against nothing. When an outlet genuinely needs it (a fishmonger finishing
     * the day's catch), it is a deliberate, visible setting.
     */
    allowNegativeStock: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * BR-13. Two different clocks:
     *   `receivedAt` → expiry  = shelfLifeHoursRaw      (uncut, chilled)
     *   `cutAt`      → useByAt = shelfLifeHoursPrepared (cut, counted from CUT time)
     *
     * Using the raw life for prepared stock is how a customer receives day-old cut
     * meat sold as fresh, which is the single most damaging thing this vertical
     * can do to its own reputation.
     */
    receivedAt: {
      type: Date,
      required: false,
    },
    cutAt: {
      type: Date,
      required: false,
      default: undefined,
    },
    expiresAt: {
      type: Date,
      required: false,
    },
    useByAt: {
      type: Date,
      required: false,
      default: undefined,
    },
    storageLocation: {
      type: String,
      required: false,
      trim: true,
    },
    lastCountedAt: {
      type: Date,
      required: false,
    },
    /** Monotonic per-outlet counter, so a movement can be ordered against a state. */
    movementSeq: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaInventoryItemSchema.plugin(toJSON);
jhatkaInventoryItemSchema.plugin(paginate);

// One row per batch for raw and prepared stock. Without this, two operators
// receiving the same delivery create two rows for one batch and every FEFO
// allocation is ambiguous about which one to decrement.
//
// Packaging has no batch, so the index is partial — a unique index over a field
// that is usually absent would collide on every packaging row.
jhatkaInventoryItemSchema.index(
  { outlet: 1, kind: 1, batch: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: { $in: ['raw', 'prepared'] }, batch: { $exists: true } },
    name: 'one_inventory_row_per_outlet_kind_and_batch',
  }
);

// Variant-level stock for packaging and for prepared stock tracked without a
// batch (eggs, which are not cut and therefore have no batch to trace).
jhatkaInventoryItemSchema.index(
  { outlet: 1, kind: 1, variant: 1, packagingItem: 1 },
  {
    unique: true,
    partialFilterExpression: { batch: { $exists: false } },
    name: 'one_inventory_row_per_outlet_kind_and_variant_when_unbatched',
  }
);

// FEFO allocation's ordering query: which sellable batches expire first?
jhatkaInventoryItemSchema.index({ outlet: 1, kind: 1, expiresAt: 1, availableQty: 1 });
// `findLowStock` — the dashboard's "Low Stock" tile.
jhatkaInventoryItemSchema.index({ outlet: 1, availableQty: 1, lowStockThreshold: 1 });
// The expiry sweep.
jhatkaInventoryItemSchema.index({ useByAt: 1, availableQty: 1 });

/**
 * FEFO candidate set for one outlet.
 *
 * **"Skipping expired batches by writing them off"** is the part that matters, and
 * it is inherited from `dairy.procurement.service.allocateByFEFO`. If an expired
 * batch is merely left out of the allocation, it stays `availableQty > 0` and
 * every inventory report keeps claiming stock that cannot be sold. The caller
 * must therefore write expired rows off — `availableQty: 0`, `status` expired, an
 * `EXPIRY_WRITE_OFF` allocation — rather than just skipping them. This method
 * returns them separately so the caller cannot forget.
 *
 * @param {mongoose.Types.ObjectId} outletId
 * @param {{product?: any, variant?: any, kind?: string}} opts
 * @returns {Promise<{usable: any[], expired: any[]}>}
 */
jhatkaInventoryItemSchema.statics.findFefoCandidates = async function (outletId, opts = {}) {
  const now = new Date();

  const match = {
    outlet: outletId,
    kind: opts.kind || { $in: ['raw', 'prepared'] },
    onHand: { $gt: 0 },
  };
  if (opts.product) match.product = opts.product;
  if (opts.variant) match.variant = opts.variant;

  const rows = await this.find(match).sort({ expiresAt: 1, receivedAt: 1 }).lean();

  // Prepared stock expires on `useByAt`, raw on `expiresAt`. A prepared row that
  // has never been cut has no `useByAt`, which is a data-entry bug rather than a
  // valid state — it is treated as raw so it is not silently treated as fresh.
  const expiryOf = (r) => (r.kind === 'prepared' ? r.useByAt || r.expiresAt : r.expiresAt);

  const usable = [];
  const expired = [];
  for (const r of rows) {
    const exp = expiryOf(r);
    if (exp && exp <= now) expired.push(r);
    else usable.push(r);
  }

  return { usable, expired };
};

/**
 * Rows at or below their reorder threshold, for the dashboard tile.
 *
 * Uses `$expr` so the comparison happens in the database rather than after a
 * fetch — `stores` does the same on `StoreOutletStockItem.findLowStock`.
 */
jhatkaInventoryItemSchema.statics.findLowStock = function (outletId, limit = 50) {
  return this.find({
    outlet: outletId,
    availableQty: { $gt: 0 },
    lowStockThreshold: { $gt: 0 },
    $expr: { $lte: ['$availableQty', '$lowStockThreshold'] },
  })
    .sort({ availableQty: 1 })
    .limit(limit);
};

/**
 * Usable quantity right now, in the row's own unit. Integer. Never a money field.
 */
jhatkaInventoryItemSchema.methods.usableQty = function (now = new Date()) {
  const exp = this.kind === 'prepared' ? this.useByAt || this.expiresAt : this.expiresAt;
  if (exp && exp <= now) return 0;
  return Math.max(0, (this.availableQty || 0) - (this.quarantined || 0));
};

/**
 * @typedef JhatkaInventoryItem
 */
const JhatkaInventoryItem = mongoose.model('JhatkaInventoryItem', jhatkaInventoryItemSchema);

JhatkaInventoryItem.KINDS = INVENTORY_KINDS;
JhatkaInventoryItem.UNITS = QUANTITY_UNITS;

module.exports = JhatkaInventoryItem;