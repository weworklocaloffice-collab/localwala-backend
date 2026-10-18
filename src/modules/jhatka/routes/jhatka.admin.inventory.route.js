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
 * jhatka.admin.inventory.route.js — B1.4
 *
 * Cross-outlet view of stock, batches and recalls, plus two GET-only consoles.
 *
 * ## Schema verified against `docs/JHATKA-ADMIN-SCHEMA-SURVEY.md`
 *
 *   JhatkaBatch  required : batchNo, outlet, business, supplier, procurementReceipt,
 *                           receiptItem, product, rawSku, unit, receivedQty,
 *                           receivedAt, expiresAt
 *                unit     : GRAM | KG | PIECE | DOZEN | TIER
 *                status   : source | opened | consumed | expired | quarantined | discarded
 *   JhatkaRecall required : recallNo, batch, outlet, business, severity, reason,
 *                           initiatedBy, initiatedAt
 *                severity : advisory | withdraw | recall
 *                status   : open | notifying | closed
 *
 * ## The recall endpoint is the important one
 *
 * -11's promise is that a bad batch can be traced to the customers who ate it. That
 * query is `{JhatkaBatchAllocation: {batch}}` — and since B6, an order line may hold
 * SEVERAL allocations, so the affected set is a UNION across them, not one lookup.
 * `affectedOrders` below is that union, and it is the reason allocation work mattered
 * before recall mattered.
 *
 * ## These consoles are READ-ONLY, and that is structural
 *
 * A console that could write would be a second path to the same mutation with weaker
 * guardrails — the exact hazard the plan names for GET-only surfaces. Corrections go
 * through `POST /inventory/adjust` (partner) or the expiry write-off (cron), both of
 * which write a ledger movement. A console that silently changed a balance without one
 * would make the ledger a liar.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const {
  JhatkaBatch,
  JhatkaBatchAllocation,
  JhatkaInventoryItem,
  JhatkaInventoryMovement,
  JhatkaRecall,
  JhatkaOrder,
  JhatkaWastage,
} = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

const BATCH_STATUS = ['source', 'opened', 'consumed', 'expired', 'quarantined', 'discarded'];
const RECALL_SEVERITY = ['advisory', 'withdraw', 'recall'];

/** Only `source`/`opened` batches are sellable. */
const LIVE_BATCH_STATUS = ['source', 'opened'];

/**
 * GET /v1/jhatka/admin/inventory/batches
 *
 * Cross-outlet batch search. An expiry sweep or a recall starts here.
 */
