/**
 * jhatka.receipt.service.js — receipt creation, ledger primitives, and posting.
 *
 * ## Why this exists
 *
 * `POST /jhatka/partner/inventory/receipts` is 148 lines of inline logic for
 * quality evaluation, line verdicts, totals, and receipt document creation. Moving
 * the receipt‑document‑building out of the route keeps the handler thin and makes
 * the same logic reusable (the `/receipts/:receipt/post` route also needs the
 * receipt document structure).
 *
 * ## The ledger primitives live here, and only here
 *
 * `nextSeq` + `applyMovement` are the balance primitives for the whole vertical:
 * every stock write (adjust, wastage, receipt posting, recall freeze sequencing)
 * goes through them. They previously existed in BOTH this file and the inventory
 * route, which is precisely the "two paths disagree about what stock is on hand"
 * failure. One implementation now.
 *
 * ## Notes
 *
 * - Quality evaluation (`evaluateQuality`, `decideLineQuality`) is NOT moved here;
 *   it stays in the route because those helpers depend on the outlet's
 *   `qualityPolicy` which is loaded by the route middleware.
 * - The receipt document structure is the same shape returned to the caller, so
 *   the `/receipts/:receipt/post` route can reuse it.
 */
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { withTransaction } = require('../utils/transaction');
const { evaluateQuality, decideLineQuality } = require('../utils/quality.gate');

/**
 * Build a DRAFT receipt from a truck's lines: validate, quality-verdict, total.
 *
 * ## Why the verdict lives here and not in the route
 *
 * The route used to map each line through `evaluateQuality` + `decideLineQuality`
 * inline (~50 lines), which meant the ONLY caller was HTTP. The quality gate is a
 * pure function of (policy, readings, quantities) — no request, no session — so
 * there is no reason it cannot be called directly, and every reason it should be:
 * the verdict math is where a mis-graded delivery becomes either saleable meat or
 * a bin, and untestable verdict math is how warm chicken gets accepted.
 *
 * ## Money units
 *
 * `unitPrice` arrives in RUPEES (client money), `acceptedQty.value` is a quantity,
 * so `amount` is rupees — matching the moneyField setters on the receipt lines.
 * No paise conversion here: the 100x hazard lives at the moneyField boundary, and
 * this function never crosses it (the document constructor does, via its setters).
 *
 * @returns {Promise<{receipt: object, receiptResponse: object}>} unsaved document + DTO
 */
async function createDraftReceipt({
  models, outlet, body = {}, actor, nextNumber,
} = {}) {
  const { JhatkaPurchaseOrder, JhatkaProcurementReceipt } = models;
  const { purchaseOrder, supplier, supplierInvoiceRef, lines, vehicleNo, receivedAt, note } = body;

  if (!supplier) throw new ApiError(httpStatus.BAD_REQUEST, 'supplier is required');
  if (!Array.isArray(lines) || !lines.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'lines is required');
  }
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

  if (purchaseOrder) {
    // Scoped by outlet so a receipt cannot be booked against somebody else's PO.
    // A 403, not a 404: the PO existing is not this outlet's business.
    // Only existence is checked — the receipt stores the id, and the linkage is by
    // reference, not by snapshot.
    const poExists = await JhatkaPurchaseOrder.exists({
      _id: purchaseOrder,
      outlet: outlet._id,
    });
    if (!poExists) throw new ApiError(httpStatus.FORBIDDEN, 'Purchase order not in this outlet');
  }

  const verdictLines = lines.map((l, i) => {
    if (!l.product) throw new ApiError(httpStatus.BAD_REQUEST, `lines[${i}].product is required`);
    if (!l.rawSku) throw new ApiError(httpStatus.BAD_REQUEST, `lines[${i}].rawSku is required`);
    if (!l.receivedQty || l.receivedQty.value === undefined) {
      throw new ApiError(httpStatus.BAD_REQUEST, `lines[${i}].receivedQty.value is required`);
    }
    if (!l.unitPrice) throw new ApiError(httpStatus.BAD_REQUEST, `lines[${i}].unitPrice is required`);

    const verdict = evaluateQuality({
      policy: outlet.qualityPolicy,
      readings: l.readings || {},
      receivedQty: l.receivedQty.value,
      expectedQty: l.expectedQty,
    });
    const decision = decideLineQuality(
      verdict,
      l.rejectionReasons || [],
      outlet.qualityPolicy?.autoRejectOnTemperature !== false
    );

    const unit = l.receivedQty.unit;
    const acceptedQty =
      decision.qualityStatus === 'rejected'
        ? { value: 0, unit }
        : decision.qualityStatus === 'partially_accepted'
          ? { value: Math.max(0, (l.acceptedQty?.value ?? l.receivedQty.value)), unit }
          : { value: l.receivedQty.value, unit };
    const rejectedQty = {
      value: Math.max(0, l.receivedQty.value - acceptedQty.value),
      unit,
    };

    const amount = Math.round(l.unitPrice * acceptedQty.value);

    return {
      product: l.product,
      rawSku: l.rawSku,
      supplierBatchRef: l.supplierBatchRef,
      receivedQty: l.receivedQty,
      acceptedQty,
      rejectedQty,
      unitPrice: l.unitPrice,
      amount,
      rejectedValue: Math.round(l.unitPrice * rejectedQty.value),
      readings: l.readings,
      qualityStatus: decision.qualityStatus,
      rejectionReasons: l.rejectionReasons,
      qualityNotes: l.qualityNotes,
      payability: decision.qualityStatus === 'rejected' ? 'disputed' : 'pending',
      note: l.note,
    };
  });

  const totalReceived = verdictLines.reduce((s, l) => s + l.receivedQty.value, 0);
  const totalAccepted = verdictLines.reduce((s, l) => s + l.acceptedQty.value, 0);
  const totalRejected = verdictLines.reduce((s, l) => s + l.rejectedQty.value, 0);
  const totalAcceptedValue = verdictLines.reduce((s, l) => s + l.amount, 0);

  const { receipt, receiptResponse } = buildReceiptDocument({
    verdictLines,
    totalReceived,
    totalAccepted,
    totalRejected,
    totalAcceptedValue,
    outlet,
    supplier,
    purchaseOrder,
    supplierInvoiceRef,
    receivedAt,
    vehicleNo,
    note,
    nextNumber,
  });

  const receiptError = receipt.validateSync();
  if (receiptError) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Receipt failed validation', true, '', {
      fields: Object.keys(receiptError.errors),
    });
  }
  await receipt.save();

  return { receipt, receiptResponse };
}

