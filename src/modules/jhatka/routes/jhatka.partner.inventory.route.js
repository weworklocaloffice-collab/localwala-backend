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
 * jhatka.partner.inventory.route.js — stock, batches, procurement, recalls. §15.2.
 *
 * ## Thin by design
 *
 * Every mutating handler here delegates: stock and wastage to
 * `jhatka.stock-adjustment.service`, receipts to `jhatka.receipt.service`, recalls to
 * `jhatka.recall.service`, reads to `jhatka.inventory-views.service`. This file keeps
 * auth, capability, validation, tenancy and the response envelope — nothing that
 * decides or persists.
 *
 * ## LITERALS FIRST
 *
 * Every literal path precedes `/:id` (§15.1). Express matches in registration order,
 * so a `/:id` declared above `/batches` swallows it — which is exactly how two
 * endpoints once went unreachable with a 500 from ObjectId casting instead of a 404.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaAuth, requireActiveOutlet } = require('../middlewares/jhatka.tenant');
const profileService = require('../services/jhatka.profile.service');
const {
  JhatkaOutlet,
  JhatkaInventoryItem,
  JhatkaInventoryMovement,
  JhatkaBatch,
  JhatkaBatchAllocation,
  JhatkaWastage,
  JhatkaRecall,
  JhatkaSupplier,
  JhatkaSupplierDocument,
  JhatkaPurchaseOrder,
  JhatkaProcurementReceipt,
  JhatkaOrder,
  JhatkaCompliance,
} = require('../../../models');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.partner.inventory.validation');
const receiptService = require('../services/jhatka.receipt.service');
const stockAdjustment = require('../services/jhatka.stock-adjustment.service');
const recallService = require('../services/jhatka.recall.service');
const complianceGate = require('../services/jhatka.compliance-gate.service');
const inventoryViews = require('../services/jhatka.inventory-views.service');

const router = express.Router();

const invAuth = [jhatkaAuth(), requireActiveOutlet];

/** Pairs for every route below. Never a bare appAuth: tenancy must always apply. */
const cap = (capability) => async (req, res, next) => {
  try {
    profileService.assertCan(req.role, capability);
    return next();
  } catch (error) {
    return next(error);
  }
};

