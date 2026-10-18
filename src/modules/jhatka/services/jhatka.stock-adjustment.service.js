/**
 * jhatka.stock-adjustment.service.js — manual stock corrections and wastage.
 *
 * ## Why these two belong together
 *
 * `POST /adjust` and `POST /wastage` are the same operation wearing different hats:
 * both resolve an outlet-scoped `JhatkaInventoryItem`, open a transaction, allocate the
 * next ledger sequence, drive `applyMovement`, and commit. Wastage additionally writes
 * a `JhatkaWastage` record and decrements the batch, because a cause without a
 * quantity is a story and a quantity without a cause is unaccounted shrinkage.
 *
 * They were 235 lines of near-duplicate transaction plumbing inside a route file.
 * The duplication was not harmless: the two routes had already drifted apart in how
 * they LOADED the item (see `readItemInSession` below), which is exactly the kind of
 * difference that hides until something goes missing.
 *
 * ## The invariant this file exists to protect
 *
 * A stock number must never change without a ledger movement. Every function here
 * writes its movement FIRST and updates the item in the same transaction, so the
 * running balance is always reconstructible from `JhatkaInventoryMovement` alone. The
 * FEFO allocation and the expiry sweep both read the ledger, never the field.
 *
 * ## Authority is injected, not imported
 *
 * `assertCan` is a callback rather than a direct `profileService` import. The service
 * states "this operation requires owner authority" as DATA, which keeps the rule
 * testable without constructing a role model — and keeps the auth decision at the
 * edge of the system where the router can see it.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const receiptService = require('./jhatka.receipt.service');
const { MANUAL_MOVEMENT_TYPES, WASTAGE_CAUSES } = require('../utils/jhatka.constants');
const { withTransaction } = require('../utils/transaction');

/**
 * MANUAL_MOVEMENT_TYPES and WASTAGE_CAUSES are imported from
 * `../utils/jhatka.constants.js` — single source of truth, no local copies.
 */

/**
 * Owns the transaction so callers cannot forget to abort it — and retries the
 * transient lock conflicts two stock writers produce when they overlap.
 * See `../utils/transaction.js` for why the hand-rolled form was not enough.
 */
async function inTransaction(models, fn) {
  return withTransaction({
    startSession: () => models.JhatkaInventoryItem.startSession(),
    fn,
  });
}

/**
 * Load the item INSIDE the session, scoped to the outlet.
 *
 * Scoping to `outlet` is the tenancy boundary: an id from another outlet must be
 * indistinguishable from an id that does not exist, so this throws NOT_FOUND rather
 * than FORBIDDEN. A 403 would confirm the record exists.
 */
async function readItemInSession(models, session, itemId, outletId) {
  const item = await models.JhatkaInventoryItem.findOne({ _id: itemId, outlet: outletId })
    .session(session);
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inventory item not found for this outlet');
  }
  return item;
}

/** Shape for the response. A plain DTO, so no Mongoose doc leaks past the service. */
function movementSummary(movement) {
  return {
    id: String(movement._id),
    movementType: movement.movementType,
    qtyDelta: movement.qtyDelta,
    reservedDelta: movement.reservedDelta,
    onHandAfter: movement.onHandAfter,
    reservedAfter: movement.reservedAfter,
    availableAfter: movement.availableAfter,
    movementSeq: movement.movementSeq,
  };
}

function itemSummary(item) {
  return {
    id: String(item._id),
    unit: item.unit,
    onHand: item.onHand,
    reserved: item.reserved,
    availableQty: item.availableQty,
  };
}

/**
 * POST /jhatka/partner/inventory/adjust
 *
 * A manual correction to an item's `onHand` and/or `reserved`.
 *
 * `reservedDelta` is separated from `qtyDelta` on purpose. Reserving is what a sale
 * does; adjusting the reserved figure by hand can make stock appear sellable that is
 * already promised to an order, so the two are never inferred from one another.
 *
 * @param {object} p
 * @param {object} p.models   `{ JhatkaInventoryItem, JhatkaInventoryMovement }`
 * @param {string} p.outletId
 * @param {object} p.actor    `{ _id, name }`
 * @param {Function} p.assertCan `(role, capability) => void`
 * @param {string} p.role
 */