/**
 * Build the receipt document from evaluated lines and totals.
 *
 * @param {object} p
 * @param {Array} p.verdictLines   evaluated line objects (already processed by
 *                               the route's quality gate)
 * @param {number} p.totalReceived total received qty
 * @param {number} p.totalAccepted total accepted qty
 * @param {number} p.totalRejected total rejected qty
 * @param {number} p.totalAcceptedValue total accepted value in rupees
 * @param {number} p.rejectionRatePct rejection percentage
 * NOTE: totalRejectedValue is recomputed from verdictLines, not accepted as input.
 * @param {object} p.outlet        lean `JhatkaOutlet` (for `business`, `qualityPolicy`)
 * @param {string} p.supplier      supplier name/code
 * @param {object} p.purchaseOrder optional purchase order document
 * @param {object} p.supplierInvoiceRef optional invoice reference
 * @param {Date} p.receivedAt      received date
 * @param {number} p.vehicleNo     vehicle number
 * @param {string} p.note          free‑form note
 * @param {Function} p.nextNumber  function that generates a receipt number
 *
 * @returns {object} receipt document ready for `.save()` and for the response JSON.
 */
function buildReceiptDocument({
  verdictLines, totalReceived, totalAccepted, totalRejected,
  totalAcceptedValue, rejectionRatePct,
  outlet, supplier, purchaseOrder, supplierInvoiceRef,
  receivedAt, vehicleNo, note, nextNumber,
}) {
  const totalReceivedValue = verdictLines.reduce((s, l) => s + l.amount, 0);
  const totalRejectedValue = verdictLines.reduce((s, l) => s + l.rejectedValue, 0);
  const anyRejected = verdictLines.some((l) => l.qualityStatus === 'rejected');
  const anyPartial = verdictLines.some((l) => l.qualityStatus === 'partially_accepted');

  const receipt = new (require('../../../models').JhatkaProcurementReceipt)({
    receiptNo: nextNumber('GR'),
    outlet: outlet._id,
    business: outlet.business,
    supplier,
    purchaseOrder,
    supplierInvoiceRef,
    receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
    status: 'draft',
    qualityStatus: anyRejected ? 'rejected' : anyPartial ? 'partially_accepted' : 'accepted',
    lines: verdictLines,
    totals: {
      lineCount: verdictLines.length,
      totalReceivedQty: totalReceived,
      totalAcceptedQty: totalAccepted,
      totalRejectedQty: totalRejected,
      totalAcceptedValue,
      totalRejectedValue,
    },
    rejectionRatePct: totalReceived > 0 ? Number(((totalRejected / totalReceived) * 100).toFixed(2)) : 0,
    vehicleNo,
    note,
  });

  return {
    receipt,
    // Response DTO – only the fields the caller sees.
    receiptResponse: {
      id: String(receipt._id),
      receiptNo: receipt.receiptNo,
      // Draft on purpose: stock has NOT moved yet.
      status: receipt.status,
      qualityStatus: receipt.qualityStatus,
      totals: receipt.totals,
      rejectionRatePct: receipt.rejectionRatePct,
      lines: receipt.lines.map((l) => ({
        rawSku: l.rawSku,
        receivedQty: l.receivedQty,
        acceptedQty: l.acceptedQty,
        rejectedQty: l.rejectedQty,
        qualityStatus: l.qualityStatus,
      })),
      nextStep: 'POST to /inventory/receipts/:receipt/post to move stock',
    },
  };
}