const nextNumber = (prefix) => {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  return `${prefix}${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
};

// ===========================================================================
// LITERALS FIRST — every one of these must precede `/:id`. §15.1
// ===========================================================================

/**
 * GET /jhatka/partner/inventory
 *
 * The stock list. `lowStock=true` filters to items at or below `lowStockThreshold`.
 * An EXPIRED batch reports zero available regardless of `onHand` (§5) — the stock
 * physically exists but cannot be sold, so counting it is how a shop sells meat
 * that should have been binned. That rule lives in the views service so every
 * screen showing the same row agrees.
 */
router.get('/', ...invAuth, cap('inventory.read'), validate(V.inventoryListQuery), async (req, res, next) => {
  try {
    return res.json(await inventoryViews.listStock({
      models: { JhatkaInventoryItem },
      outletId: req.outletId,
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
});

router.get('/batches', ...invAuth, cap('batches.read'), validate(V.batchListQuery), async (req, res, next) => {
  try {
    const result = await stockAdjustment.listBatches({
      models: { JhatkaBatch },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/inventory/recalls
 */
router.get('/recalls', ...invAuth, cap('batches.read'), validate(V.recallListQuery), async (req, res, next) => {
  try {
    const result = await stockAdjustment.listRecalls({
      models: { JhatkaRecall },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/batches/:batch/quarantine
 *
 * -14: quarantining your own stock must never be a solo decision, so the role gate
 * excludes order_staff and inventory_staff by construction — only compliance_officer,
 * manager and owner hold `batches.quarantine`.
 */
router.post('/batches/:batch/quarantine', ...invAuth, cap('batches.quarantine'), validate(V.batchParam), validate(V.reasonBody), async (req, res, next) => {
  try {
    const result = await stockAdjustment.quarantineBatch({
      models: { JhatkaBatch, JhatkaInventoryItem, JhatkaInventoryMovement, JhatkaWastage },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      assertCan: profileService.assertCan,
      role: req.role,
      batch: req.params.batch,
      reason: req.body.reason,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/batches/:batch/release
 */
router.post('/batches/:batch/release', ...invAuth, cap('batches.release'), validate(V.batchParam), validate(V.reasonBody), async (req, res, next) => {
  try {
    const result = await stockAdjustment.releaseBatch({
      models: { JhatkaBatch, JhatkaInventoryItem, JhatkaInventoryMovement },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      assertCan: profileService.assertCan,
      role: req.role,
      batch: req.params.batch,
      reason: req.body.reason,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/adjust
 *
 * Manual correction — a count, a spillage, a data-entry fix.
 *
 * `movementType` is CHOSEN BY THE CALLER from the enum, not inferred, because
 * `ADJUSTMENT` and `COUNT_ADJUSTMENT` mean different things to a variance report:
 * one is an unexplained change, the other is the expected result of counting.
 *
 * OWNER-ONLY for anything that reduces stock without a linked cause: `wastage.adjust`
 * is in `OWNER_ONLY`, because an adjustment is the easiest way to move stock out of
 * a shop without a wastage record, and wastage feeds the settlement.
 */
router.post('/adjust', ...invAuth, cap('inventory.adjust'), validate(V.adjustBody), async (req, res, next) => {
  try {
    // Transaction, ledger sequencing and the negative-stock guard live in the service.
    // This route is now authorize -> delegate -> respond.
    const result = await stockAdjustment.adjustStock({
      models: { JhatkaInventoryItem, JhatkaInventoryMovement },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      assertCan: profileService.assertCan,
      role: req.role,
      ...(req.body || {}),
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/wastage
 *
 * Wastage is a CAUSE, and it reduces stock. It is deliberately not the same thing
 * as an adjustment: wastage carries `cause` and optionally an `order`, so a variance
 * report can separate trim (routine) from theft (a cause that should not exist).
 *
 * Writes the `JhatkaWastage` record AND the `WASTAGE` movement in one transaction,
 * because wastage that exists without the stock movement is a claim, and stock that
 * moved without the wastage record is unaccounted shrinkage.
 */
router.post('/wastage', ...invAuth, cap('wastage.record'), validate(V.wastageBody), async (req, res, next) => {
  try {
    const result = await stockAdjustment.recordWastage({
      models: {
        JhatkaInventoryItem,
        JhatkaInventoryMovement,
        JhatkaWastage,
        JhatkaBatch,
        JhatkaOutlet,
      },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      assertCan: profileService.assertCan,
      role: req.role,
      nextNumber,
      ...(req.body || {}),
    });
    return res.status(httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/recalls
 *
 * -11: a recall finds affected customers from the `{batch:1}` index ALONE. This
 * route records the recall and the batch freeze; the fan-out runs post-commit in
 * the service (B8) — a recall that waits for somebody to remember it is not a
 * recall.
 */
router.post('/recalls', ...invAuth, cap('recalls.create'), async (req, res, next) => {
  try {
    // The record, the batch flip, and one ledger row per stock line all commit
    // together now. See jhatka.recall.service.js for why a half-applied recall is
    // worse than no recall at all.
    const result = await recallService.openRecall({
      models: {
        JhatkaBatch,
        JhatkaInventoryItem,
        JhatkaInventoryMovement,
        JhatkaRecall,
        JhatkaOutlet,
        JhatkaBatchAllocation,
        JhatkaOrder,
      },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      nextNumber,
      ...(req.body || {}),
    });
    return res.status(httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/recalls/:recall/close
 */
router.post('/recalls/:recall/close', ...invAuth, cap('recalls.create'), validate(V.recallParam), async (req, res, next) => {
  try {
    return res.json(
      await recallService.closeRecall({
        models: { JhatkaRecall },
        outletId: req.outletId,
        recall: req.params.recall,
      })
    );
  } catch (error) {
    return next(error);
  }
});

// ===========================================================================
// PROCUREMENT
// ===========================================================================

/** GET /jhatka/partner/inventory/suppliers */
/** GET /jhatka/partner/inventory/suppliers */
router.get('/suppliers', ...invAuth, cap('suppliers.read'), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId).select('business').lean();
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    return res.json(await inventoryViews.listSuppliers({
      models: { JhatkaSupplier },
      outlet,
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
});

router.get('/purchase-orders', ...invAuth, cap('procurement.read'), validate(V.poListQuery), async (req, res, next) => {
  try {
    const result = await stockAdjustment.listPurchaseOrders({
      models: { JhatkaPurchaseOrder },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/purchase-orders/:po/place
 *
 * Draft → placed. A PO below this cannot be amended, because suppliers act on it.
 */
router.post('/purchase-orders/:po/place', ...invAuth, cap('procurement.manage'), validate(V.poParam), async (req, res, next) => {
  try {
    const result = await stockAdjustment.placePurchaseOrder({
      models: { JhatkaPurchaseOrder },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      assertCan: profileService.assertCan,
      role: req.role,
      po: req.params.po,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/inventory/receipts
 */
router.get('/receipts', ...invAuth, cap('procurement.read'), validate(V.receiptListQuery), async (req, res, next) => {
  try {
    const result = await stockAdjustment.listReceipts({
      models: { JhatkaProcurementReceipt },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/receipts
 *
 * Receive stock. Creates a DRAFT receipt whose lines carry the quality decision;
 * stock only moves when the receipt is POSTED (`/receipts/:receipt/post`), so a
 * delivery can be inspected before it is counted as stock.
 *
 * -4: a hard quality fail auto-rejects and a soft one queues for a human, via
 * `decideLineQuality` — which deliberately does NOT auto-reject on smell, colour,
 * shortfall or excess transit, because an outlet that opted into binning warm
 * deliveries did not opt into binning every short one.
 */
/**
 * POST /jhatka/partner/inventory/receipts
 *
 * Receive stock. Creates a DRAFT receipt whose lines carry the quality decision;
 * stock only moves when the receipt is POSTED (`/receipts/:receipt/post`), so a
 * delivery can be inspected before it is counted as stock.
 *
 * §4: a hard quality fail auto-rejects and a soft one queues for a human, via
 * `decideLineQuality` — which deliberately does NOT auto-reject on smell, colour,
 * shortfall or excess transit, because an outlet that opted into binning warm
 * deliveries did not opt into binning every short one.
 *
 * The verdict math lives in the receipt service; this handler keeps auth,
 * tenancy and the envelope.
 */
router.post('/receipts', ...invAuth, cap('procurement.manage'), validate(V.receiptBody), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId).lean();
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    // NOTE: no compliance gate here. A draft receipt moves no stock and creates
    // no payable — it is a record of a truck that arrived, and refusing to record
    // an arrival does not un-arrive it. The gate belongs at POST time, where money
    // and stock actually move (see the /post handler below).
    const { receiptResponse } = await receiptService.createDraftReceipt({
      models: { JhatkaPurchaseOrder, JhatkaProcurementReceipt },
      outlet,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
      nextNumber,
    });

    return res.status(httpStatus.CREATED).json({ receipt: receiptResponse });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/inventory/receipts/:receipt/post
 *
 * The posting. Creates one `JhatkaBatch` per accepted line and the matching stock
 * movements, all in ONE transaction — §4/§5's "reverse the batch first" rule exists
 * because a batch without its stock movement, or stock without its batch, makes a
 * recall unanswerable.
 *
 * Idempotent: a POSTED receipt cannot be posted again (Phase 4 DoD — "a receipt
 * cannot be paid for twice").
 *
 * §12.2 gates here, not at draft creation: posting moves stock and creates the
 * payable, so a lapsed outlet or supplier must be refused at THIS step. A draft is
 * a record of arrival; a post is a commercial act.
 */
router.post('/receipts/:receipt/post', ...invAuth, cap('procurement.manage'), validate(V.receiptParam), async (req, res, next) => {
  try {
    const receipt = await JhatkaProcurementReceipt.findOne({
      _id: req.params.receipt,
      outlet: req.outletId,
    });
    if (!receipt) throw new ApiError(httpStatus.NOT_FOUND, 'Receipt not found for this outlet');

    // Posting twice is a 409, not a 500. The earlier version reported it as a crash
    // purely because the test harness read `err.status` while `ApiError` stores
    // `statusCode` — a correct refusal made to look like a server fault.
    if (receipt.status === 'posted') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This receipt is already posted',
        true,
        '',
        { code: 'RECEIPT_ALREADY_POSTED', postedAt: receipt.postedAt }
      );
    }
    if (receipt.status === 'cancelled') {
      throw new ApiError(httpStatus.CONFLICT, 'A cancelled receipt cannot be posted');
    }

    const outlet = await JhatkaOutlet.findById(req.outletId).lean();
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    // §12.2, supplier row: an expired supplier document blocks new receipts FROM THAT
    // SUPPLIER — not the outlet, not the vertical. One bad supplier must not stop
    // an outlet. `receipt.supplier` exists here (unlike at draft creation, where the
    // receipt does not exist yet and the gate reads the body's supplier instead).
    await complianceGate.assertJhatkaOperational({ outlet, operation: 'post_receipt', models: { JhatkaCompliance } });
    await complianceGate.assertSupplierReceivable({ supplierId: receipt.supplier, models: { JhatkaSupplier, JhatkaSupplierDocument } });

    // Batches, stock, ledger, allocations and the PO advance all happen inside ONE
    // transaction in the service, so a receipt can never be half-posted.
    const result = await receiptService.postReceipt({
      receipt,
      outlet,
      actor: { _id: req.user._id, name: req.user.name },
      body: req.body,
      models: {
        JhatkaBatch,
        JhatkaInventoryItem,
        JhatkaInventoryMovement,
        JhatkaBatchAllocation,
        JhatkaPurchaseOrder,
        JhatkaProcurementReceipt,
      },
      nextNumber,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get('/movements', ...invAuth, cap('inventory.read'), validate(V.movementListQuery), async (req, res, next) => {
  try {
    const result = await stockAdjustment.listMovements({
      models: { JhatkaInventoryMovement },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

// ===========================================================================
// `:id` — MUST BE LAST. Every literal above would be swallowed by it. -15.1
// ===========================================================================

/**
 * GET /jhatka/partner/inventory/:id
 *
 * One stock line, with its most recent movements.
 *
 * LAST BY DESIGN. This route was previously declared above `/batches` and
 * `/recalls`, which made both unreachable.
 */
/**
 * GET /jhatka/partner/inventory/:id
 *
 * One stock line, with its most recent movements.
 *
 * LAST BY DESIGN. This route was previously declared above `/batches` and
 * `/recalls`, which made both unreachable.
 */
router.get('/:id', ...invAuth, cap('inventory.read'), validate(V.itemParam), async (req, res, next) => {
  try {
    return res.json(await inventoryViews.stockDetail({
      models: { JhatkaInventoryItem, JhatkaInventoryMovement },
      itemId: req.params.id,
      outletId: req.outletId,
    }));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