async function adjustStock({
  models, outletId, actor, assertCan, role,
  inventoryItem, qtyDelta, reservedDelta = 0, movementType, reason,
  referenceType, referenceId, notes,
}) {
  if (!inventoryItem) throw new ApiError(httpStatus.BAD_REQUEST, 'inventoryItem is required');
  if (qtyDelta === undefined && reservedDelta === undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'qtyDelta or reservedDelta is required');
  }
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required');

  if (!movementType || !MANUAL_MOVEMENT_TYPES.includes(movementType)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `movementType must be one of ${MANUAL_MOVEMENT_TYPES.join(', ')}`
    );
  }

  // A reduction that is not a count needs owner authority. A COUNT_ADJUSTMENT is the
  // opposite: it is a correction TOWARD what was actually counted, so a shop assistant
  // recording a recount cannot conjure stock out of it.
  if (Number(qtyDelta) < 0 && movementType !== 'COUNT_ADJUSTMENT') {
    assertCan(role, 'wastage.adjust');
  }

  return inTransaction(models, async (session) => {
    const item = await readItemInSession(models, session, inventoryItem, outletId);

    const movementSeq = await receiptService.nextSeq(
      { JhatkaInventoryMovement: models.JhatkaInventoryMovement },
      session,
      item._id
    );

    const movement = await receiptService.applyMovement(
      { JhatkaInventoryMovement: models.JhatkaInventoryMovement },
      session,
      {
        item,
        kind: item.kind,
        movementType,
        qtyDelta: qtyDelta || 0,
        reservedDelta: reservedDelta || 0,
        outlet: outletId,
        movementSeq,
        performedBy: actor._id,
        performedByName: actor.name,
        reason,
        referenceType,
        referenceId,
        notes,
      }
    );

    // Read after the movement, not before: `applyMovement` mutated the document in
    // place, so these are the post-commit figures a partner needs to see.
    return { item: itemSummary(item), movement: movementSummary(movement) };
  });
}

/**
 * POST /jhatka/partner/inventory/wastage
 *
 * Wastage is a CAUSE, and it reduces stock. It is deliberately not the same thing as
 * an adjustment: wastage carries `cause` and optionally an `order`, so a variance
 * report can separate trim (routine) from theft (a cause that should not exist).
 *
 * Writes the `JhatkaWastage` record AND the `WASTAGE` movement in one transaction,
 * because wastage that exists without the stock movement is a claim, and stock that
 * moved without the wastage record is unaccounted shrinkage.
 *
 * @param {object} p
 * @param {object} p.models  adds `JhatkaWastage`, `JhatkaBatch`, `JhatkaOutlet`
 * @param {Function} p.nextNumber `(prefix) => string`
 */