/**
 * Next ledger sequence for an inventory item.
 *
 * Monotonic per item; starts at 1 for a brand-new row. The sequence is what
 * makes a disputed count answerable by replay.
 */
async function nextSeq({ JhatkaInventoryMovement }, session, itemId) {
  const last = await JhatkaInventoryMovement.findOne({ inventoryItem: itemId })
    .sort({ movementSeq: -1 })
    .select('movementSeq')
    .session(session)
    .lean();
  return (last?.movementSeq || 0) + 1;
}

/**
 * Apply one movement to an item and write the ledger row. THE primitive.
 *
 * Mutates `item` in place (so callers read post-commit figures off it) and
 * returns the created movement. `availableQty` is maintained as
 * `onHand - reserved - quarantined` — every writer keeps it in step, or FEFO
 * reads a lie.
 *
 * Negative-stock guard: a movement that would drive any counter below zero is
 * refused with 400, unless the row explicitly allows negative stock. Mongoose
 * `min: 0` does not run on `$inc`, so this service-level assertion is the real
 * guard and the schema is only the first line of defence.
 */
async function applyMovement(
  { JhatkaInventoryMovement },
  session,
  {
    item,
    kind,
    movementType,
    qtyDelta = 0,
    reservedDelta = 0,
    outlet,
    movementSeq,
    performedBy,
    performedByName,
    reason,
    referenceType,
    referenceId,
    notes,
  }
) {
  const newOnHand = Number(item.onHand || 0) + Number(qtyDelta || 0);
  const newReserved = Number(item.reserved || 0) + Number(reservedDelta || 0);
  const newAvailable = newOnHand - newReserved - Number(item.quarantined || 0);

  if (!item.allowNegativeStock && (newOnHand < 0 || newReserved < 0 || newAvailable < 0)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Adjustment would drive stock negative',
      true,
      '',
      {
        code: 'INSUFFICIENT_STOCK',
        onHand: item.onHand,
        reserved: item.reserved,
        qtyDelta,
        reservedDelta,
      }
    );
  }

  item.onHand = newOnHand;
  item.reserved = newReserved;
  item.availableQty = newAvailable;
  await item.save({ session });

  const movement = new JhatkaInventoryMovement({
    outlet,
    inventoryItem: item._id,
    kind: kind || item.kind,
    movementType,
    qtyDelta: Number(qtyDelta || 0),
    reservedDelta: Number(reservedDelta || 0),
    onHandAfter: newOnHand,
    reservedAfter: newReserved,
    availableAfter: newAvailable,
    movementSeq,
    performedBy,
    performedByName,
    reason,
    referenceType,
    referenceId,
    notes,
  });
  await movement.save({ session });
  return movement;
}

/**
 * POST /jhatka/partner/inventory/receipts/:receipt/post
 *
 * Turns an accepted DRAFT receipt into batches + stock + ledger + allocations
 * and advances the purchase order — all in ONE transaction, so a receipt can
 * never be half-posted. A receipt whose second line fails validation leaves
 * zero trace of its first line (batch, movement and posted status).
 *
 * Idempotent-by-conflict: a POSTED receipt is refused 409, a CANCELLED one 409.
 */
