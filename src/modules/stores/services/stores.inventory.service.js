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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const recalculateAvailable = (item) => {
  item.availableQty = item.onHand - item.reserved - item.damaged;
  return item;
};

const getOrCreateStockItem = async ({ outlet, chain, variant, product, outletProduct }) => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  let item = await StoreOutletStockItem.findOne({ outlet, variant });
  if (!item) {
    item = await StoreOutletStockItem.create({
      outlet,
      chain,
      variant,
      product,
      outletProduct,
      onHand: 0,
      reserved: 0,
      damaged: 0,
      incoming: 0,
      availableQty: 0,
    });
  }
  return item;
};

const logMovement = async ({ outlet, chain, variant, product, type, qtyDelta = 0, reservedDelta = 0, damagedDelta = 0, onHandAfter, reservedAfter, damagedAfter, reason, referenceType, referenceId, movementSeq, performedBy, performedByName, notes }) => {
  const StoreInventoryMovement = mongoose.model('StoreInventoryMovement');
  return StoreInventoryMovement.create({
    outlet,
    chain,
    variant,
    product,
    type,
    qtyDelta,
    reservedDelta,
    damagedDelta,
    onHandAfter,
    reservedAfter,
    damagedAfter,
    reason,
    referenceType,
    referenceId,
    movementSeq,
    performedBy,
    performedByName,
    notes,
  });
};