router.get('/inventory/batches', webAuth('jhatka_inventory_read'), async (req, res, next) => {
  try {
    const { status, outlet, sku, expiringInDays, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (outlet) query.outlet = outlet;
    if (sku) query.rawSku = String(sku).toUpperCase();
    if (expiringInDays) {
      const days = Math.min(365, Math.max(0, Number(expiringInDays) || 0));
      query.expiresAt = { $lte: new Date(Date.now() + days * 86400000) };
    }

    const [batches, total] = await Promise.all([
      JhatkaBatch.find(query)
        .populate('outlet', 'name outletCode')
        .populate('product', 'name')
        .sort({ expiresAt: 1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Math.min(200, Math.max(1, Number(limit))))
        .lean(),
      JhatkaBatch.countDocuments(query),
    ]);

    const now = Date.now();

    return res.json({
      batches: batches.map((b) => ({
        ...b,
        isExpired: b.expiresAt ? new Date(b.expiresAt).getTime() < now : false,
        isSellable: LIVE_BATCH_STATUS.includes(b.status) && (!b.expiresAt || new Date(b.expiresAt).getTime() >= now),
        daysToExpiry: b.expiresAt
          ? Math.ceil((new Date(b.expiresAt).getTime() - now) / 86400000)
          : null,
      })),
      page: Number(page),
      limit: Number(limit),
      total,
      count: batches.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/inventory/stock
 *
 * Per-item balances across every outlet. Computed `sellable` rather than trusting
 * `availableQty`, because an item's batch may be expired or quarantined while the item
 * still says it is available — that mismatch is precisely what B7 existed to stop, and
 * a console that hid it would defeat the purpose.
 */
router.get('/inventory/stock', webAuth('jhatka_inventory_read'), async (req, res, next) => {
  try {
    const { outlet, variant, kind, lowOnly } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (variant) query.variant = variant;
    if (kind) query.kind = kind;

    const items = await JhatkaInventoryItem.find(query)
      .populate('outlet', 'name outletCode')
      .populate('batch', 'batchNo expiresAt status')
      .sort({ outlet: 1 })
      .limit(500)
      .lean();

    const now = Date.now();
    const decorated = items.map((i) => {
      const batchExpired = i.batch?.expiresAt ? new Date(i.batch.expiresAt).getTime() < now : false;
      const batchBlocked = i.batch?.status && !LIVE_BATCH_STATUS.includes(i.batch.status);
      return {
        ...i,
        batchExpired,
        batchBlocked,
        // The honest figure: what a customer can actually be sold right now.
        sellable: batchExpired || batchBlocked ? 0 : i.availableQty,
      };
    });

    const filtered = lowOnly === 'true'
      ? decorated.filter((i) => i.sellable <= (i.lowStockThreshold ?? 0))
      : decorated;

    return res.json({
      items: filtered,
      count: filtered.length,
      // Surfaced because it means stock exists that cannot be sold — the exact
      // condition -5 calls a write-off.
      unsellableCount: decorated.filter((i) => i.availableQty > 0 && i.sellable === 0).length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/inventory/batches/:batch/quarantine
 *
 * Quarantine writes a `RECALL_FREEZE` movement, so the freeze is in the ledger rather
 * than only in a status flag. A quarantine with no movement is indistinguishable from
 * one that was lifted.
 */
router.post('/inventory/batches/:batch/quarantine', webAuth('jhatka_inventory_read'), validate(V.namedParam('batch')), async (req, res, next) => {
  try {
    const batch = await JhatkaBatch.findById(req.params.batch);
    if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Batch not found');
    if (batch.status === 'quarantined') {
      throw new ApiError(httpStatus.CONFLICT, 'This batch is already quarantined', true, '', {
        code: 'ALREADY_QUARANTINED',
      });
    }
    if (!reasonGiven(req.body?.reason)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'A quarantine reason is required — -11 requires a recall to be explainable',
        true, '', { code: 'REASON_REQUIRED' }
      );
    }

    batch.status = 'quarantined';
    batch.quarantinedAt = new Date();
    batch.quarantineReason = req.body.reason;
    await batch.save();

    // Freeze every item backed by this batch.
    await JhatkaInventoryItem.updateMany(
      { batch: batch._id },
      { $inc: { quarantined: 1 } }
    );

    await writeRecallFreeze(batch, req.user, 'quarantine');

    return res.json({ batch: batch.toObject() });
  } catch (error) {
    return next(error);
  }
});

/** POST /v1/jhatka/admin/inventory/batches/:batch/release */
router.post('/inventory/batches/:batch/release', webAuth('jhatka_inventory_read'), validate(V.namedParam('batch')), async (req, res, next) => {
  try {
    const batch = await JhatkaBatch.findById(req.params.batch);
    if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Batch not found');
    if (batch.status !== 'quarantined') {
      throw new ApiError(httpStatus.CONFLICT, `Batch is ${batch.status}, not quarantined`);
    }

    batch.status = 'opened';
    batch.releasedAt = new Date();
    await batch.save();

    await JhatkaInventoryItem.updateMany(
      { batch: batch._id, quarantined: { $gt: 0 } },
      { $inc: { quarantined: -1 } }
    );

    return res.json({ batch: batch.toObject(), released: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/inventory/recalls
 *
 * -11. Creates the recall AND computes the affected customer set in one call, because
 * the second question ("who ate this?") is the only reason the first exists.
 *
 * `severity`:
 *   advisory — a note. Stock keeps selling.
 *   withdraw — stop selling. Freezes the batch.
 *   recall   — withdraw PLUS the customer set is returned for notification.
 */
router.post('/inventory/recalls', webAuth('jhatka_recall_manage'), async (req, res, next) => {
  try {
    const { batch: batchId, severity, reason } = req.body || {};

    if (!batchId) throw new ApiError(httpStatus.BAD_REQUEST, 'batch is required');
    if (!RECALL_SEVERITY.includes(severity)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `severity must be one of ${RECALL_SEVERITY.join(' | ')}`,
        true, '', { code: 'INVALID_SEVERITY', allowed: RECALL_SEVERITY, received: severity }
      );
    }
    if (!reasonGiven(reason)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required', true, '', {
        code: 'REASON_REQUIRED',
      });
    }

    const batch = await JhatkaBatch.findById(batchId);
    if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Batch not found');

    const existing = await JhatkaRecall.findOne({ batch: batch._id, status: { $ne: 'closed' } });
    if (existing) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'An open recall already exists for this batch',
        true, '',
        { code: 'RECALL_EXISTS', recallId: String(existing._id) }
      );
    }

    // THE POINT OF -11: who is affected.
    const affected = await affectedOrdersForBatch(batch._id);

    const recall = await JhatkaRecall.create({
      recallNo: nextRecallNo(),
      batch: batch._id,
      outlet: batch.outlet,
      business: batch.business,
      supplier: batch.supplier || undefined,
      severity,
      reason,
      status: 'open',
      initiatedBy: req.user._id,
      initiatedByName: req.user.name,
      initiatedAt: new Date(),
      // The REAL model shape. An earlier draft wrote `affectedOrderCount` /
      // `affectedCustomerCount` / `notes`, none of which exist — Mongoose would have
      // dropped all three silently and the recall would have carried no customer set
      // at all, which is the entire purpose of -11.
      affectedOrderItems: {
        queriedAt: new Date(),
        count: affected.orderItemCount,
        // A SAMPLE, not the full set: a batch can be on tens of thousands of order
        // lines and embedding them all would make the recall document unreadable and
        // slow to open. The authoritative set is re-queried by `affectedOrderItems`.
        sampleOrderItemIds: affected.sampleOrderItemIds,
      },
      // One row per CUSTOMER, with their orders nested, because -5.4 counts
      // notifications per person, not per order. Each nested entry is an OBJECT
      // `{order, deliveredAt}`, not a bare id — the model requires `order` inside it,
      // and a bare id fails with "Path `order` is required" from two levels down.
      affectedCustomers: affected.customers.map((c) => ({
        customer: c.customer,
        orders: c.orders,
      })),
    });

    // `advisory` deliberately does NOT freeze. An advisory that quietly stopped
    // selling stock would make the severity label meaningless.
    if (severity !== 'advisory') {
      batch.status = 'quarantined';
      batch.quarantinedAt = new Date();
      batch.quarantineReason = `Recall ${recall.recallNo}: ${reason}`;
      await batch.save();

      await JhatkaInventoryItem.updateMany({ batch: batch._id }, { $inc: { quarantined: 1 } });
      await writeRecallFreeze(batch, req.user, `recall:${recall.recallNo}`);
    }

    return res.status(201).json({
      recall: recall.toObject(),
      frozen: severity !== 'advisory',
      affectedOrders: affected.orders,
      affectedCustomers: affected.customers,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/inventory/recalls
 *
 * Declared AFTER the POST above; both are fine, but this one is declared before any
 * `/:recall` route would be, per Express's first-match rule.
 */
router.get('/inventory/recalls', webAuth('jhatka_recall_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.severity) query.severity = req.query.severity;
    if (req.query.outlet) query.outlet = req.query.outlet;

    const recalls = await JhatkaRecall.find(query)
      .populate('outlet', 'name outletCode')
      .populate('batch', 'batchNo rawSku expiresAt')
      .sort({ initiatedAt: -1 })
      .limit(200)
      .lean();

    return res.json({ recalls, count: recalls.length });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/inventory/movements
 *
 * GET-ONLY CONSOLE. The ledger is the proof a balance is right; if this could write,
 * it could make that proof circular. Corrections are new movements via the partner
 * adjust endpoint.
 */
router.get('/inventory/movements', webAuth('jhatka_inventory_movements'), async (req, res, next) => {
  try {
    const { outlet, movementType, from, to, page = 1, limit = 100 } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (movementType) query.movementType = movementType;
    if (from || to) {
      query.movementSeq = query.movementSeq || {};
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lt = new Date(to);
    }

    const [movements, total] = await Promise.all([
      JhatkaInventoryMovement.find(query)
        .populate('inventoryItem', 'product variant batch unit')
        .sort({ createdAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Math.min(500, Math.max(1, Number(limit))))
        .lean(),
      JhatkaInventoryMovement.countDocuments(query),
    ]);

    return res.json({ movements, page: Number(page), limit: Number(limit), total, count: movements.length });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/inventory/wastage
 *
 * GET-ONLY CONSOLE. The loss figures settlement sums; an admin console that could
 * edit them would let the margin be rewritten after the fact.
 */
router.get('/inventory/wastage', webAuth('jhatka_inventory_read'), async (req, res, next) => {
  try {
    const { outlet, cause, from, to, limit = 200 } = req.query;

    const query = {};
    if (outlet) query.outlet = outlet;
    if (cause) query.cause = cause;
    if (from || to) {
      query.occurredAt = {};
      if (from) query.occurredAt.$gte = new Date(from);
      if (to) query.occurredAt.$lt = new Date(to);
    }

    const wastages = await JhatkaWastage.find(query)
      .populate('outlet', 'name outletCode')
      .populate('batch', 'batchNo rawSku')
      .sort({ occurredAt: -1 })
      .limit(Math.min(500, Math.max(1, Number(limit))))
      .lean();

    // Inherent vs avoidable is the split -5.6 asks for, computed here so the console
    // and settlement cannot disagree about it.
    const byCause = {};
    for (const w of wastages) {
      byCause[w.cause] = (byCause[w.cause] || 0) + (w.qty || 0);
    }

    return res.json({
      wastages,
      count: wastages.length,
      byCause,
      inherentQty: wastages.filter((w) => w.cause === 'TRIM').reduce((s, w) => s + (w.qty || 0), 0),
      avoidableQty: wastages.filter((w) => w.cause !== 'TRIM').reduce((s, w) => s + (w.qty || 0), 0),
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A recall/quarantine reason must be at least 10 characters.
 *
 * Matching `JhatkaRecall.reason`'s own validator, which says: *"reason must be at
 * least 10 characters — this is the document that explains a food-safety action."*
 * The route check used to be a bare non-empty test, so "x" reached the model and came
 * back as a ValidationError naming an internal constraint. A one-character reason is
 * not a reason.
 */
const reasonGiven = (r) => typeof r === 'string' && r.trim().length >= 10;

let _recallSeq = 0;
function nextRecallNo() {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  _recallSeq = (_recallSeq + 1) % 1000;
  return `RC${stamp}${String(_recallSeq).padStart(3, '0')}`;
}

/**
 * Every order, order line and customer touched by a batch, across ALL its allocations.
 *
 * Since B6 one order line can carry several allocations, so this unions them — taking
 * only the first allocation would miss every customer after the first batch in a split.
 *
 * @returns {{orders: Array, customers: Array, orderItemCount: number,
 *            sampleOrderItemIds: Array}}
 */
async function affectedOrdersForBatch(batchId, sampleSize = 50) {
  const allocations = await JhatkaBatchAllocation.find({ batch: batchId })
    .select('order orderItem')
    .lean();

  const orderIds = [...new Set(allocations.map((a) => String(a.order)).filter(Boolean))];
  const orderItemIds = [...new Set(allocations.map((a) => String(a.orderItem)).filter(Boolean))];

  if (!orderIds.length) {
    return { orders: [], customers: [], orderItemCount: 0, sampleOrderItemIds: [] };
  }

  const orders = await JhatkaOrder.find({ _id: { $in: orderIds } })
    .select('orderNo customer customerName outlet lifecycle deliveredAt')
    .lean();

  return {
    orders: orders.map((o) => ({
      id: String(o._id),
      orderNo: o.orderNo,
      customer: String(o.customer),
      outlet: String(o.outlet),
      lifecycle: o.lifecycle,
      deliveredAt: o.deliveredAt,
    })),
    // De-duplicated: one customer with three recalled orders is notified once, not
    // three times, but must still be told about all of them.
    customers: [...new Map(
      orders.map((o) => [String(o.customer), {
        customer: o.customer,
        // `{order, deliveredAt}` per the model's nested shape.
        orders: orders
          .filter((x) => String(x.customer) === String(o.customer))
          .map((x) => ({ order: x._id, deliveredAt: x.deliveredAt || undefined })),
        orderNos: orders
          .filter((x) => String(x.customer) === String(o.customer))
          .map((x) => x.orderNo),
      }])
    ).values()],
    orderItemCount: orderItemIds.length,
    // SAMPLE only — see the note at the create site. A batch on a popular SKU can be
    // on tens of thousands of lines and embedding them all is not viable.
    sampleOrderItemIds: orderItemIds.slice(0, sampleSize),
  };
}

/** Write the RECALL_FREEZE movement so a freeze is provable, not just flagged. */
async function writeRecallFreeze(batch, user, reason) {
  const items = await JhatkaInventoryItem.find({ batch: batch._id }).lean();
  for (const item of items) {
    await JhatkaInventoryMovement.create({
      outlet: batch.outlet,
      inventoryItem: item._id,
      kind: item.kind,
      movementType: 'RECALL_FREEZE',
      qtyDelta: 0,
      reservedDelta: 0,
      onHandAfter: item.onHand,
      reservedAfter: item.reserved,
      availableAfter: 0,
      reason,
      referenceType: 'JhatkaBatch',
      referenceId: batch._id,
      movementSeq: (item.movementSeq || 0) + 1,
      performedBy: user._id,
      performedByName: user.name,
    });
    await JhatkaInventoryItem.updateOne({ _id: item._id }, { movementSeq: (item.movementSeq || 0) + 1 });
  }
}

module.exports = router;
module.exports.affectedOrdersForBatch = affectedOrdersForBatch;
module.exports.BATCH_STATUS = BATCH_STATUS;