async function postReceipt({ receipt, outlet, actor, body, models, nextNumber }) {
  const {
    JhatkaBatch,
    JhatkaInventoryItem,
    JhatkaInventoryMovement,
    JhatkaBatchAllocation,
    JhatkaPurchaseOrder,
    JhatkaProcurementReceipt,
  } = models;

  if (!receipt) throw new ApiError(httpStatus.NOT_FOUND, 'Receipt not found for this outlet');
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

  const outletId = outlet?._id || outlet;
  const business = outlet?.business || receipt.business;
  if (!business) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Cannot post a receipt without a business — it is required on batches and allocations',
      true,
      '',
      { code: 'BUSINESS_UNKNOWN' }
    );
  }

  return withTransaction({
    startSession: () => JhatkaProcurementReceipt.startSession(),
    fn: async (session) => {
      const batches = [];
      let movements = 0;

      for (const line of receipt.lines || []) {
        const accepted = Number(line.acceptedQty?.value || 0);
        if (accepted <= 0) continue;
        const unit = line.acceptedQty?.unit || line.receivedQty?.unit;
        if (!unit) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Receipt line has no unit', true, '', {
            fields: ['lines.acceptedQty.unit'],
          });
        }

        // Raw shelf life from the outlet's own quality policy (§5.3). Per-fish
        // 12h lives behind category resolution (JH-06); raw default is correct
        // for the common case and far better than no expiry at all.
        const shelfHours = Number(outlet?.qualityPolicy?.shelfLifeHoursRaw) || 48;
        const receivedAt = receipt.receivedAt ? new Date(receipt.receivedAt) : new Date();
        // Per-line expiry override (the packing screen knows the supplier's
        // printed date). An unparseable value MUST fail the batch save inside
        // the transaction — never defaulted, never skipped.
        const override = body?.expiresAtByLine?.[String(line._id)];
        const expiresAt =
          override !== undefined ? new Date(override) : new Date(receivedAt.getTime() + shelfHours * 3600 * 1000);

        const batch = new JhatkaBatch({
          batchNo: nextNumber('B'),
          outlet: outletId,
          business,
          supplier: receipt.supplier,
          procurementReceipt: receipt._id,
          receiptItem: line._id,
          product: line.product,
          rawSku: line.rawSku,
          supplierBatchRef: line.supplierBatchRef,
          unit,
          receivedQty: accepted,
          availableQty: accepted,
          receivedAt,
          expiresAt,
        });
        const batchError = batch.validateSync();
        if (batchError) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Batch failed validation', true, '', {
            fields: Object.keys(batchError.errors),
          });
        }
        await batch.save({ session });
        batches.push(batch);

        let item = await JhatkaInventoryItem.findOne({
          outlet: outletId,
          kind: 'raw',
          batch: batch._id,
        }).session(session);
        if (!item) {
          item = new JhatkaInventoryItem({
            outlet: outletId,
            kind: 'raw',
            batch: batch._id,
            product: line.product,
            unit,
            receivedAt,
            expiresAt: batch.expiresAt,
          });
        }

        const movementSeq = await nextSeq({ JhatkaInventoryMovement }, session, item._id);
        await applyMovement(
          { JhatkaInventoryMovement },
          session,
          {
            item,
            kind: 'raw',
            movementType: 'RECEIPT',
            qtyDelta: accepted,
            reservedDelta: 0,
            outlet: outletId,
            movementSeq,
            performedBy: actor?._id,
            performedByName: actor?.name,
            reason: `Receipt ${receipt.receiptNo}`,
            referenceType: 'JhatkaProcurementReceipt',
            referenceId: receipt._id,
          }
        );
        movements += 1;

        await JhatkaBatchAllocation.create(
          [
            {
              batch: batch._id,
              outlet: outletId,
              business,
              allocationType: 'RECEIPT',
              qtyDelta: accepted,
              qtyAfter: batch.availableQty,
              referenceType: 'JhatkaProcurementReceipt',
              referenceId: receipt._id,
              occurredAt: new Date(),
              occurredBy: actor?._id,
              occurredByName: actor?.name,
              note: `Receipt ${receipt.receiptNo} posted`,
            },
          ],
          { session }
        );
      }

      receipt.status = 'posted';
      receipt.postedAt = new Date();
      await receipt.save({ session });

      let purchaseOrder = null;
      if (receipt.purchaseOrder) {
        purchaseOrder = await JhatkaPurchaseOrder.findById(receipt.purchaseOrder).session(session);
        if (purchaseOrder && !['received', 'closed', 'cancelled'].includes(purchaseOrder.status)) {
          for (const poLine of purchaseOrder.lines || []) {
            const got = (receipt.lines || [])
              .filter(
                (l) =>
                  String(l.product) === String(poLine.product) &&
                  String(l.rawSku || '').toUpperCase() === String(poLine.rawSku || '').toUpperCase() &&
                  Number(l.acceptedQty?.value || 0) > 0
              )
              .reduce((s, l) => s + Number(l.acceptedQty.value), 0);
            poLine.receivedQty = Number(poLine.receivedQty || 0) + got;
          }
          const allIn = (purchaseOrder.lines || []).every(
            (l) => Number(l.receivedQty || 0) >= Number(l.orderedQty || 0)
          );
          purchaseOrder.status = allIn ? 'received' : 'partially_received';
          await purchaseOrder.save({ session });
        }
      }

      return {
        receipt: {
          id: String(receipt._id),
          receiptNo: receipt.receiptNo,
          status: receipt.status,
          postedAt: receipt.postedAt,
        },
        batches: batches.map((b) => ({
          id: String(b._id),
          batchNo: b.batchNo,
          availableQty: b.availableQty,
          expiresAt: b.expiresAt,
        })),
        movements,
        purchaseOrder: purchaseOrder
          ? { id: String(purchaseOrder._id), status: purchaseOrder.status }
          : null,
      };
    },
  });
}

module.exports = { buildReceiptDocument, createDraftReceipt, nextSeq, applyMovement, postReceipt };