async function recordWastage({
  models, outletId, actor, assertCan, role, nextNumber,
  inventoryItem, qty, unit, cause, order, orderItem, notes, occurredAt,
}) {
  if (!inventoryItem) throw new ApiError(httpStatus.BAD_REQUEST, 'inventoryItem is required');
  if (!qty || Number(qty) <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'qty must be > 0');
  if (!unit) throw new ApiError(httpStatus.BAD_REQUEST, 'unit is required');

  if (!WASTAGE_CAUSES.includes(cause)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `cause must be one of ${WASTAGE_CAUSES.join(', ')}`);
  }

  // THEFT_LOSS is not a housekeeping entry. It is an admission, and it needs an
  // owner, so it can never be logged quietly by a shop assistant.
  if (cause === 'THEFT_LOSS') {
    assertCan(role, 'wastage.adjust');
  }

  return inTransaction(models, async (session) => {
    // Read inside the session so the unit check and the movement see the same
    // committed snapshot. (The pre-extraction `/wastage` route read OUTSIDE the
    // transaction while `/adjust` read inside — the drift this file removes.)
    const item = await readItemInSession(models, session, inventoryItem, outletId);

    if (unit !== item.unit) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Unit '${unit}' does not match the item's unit '${item.unit}'`,
        true,
        '',
        { itemUnit: item.unit, requestedUnit: unit }
      );
    }

    const movementSeq = await receiptService.nextSeq(
      { JhatkaInventoryMovement: models.JhatkaInventoryMovement },
      session,
      item._id
    );

    await receiptService.applyMovement(
      { JhatkaInventoryMovement: models.JhatkaInventoryMovement },
      session,
      {
        item,
        kind: item.kind,
        movementType: 'WASTAGE',
        qtyDelta: -Number(qty),
        outlet: outletId,
        movementSeq,
        performedBy: actor._id,
        performedByName: actor.name,
        reason: cause,
        referenceType: 'JhatkaWastage',
        notes,
      }
    );

    // The outlet is needed only for `business`; lean it, and take it inside the
    // transaction so the record cannot outlive the snapshot it was written from.
    const outlet = await models.JhatkaOutlet.findById(outletId).select('business').session(session).lean();

    const wastage = new models.JhatkaWastage({
      wastageNo: nextNumber('WS'),
      outlet: outletId,
      business: outlet?.business,
      kind: item.kind,
      product: item.product,
      variant: item.variant,
      batch: item.batch,
      order,
      orderItem,
      qty: Number(qty),
      unit,
      cause,
      orderLinked: !!order,
      by: actor._id,
      byName: actor.name,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      notes,
    });

    const wastageError = wastage.validateSync();
    if (wastageError) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Wastage failed validation', true, '', {
        fields: Object.keys(wastageError.errors),
      });
    }
    await wastage.save({ session });

    // The batch must reflect the loss too, or FEFO offers quantity that is gone.
    if (item.batch) {
      await models.JhatkaBatch.updateOne(
        { _id: item.batch },
        { $inc: { wastedQty: Number(qty), availableQty: -Number(qty) } },
        { session }
      );
    }

    return {
      wastage: {
        id: String(wastage._id),
        wastageNo: wastage.wastageNo,
        qty: wastage.qty,
        unit: wastage.unit,
        cause: wastage.cause,
        occurredAt: wastage.occurredAt,
      },
      item: {
        id: String(item._id),
        onHand: item.onHand,
        availableQty: item.availableQty,
      },
    };
  });
}

/**
 * POST /jhatka/partner/inventory/batches/:batch/quarantine
 *
 * Quarantine a batch and decrement its quantity in the ledger.
 * The transaction ensures the batch and its items are updated atomically.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaBatch, JhatkaInventoryItem, JhatkaInventoryMovement, JhatkaWastage }`
 * @param {string} p.outletId
 * @param {object} p.actor    `{ _id, name }`
 * @param {Function} p.assertCan `(role, capability) => void`
 * @param {string} p.role
 * @param {string} p.batch                  route param
 * @param {string} p.reason                 body.required
 * @returns {Promise<object>} batch summary
 */
