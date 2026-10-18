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

/**
 * jhatka.inventory-views.service.js — read projections for stock, suppliers, items.
 *
 * ## Why reads get a service too
 *
 * These are "just queries", which is exactly why they drift: the stock list reports
 * an EXPIRED batch as zero-available regardless of `onHand` (§5), and that rule has
 * to hold in the list, the detail, and anywhere else stock is shown. When the rule
 * lived inline in the route, a second screen showing the same row would reimplement
 * it — and the one time the two disagreed, the shop would sell meat that should have
 * been binned.
 *
 * The mutating side (adjust, wastage, quarantine, receipts, recalls) already lives in
 * `jhatka.stock-adjustment.service`, `jhatka.receipt.service` and
 * `jhatka.recall.service`. This module is the read half of the same domain.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/** Hard cap so a list cannot page the whole collection. */
const MAX_PAGE_LIMIT = 200;

/**
 * Is this batch unsellable, regardless of what its counters claim? §5.
 *
 * Expired batches are not merely skipped — they are written off — but between the
 * expiry sweep and the write-off there is a window where the row still claims stock.
 * Every read projection applies this rule so no screen in that window offers dead
 * meat for sale.
 */
function isBatchExpired(batch, now = new Date()) {
  if (!batch) return false;
  return (
    (batch.expiresAt && new Date(batch.expiresAt) <= now) || batch.status === 'expired'
  );
}

/**
 * The stock list. `lowStock=true` filters to items at or below threshold.
 */
async function listStock({ models, outletId, query = {}, now = new Date() } = {}) {
  const { JhatkaInventoryItem } = models;
  const { variant, batch, kind, lowStock, page = 1, limit = 100 } = query;

  const filter = { outlet: outletId };
  if (variant) filter.variant = variant;
  if (batch) filter.batch = batch;
  if (kind) {
    if (!['raw', 'prepared', 'packaging'].includes(kind)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown kind '${kind}'`);
    }
    filter.kind = kind;
  }

  const items = await JhatkaInventoryItem.find(filter)
    .populate('product', 'name slug hsnCode')
    .populate('variant', 'name sku measurementMode priceBasis unitLabel')
    .populate('batch', 'batchNo expiresAt cutExpiresAt status')
    .sort({ updatedAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), MAX_PAGE_LIMIT))
    .lean();

  const withExpiry = items.map((i) => {
    const expired = isBatchExpired(i.batch, now);
    return {
      ...i,
      availableQty: expired ? 0 : i.availableQty,
      expired,
    };
  });

  const shown =
    lowStock === 'true'
      ? withExpiry.filter((i) => i.onHand <= (i.lowStockThreshold ?? 0) || i.availableQty <= 0)
      : withExpiry;

  return {
    inventory: shown.map(toStockView),
    page: Number(page),
    limit: Number(limit),
  };
}

function toStockView(i) {
  return {
    id: String(i._id),
    kind: i.kind,
    unit: i.unit,
    onHand: i.onHand,
    reserved: i.reserved,
    availableQty: i.availableQty,
    damaged: i.damaged,
    quarantined: i.quarantined,
    reorderLevel: i.reorderLevel,
    lowStockThreshold: i.lowStockThreshold,
    expired: i.expired,
    product: i.product
      ? { id: String(i.product._id), name: i.product.name, hsnCode: i.product.hsnCode }
      : null,
    variant: i.variant
      ? {
          id: String(i.variant._id),
          name: i.variant.name,
          sku: i.variant.sku,
          measurementMode: i.variant.measurementMode,
        }
      : null,
    batch: i.batch
      ? {
          id: String(i.batch._id),
          batchNo: i.batch.batchNo,
          expiresAt: i.batch.expiresAt,
          status: i.batch.status,
        }
      : null,
  };
}

/**
 * One stock line with its most recent movements.
 */
async function stockDetail({ models, itemId, outletId, now = new Date() } = {}) {
  const { JhatkaInventoryItem, JhatkaInventoryMovement } = models;

  const item = await JhatkaInventoryItem.findById(itemId)
    .populate('product', 'name slug hsnCode')
    .populate('variant', 'name sku measurementMode priceBasis unitLabel')
    .populate('batch', 'batchNo expiresAt cutExpiresAt status supplier')
    .lean();

  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Inventory item not found');
  if (String(item.outlet) !== String(outletId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Inventory item not in this outlet');
  }

  const movements = await JhatkaInventoryMovement.find({ inventoryItem: item._id })
    .sort({ movementSeq: -1 })
    .limit(50)
    .lean();

  const expired = isBatchExpired(item.batch, now);

  return {
    item: { ...toStockView({ ...item, availableQty: expired ? 0 : item.availableQty, expired }) },
    movements: movements.map((m) => ({
      id: String(m._id),
      movementType: m.movementType,
      qtyDelta: m.qtyDelta,
      onHandAfter: m.onHandAfter,
      availableAfter: m.availableAfter,
      movementSeq: m.movementSeq,
      reason: m.reason,
      performedByName: m.performedByName,
      createdAt: m.createdAt,
    })),
  };
}

/**
 * Suppliers visible to an outlet: its own business's plus platform-shared ones.
 */
async function listSuppliers({ models, outlet, query = {} } = {}) {
  const { JhatkaSupplier } = models;
  const { status, page = 1, limit = 50 } = query;

  const filter = { $or: [{ business: outlet.business }, { business: { $exists: false } }] };
  if (status) filter.status = status;

  const suppliers = await JhatkaSupplier.find(filter)
    .sort({ name: 1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), MAX_PAGE_LIMIT))
    .lean();

  return {
    suppliers: suppliers.map((s) => ({
      id: String(s._id),
      code: s.code,
      name: s.name,
      contact: s.contact,
      fssai: s.fssai,
      creditTermDays: s.creditTermDays,
      qualityRating: s.qualityRating,
      stats: s.stats,
      status: s.status,
    })),
  };
}

module.exports = {
  listStock,
  toStockView,
  stockDetail,
  listSuppliers,
  isBatchExpired,
  MAX_PAGE_LIMIT,
};