const adjustStock = async ({ outlet, chain, variant, product, type, quantity, reason, referenceType, referenceId, performedBy, performedByName, notes }) => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const item = await getOrCreateStockItem({ outlet, chain, variant, product });

  let qtyDelta;
  let reservedDelta = 0;
  let damagedDelta = 0;

  switch (type) {
    case 'STOCK_ADDED':
      qtyDelta = quantity;
      item.onHand += quantity;
      break;
    case 'STOCK_REMOVED':
      qtyDelta = -quantity;
      item.onHand = Math.max(0, item.onHand - quantity);
      break;
    case 'ADJUSTMENT':
      qtyDelta = quantity - item.onHand;
      item.onHand = quantity;
      break;
    case 'DAMAGED':
      qtyDelta = -quantity;
      damagedDelta = quantity;
      item.onHand = Math.max(0, item.onHand - quantity);
      item.damaged += quantity;
      break;
    case 'EXPIRED':
      qtyDelta = -quantity;
      if (!item.allowNegativeStock) {
        damagedDelta = quantity;
        item.damaged += quantity;
      }
      item.onHand = Math.max(0, item.onHand - quantity);
      break;
    // Customer return: the goods come back, so onHand rises. `stores.return.service.js`
    // processReturnRefund calls adjustStock with this type and it had no case here, so
    // every return refund died on `Unknown movement type: RETURNED` and the returned
    // units never came back into stock. Recorded under its own movement type rather than
    // folded into STOCK_ADDED so the ledger distinguishes a customer handback from a
    // supplier delivery.
    case 'RETURNED':
      qtyDelta = quantity;
      item.onHand += quantity;
      break;
    default:
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown movement type: ${type}`);
  }

  recalculateAvailable(item);
  item.movementSeq += 1;
  await item.save();

  await logMovement({
    outlet, chain, variant, product, type, qtyDelta, reservedDelta, damagedDelta,
    onHandAfter: item.onHand, reservedAfter: item.reserved, damagedAfter: item.damaged,
    reason, referenceType, referenceId, movementSeq: item.movementSeq,
    performedBy, performedByName, notes,
  });

  return item;
};

// The oversell guard (BR-30) lives in the QUERY: the conditional update only
// matches when the cached availableQty (or allowNegativeStock) allows the
// quantity, so two parallel reserve calls cannot both pass a shared balance.
// `availableQty` is kept consistent arithmetically: +reserved => -availableQty.
const reserveStock = async ({ outlet, chain, variant, product, order, quantity, expiresAt }) => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const StoreStockReservation = mongoose.model('StoreStockReservation');

  // 1. Claim the reservation first. The unique (order, variant) index makes a
  //    parallel double-reserve a no-op instead of a double increment.
  let reservation;
  try {
    reservation = await StoreStockReservation.create({
      outlet, chain, variant, product, order, quantity, status: 'held', expiresAt,
    });
  } catch (e) {
    if (e.code === 11000) {
      const existing = await StoreStockReservation.findOne({ order, variant });
      if (existing) return { item: await StoreOutletStockItem.findOne({ outlet, variant }), reservation: existing };
      throw e;
    }
    throw e;
  }

  // 2. The atomic conditional update IS the availability check.
  const item = await StoreOutletStockItem.findOneAndUpdate(
    {
      outlet,
      variant,
      $or: [{ allowNegativeStock: true }, { availableQty: { $gte: quantity } }],
    },
    { $inc: { reserved: quantity, availableQty: -quantity, movementSeq: 1 } },
    { new: true }
  );

  if (!item) {
    // Stock moved between the claim and the update (or never existed).
    await StoreStockReservation.updateOne({ _id: reservation._id }, {
      status: 'released', releasedAt: new Date(), releasedReason: 'manual',
    });
    const probe = await StoreOutletStockItem.findOne({ outlet, variant }).select('availableQty allowNegativeStock');
    if (!probe) throw new ApiError(httpStatus.NOT_FOUND, 'Stock item not found');
    throw new ApiError(httpStatus.CONFLICT, `INSUFFICIENT_STOCK: available ${probe.availableQty}, requested ${quantity}`);
  }

  await logMovement({
    outlet, chain, variant, product, type: 'RESERVED', reservedDelta: quantity,
    onHandAfter: item.onHand, reservedAfter: item.reserved, damagedAfter: item.damaged,
    reason: 'Order reservation', referenceType: 'order', referenceId: order,
    movementSeq: item.movementSeq,
  });

  return { item, reservation };
};

const commitReservation = async ({ order, variant, quantity }) => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const StoreStockReservation = mongoose.model('StoreStockReservation');

  // Idempotent claim: only one parallel caller wins the held->committed move.
  const reservation = await StoreStockReservation.findOneAndUpdate(
    { order, variant, status: 'held' },
    { $set: { status: 'committed', committedAt: new Date() } },
    { new: true }
  );
  if (!reservation) {
    const existing = await StoreStockReservation.findOne({ order, variant });
    if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'No held reservation found');
    return StoreOutletStockItem.findOne({ outlet: existing.outlet, variant });
  }

  const item = await StoreOutletStockItem.findOneAndUpdate(
    {
      outlet: reservation.outlet,
      variant,
      reserved: { $gte: quantity },
    },
    { $inc: { onHand: -quantity, reserved: -quantity, movementSeq: 1 } },
    { new: true }
  );
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Stock item not found or reservation not reserved');

  await logMovement({
    outlet: reservation.outlet, chain: reservation.chain, variant, product: reservation.product,
    type: 'SOLD', qtyDelta: -quantity, reservedDelta: -quantity,
    onHandAfter: item.onHand, reservedAfter: item.reserved, damagedAfter: item.damaged,
    reason: 'Order committed', referenceType: 'order', referenceId: order,
    movementSeq: item.movementSeq,
  });

  return item;
};

const releaseReservation = async ({ order, variant, quantity, reason }) => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const StoreStockReservation = mongoose.model('StoreStockReservation');

  // Idempotent: a repeat release (order cancelled twice, or sweep + manual) is a
  // no-op that returns whatever state exists without re-decrementing stock.
  const reservation = await StoreStockReservation.findOneAndUpdate(
    { order, variant, status: 'held' },
    { $set: { status: 'released', releasedAt: new Date(), releasedReason: reason || 'manual' } },
    { new: true }
  );
  if (!reservation) {
    const existing = await StoreStockReservation.findOne({ order, variant });
    return existing && existing.outlet ? StoreOutletStockItem.findOne({ outlet: existing.outlet, variant }) : null;
  }

  const item = await StoreOutletStockItem.findOneAndUpdate(
    {
      outlet: reservation.outlet,
      variant,
      reserved: { $gte: quantity },
    },
    { $inc: { reserved: -quantity, availableQty: quantity, movementSeq: 1 } },
    { new: true }
  );

  if (item) {
    await logMovement({
      outlet: reservation.outlet, chain: reservation.chain, variant, product: reservation.product,
      type: 'RELEASED', reservedDelta: -quantity,
      onHandAfter: item.onHand, reservedAfter: item.reserved, damagedAfter: item.damaged,
      reason: reason || 'Reservation released', referenceType: 'order', referenceId: order,
      movementSeq: item.movementSeq,
    });
  }

  return item;
};

const getStockForOutlet = async (outletId) => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  return StoreOutletStockItem.find({ outlet: outletId }).populate('product', 'name slug').lean();
};

const getLowStockItems = async (outletId) => {
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  return StoreOutletStockItem.find({
    outlet: outletId,
    $expr: { $lte: ['$availableQty', '$lowStockThreshold'] },
  }).populate('product', 'name slug').lean();
};

const getMovements = async ({ outlet, variant, limit = 50 }) => {
  const StoreInventoryMovement = mongoose.model('StoreInventoryMovement');
  const filter = { outlet };
  if (variant) filter.variant = variant;
  return StoreInventoryMovement.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
};

module.exports = {
  adjustStock,
  reserveStock,
  commitReservation,
  releaseReservation,
  getStockForOutlet,
  getLowStockItems,
  getMovements,
  recalculateAvailable,
};