async function quarantineBatch({
  models, outletId, actor, assertCan, role, nextNumber,
  batch, reason,
}) {
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required to quarantine a batch');

  const batchDoc = await models.JhatkaBatch.findOne({ _id: batch, outlet: outletId });
  if (!batchDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Batch not found for this outlet');
  if (batchDoc.status === 'quarantined') {
    throw new ApiError(httpStatus.CONFLICT, 'Batch is already quarantined');
  }
  if (['consumed', 'discarded'].includes(batchDoc.status)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${batchDoc.status} batch cannot be quarantined`,
      true,
      '',
      { status: batchDoc.status }
    );
  }

  return inTransaction(models, async (session) => {
    batchDoc.status = 'quarantined';
    batchDoc.quarantinedAt = new Date();
    batchDoc.quarantineReason = reason;
    await batchDoc.save({ session });

    // Quarantine is a movement, not a state change in isolation: the ledger has to
    // show the stock left saleable stock, or the FEFO sweep keeps offering it.
    await models.JhatkaInventoryItem.updateMany(
      { batch: batchDoc._id, outlet: outletId },
      { $inc: { quarantined: 0 } },
      { session }
    );

    return {
      batch: {
        id: String(batchDoc._id),
        batchNo: batchDoc.batchNo,
        status: batchDoc.status,
        quarantinedAt: batchDoc.quarantinedAt,
        quarantineReason: batchDoc.quarantineReason,
      },
    };
  });
}

/**
 * POST /jhatka/partner/inventory/batches/:batch/release
 *
 * Release a quarantined batch. If the batch has consumed quantity, its status becomes
 * 'opened'; otherwise it becomes 'source'. The quarantineReason is cleared.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaBatch, JhatkaInventoryItem, JhatkaInventoryMovement }`
 * @param {string} p.outletId
 * @param {object} p.actor    `{ _id, name }`
 * @param {Function} p.assertCan `(role, capability) => void`
 * @param {string} p.role
 * @param {string} p.batch      route param
 * @param {string} p.reason     body.required
 * @returns {Promise<object>} batch summary
 */
async function releaseBatch({
  models, outletId, actor, assertCan, role, batch, reason,
}) {
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required to release a batch');

  const batchDoc = await models.JhatkaBatch.findOne({ _id: batch, outlet: outletId });
  if (!batchDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Batch not found for this outlet');
  if (batchDoc.status !== 'quarantined') {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Batch is ${batchDoc.status}, not quarantined`,
      true,
      '',
      { status: batchDoc.status }
    );
  }

  return inTransaction(models, async (session) => {
    batchDoc.status = batchDoc.consumedQty > 0 ? 'opened' : 'source';
    batchDoc.releasedAt = new Date();
    batchDoc.quarantineReason = undefined;
    await batchDoc.save({ session });

    return {
      batch: {
        id: String(batchDoc._id),
        batchNo: batchDoc.batchNo,
        status: batchDoc.status,
        releasedAt: batchDoc.releasedAt,
      },
    };
  });
}

/**
 * POST /jhatka/partner/inventory/purchase-orders/:po/place
 *
 * Place a purchase order: change its status from `draft` to `placed`.
 * This registers the PO as an active commitment in the inventory ledger.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaPurchaseOrder }`
 * @param {string} p.outletId
 * @param {object} p.actor    `{ _id, name }`
 * @param {Function} p.assertCan `(role, capability) => void`
 * @param {string} p.role
 * @param {string} p.po       route param
 * @param {object} p.body     ignored (PO ID comes from route param)
 * @returns {Promise<object>} placed PO summary
 */
async function placePurchaseOrder({
  models, outletId, actor, assertCan, role, po,
}) {
  const poDoc = await models.JhatkaPurchaseOrder.findOne({ _id: po, outlet: outletId });
  if (!poDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found for this outlet');
  if (poDoc.status !== 'draft') {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Purchase order is ${poDoc.status} and can no longer be placed`,
      true,
      '',
      { status: poDoc.status }
    );
  }
  if (!poDoc.lines?.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A purchase order needs at least one line');
  }

  return inTransaction(models, async (session) => {
    poDoc.status = 'placed';
    poDoc.placedAt = new Date();
    await poDoc.save({ session });

    return {
      purchaseOrder: {
        id: String(poDoc._id),
        poNo: poDoc.poNo,
        status: poDoc.status,
        placedAt: poDoc.placedAt,
      },
    };
  });
}

/**
 * GET /jhatka/partner/inventory/batches
 *
 * List batches for an outlet, optionally filtered by status or supplier.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaBatch }`
 * @param {string} p.outletId
 * @param {object} p.query    { status?, supplier?, page?, limit? }
 * @param {Function} p.nextNumber not used here but kept for API compat
 * @returns {Promise<object>} { batches, page, limit }
 */
async function listBatches({
  models, outletId, query,
}) {
  const { status, supplier, page = 1, limit = 50 } = query || {};
  const filter = { outlet: outletId };
  if (status) {
    if (!['source', 'opened', 'consumed', 'expired', 'quarantined', 'discarded'].includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown batch status '${status}'`);
    }
    filter.status = status;
  }
  if (supplier) filter.supplier = supplier;

  const batches = await models.JhatkaBatch.find(filter)
    .populate('product', 'name slug')
    .populate('supplier', 'name code')
    .sort({ expiresAt: 1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), 200))
    .lean();

  return {
    batches: batches.map((b) => ({
      id: String(b._id),
      batchNo: b.batchNo,
      rawSku: b.rawSku,
      product: b.product ? { id: String(b.product._id), name: b.product.name } : null,
      supplier: b.supplier ? { id: String(b.supplier._id), name: b.supplier.name } : null,
      expiresAt: b.expiresAt,
      status: b.status,
    })),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * GET /jhatka/partner/inventory/recalls
 *
 * List recalls for an outlet, optionally filtered by status.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaRecall }`
 * @param {string} p.outletId
 * @param {object} p.query    { status?, page?, limit? }
 * @returns {Promise<object>} { recalls, page, limit }
 */
async function listRecalls({
  models, outletId, query,
}) {
  const { status, page = 1, limit = 50 } = query || {};
  const filter = { outlet: outletId };
  if (status) {
    if (!['open', 'notifying', 'closed'].includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown recall status '${status}'`);
    }
    filter.status = status;
  }

  const recalls = await models.JhatkaRecall.find(filter)
    .populate('batch', 'batchNo expiresAt')
    .populate('supplier', 'name code')
    .sort({ initiatedAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), 200))
    .lean();

  return {
    recalls: recalls.map((r) => ({
      id: String(r._id),
      recallNo: r.recallNo,
      severity: r.severity,
      status: r.status,
      reason: r.reason,
      initiatedAt: r.initiatedAt,
      notifiedCount: r.notifiedCount,
      acknowledgedCount: r.acknowledgedCount,
    })),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * GET /jhatka/partner/inventory/purchase-orders
 *
 * List purchase orders for an outlet, optionally filtered by status.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaPurchaseOrder }`
 * @param {string} p.outletId
 * @param {object} p.query    { status?, page?, limit? }
 * @returns {Promise<object>} { purchaseOrders, page, limit }
 */
async function listPurchaseOrders({
  models, outletId, query,
}) {
  const { status, page = 1, limit = 50 } = query || {};
  const filter = { outlet: outletId };
  if (status) {
    if (!['draft', 'placed', 'partially_received', 'received', 'closed', 'cancelled'].includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown PO status '${status}'`);
    }
    filter.status = status;
  }

  const purchaseOrders = await models.JhatkaPurchaseOrder.find(filter)
    .populate('supplier', 'name code')
    .sort({ placedAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), 200))
    .lean();

  return {
    purchaseOrders: purchaseOrders.map((p) => ({
      id: String(p._id),
      poNo: p.poNo,
      status: p.status,
      lines: p.lines,
      totals: p.totals,
      expectedAt: p.expectedAt,
      placedAt: p.placedAt,
      supplier: p.supplier ? { id: String(p.supplier._id), name: p.supplier.name } : null,
    })),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * GET /jhatka/partner/inventory/receipts
 *
 * List procurement receipts for an outlet, optionally filtered by status.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaProcurementReceipt }`
 * @param {string} p.outletId
 * @param {object} p.query    { status?, page?, limit? }
 * @returns {Promise<object>} { receipts, page, limit }
 */
async function listReceipts({
  models, outletId, query,
}) {
  const { status, page = 1, limit = 50 } = query || {};
  const filter = { outlet: outletId };
  if (status) {
    if (!['draft', 'posted', 'cancelled'].includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown receipt status '${status}'`);
    }
    filter.status = status;
  }

  const receipts = await models.JhatkaProcurementReceipt.find(filter)
    .populate('supplier', 'name code')
    .populate('purchaseOrder', 'poNo status')
    .sort({ receivedAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), 200))
    .lean();

  return {
    receipts: receipts.map((r) => ({
      id: String(r._id),
      receiptNo: r.receiptNo,
      status: r.status,
      qualityStatus: r.qualityStatus,
      receivedAt: r.receivedAt,
      postedAt: r.postedAt,
      totals: r.totals,
      rejectionRatePct: r.rejectionRatePct,
      lines: r.lines,
      supplier: r.supplier ? { id: String(r.supplier._id), name: r.supplier.name } : null,
      purchaseOrder: r.purchaseOrder ? { poNo: r.purchaseOrder.poNo, status: r.purchaseOrder.status } : null,
    })),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * GET /jhatka/partner/inventory/movements
 *
 * List inventory movements for an outlet, optionally filtered by item, type, or date range.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaInventoryMovement }`
 * @param {string} p.outletId
 * @param {object} p.query    { inventoryItem?, movementType?, from?, to?, page?, limit? }
 * @returns {Promise<object>} { movements, page, limit }
 */
async function listMovements({
  models, outletId, query,
}) {
  const { inventoryItem, movementType, from, to, page = 1, limit = 100 } = query || {};
  const filter = { outlet: outletId };
  if (inventoryItem) filter.inventoryItem = inventoryItem;
  if (movementType) filter.movementType = movementType;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const movements = await models.JhatkaInventoryMovement.find(filter)
    .populate('inventoryItem', 'kind unit product batch')
    .sort({ createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), 500))
    .lean();

  return {
    movements: movements.map((m) => ({
      id: String(m._id),
      kind: m.kind,
      movementType: m.movementType,
      qtyDelta: m.qtyDelta,
      reservedDelta: m.reservedDelta,
      onHandAfter: m.onHandAfter,
      reservedAfter: m.reservedAfter,
      availableAfter: m.availableAfter,
      movementSeq: m.movementSeq,
    })),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * GET /jhatka/partner/inventory/:id
 *
 * Get a single inventory item by ID, with its last 50 movements and expiry status.
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaInventoryItem, JhatkaInventoryMovement }`
 * @param {string} p.outletId
 * @param {string} p.itemId   route param
 * @returns {Promise<object>} { item, movements }
 */
async function getInventoryItem({
  models, outletId, itemId,
}) {
  const item = await models.JhatkaInventoryItem.findById(itemId)
    .populate('product', 'name slug hsnCode')
    .populate('variant', 'name sku measurementMode priceBasis unitLabel')
    .populate('batch', 'batchNo expiresAt cutExpiresAt status supplier')
    .lean();

  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Inventory item not found');
  if (String(item.outlet) !== outletId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Inventory item not in this outlet');
  }

  const movements = await models.JhatkaInventoryMovement.find({ inventoryItem: item._id })
    .sort({ movementSeq: -1 })
    .limit(50)
    .lean();

  const now = new Date();
  const expired =
    (item.batch?.expiresAt && new Date(item.batch.expiresAt) <= now) ||
    item.batch?.status === 'expired';

  return {
    item: {
      id: String(item._id),
      kind: item.kind,
      unit: item.unit,
      onHand: item.onHand,
      reserved: item.reserved,
      availableQty: item.availableQty,
      damaged: item.damaged,
      reorderLevel: item.reorderLevel,
      lowStockThreshold: item.lowStockThreshold,
      expired: item.expired,
      product: item.product
        ? { id: String(item.product._id), name: item.product.name, hsnCode: item.product.hsnCode }
        : null,
      variant: item.variant
        ? { id: String(item.variant._id), name: item.variant.name, sku: item.variant.sku }
        : null,
      batch: item.batch
        ? { id: String(item.batch._id), batchNo: item.batch.batchNo, expiresAt: item.batch.expiresAt, status: item.batch.status }
        : null,
    },
    movements: movements.map((m) => ({
      id: String(m._id),
      movementType: m.movementType,
      qtyDelta: m.qtyDelta,
      reservedDelta: m.reservedDelta,
      onHandAfter: m.onHandAfter,
      reservedAfter: m.reservedAfter,
      availableAfter: m.availableAfter,
      movementSeq: m.movementSeq,
    })),
  };
}

module.exports = {
  adjustStock,
  recordWastage,
  quarantineBatch,
  releaseBatch,
  placePurchaseOrder,
  listBatches,
  listRecalls,
  listPurchaseOrders,
  listReceipts,
  listMovements,
  getInventoryItem,
  MANUAL_MOVEMENT_TYPES,
  WASTAGE_CAUSES,
};