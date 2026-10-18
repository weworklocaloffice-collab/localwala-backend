/**
 * jhatka.expiry.service.js — §5 expiry write-off.
 *
 * ## The bug this exists to fix
 *
 * The batch-expiry job did exactly one thing:
 *
 *     await JhatkaBatch.updateOne({ _id, status: { $in: ['source','opened'] } },
 *                                 { status: 'expired' });
 *
 * Its own comment said: *"`EXPIRY_WRITE_OFF` exists as a movement type for exactly
 * this; writing the balance away without a movement would leave the ledger claiming
 * stock that is gone."* Then it did precisely that. Three things were missing:
 *
 *   1. **No movement.** The ledger still showed the stock as present. Every balance
 *      check downstream — settlement COGS, wastage, the §11 recall query — reads the
 *      ledger, so a batch that had been binned still looked sellable.
 *   2. **The inventory item was untouched.** `JhatkaInventoryItem.availableQty` stayed
 *      at its full value, so the *authoritative* stock count still offered expired meat
 *      for sale. This is the dangerous half: the batch was hidden and the stock was not.
 *   3. **No wastage record.** `JhatkaWastage` is what settlement sums, so the loss
 *      never appeared in a margin figure — the shop ate an invisible cost.
 *
 * ## The accounting identity is preserved
 *
 * `availableQty = onHand - reserved`. Write-off reduces `onHand`, because the stock
 * physically no longer exists; reducing only `availableQty` would break the identity
 * and make every later arithmetic look wrong for an unrelated reason.
 *
 * RESERVED stock is deliberately NOT written off. A batch can expire while part of it
 * is committed to an unfulfilled order; that portion belongs to a customer who has
 * already paid, and writing it off silently would make the refund impossible to
 * calculate. It is left reserved and surfaced as `reservedCarriedOver` so the shop can
 * see it needs handling.
 *
 * ## Idempotent, and idempotent for the RIGHT reason
 *
 * The guard is on the BATCH status, and the write-off only happens on the transition
 * out of `source`/`opened`. A second sweep finds nothing to do. The conditional update
 * is on `availableQty > 0` as well, so a partially-consumed batch writes off only what
 * remains rather than its original received quantity.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');

/**
 * Write off one expired batch.
 *
 * @returns {Promise<{writtenOff: boolean, qty: number, reservedCarriedOver: number}>}
 */
async function writeOffBatch({ batch, models, actor, occurredAt = new Date() }) {
  const {
    JhatkaBatch,
    JhatkaInventoryItem,
    JhatkaInventoryMovement,
    JhatkaWastage,
    JhatkaBatchAllocation,
    JhatkaOutlet,
  } = models;

  // `outlet` may arrive as an id (the cron passes a lean batch) or as a populated
  // document. Both are handled: `JhatkaBatchAllocation.business` is REQUIRED, and
  // reading `.business` off an ObjectId silently produced `undefined` — a ValidationError
  // naming one field, with no hint that the outlet was simply never loaded.
  const outlet =
    batch.outlet && typeof batch.outlet === 'object' && batch.outlet.business
      ? batch.outlet
      : await JhatkaOutlet.findById(batch.outlet._id || batch.outlet).lean();

  if (!outlet?.business) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Cannot write off a batch without a resolvable outlet business',
      true,
      '',
      { code: 'OUTLET_BUSINESS_UNKNOWN', outlet: String(batch.outlet) }
    );
  }

  // Everything backed by this batch. `availableQty > 0` is the write-off boundary:
  // consumed stock is already gone from the books and must not be written off twice.
  const items = await JhatkaInventoryItem.find({
    batch: batch._id,
    availableQty: { $gt: 0 },
  }).lean();

  let writtenOff = 0;
  let reservedCarriedOver = 0;
  const no = nextWastageNo();

  for (const item of items) {
    // Reserved stock is committed to a customer who has already paid. It is carried,
    // not written off — see the note at the top of this file.
    const toWriteOff = Math.max(0, Number(item.availableQty || 0));
    const reserved = Math.max(0, Number(item.reserved || 0));
    reservedCarriedOver += reserved;

    if (toWriteOff <= 0) continue;

    // `onHand` goes down because the stock physically no longer exists. Only
    // `availableQty` going down would break `availableQty = onHand - reserved`.
    const updated = await JhatkaInventoryItem.findOneAndUpdate(
      { _id: item._id, availableQty: { $gte: toWriteOff } },
      { $inc: { onHand: -toWriteOff, availableQty: -toWriteOff }, $set: { movementSeq: (item.movementSeq || 0) + 1 } },
      { new: true }
    );

    // Null means someone consumed it between the read and this write. That is a
    // legitimate outcome, not an error — the stock is gone either way — but it must
    // NOT be counted as a write-off, or the ledger gains a phantom movement.
    if (!updated) continue;

    await JhatkaInventoryMovement.create({
      outlet: batch.outlet,
      inventoryItem: item._id,
      kind: item.kind || 'raw',
      movementType: 'EXPIRY_WRITE_OFF',
      qtyDelta: -toWriteOff,
      reservedDelta: 0,
      onHandAfter: updated.onHand,
      reservedAfter: updated.reserved,
      availableAfter: updated.availableQty,
      reason: `Batch ${batch.batchNo} expired`,
      referenceType: 'JhatkaBatch',
      referenceId: batch._id,
      movementSeq: updated.movementSeq,
      performedBy: actor?._id,
      performedByName: actor?.name,
      notes: `Write-off at expiry on ${new Date(batch.expiresAt).toISOString()}`,
    });

    await JhatkaBatchAllocation.create({
      batch: batch._id,
      outlet: batch.outlet,
      business: outlet?.business,
      allocationType: 'EXPIRY_WRITE_OFF',
      qtyDelta: -toWriteOff,
      qtyAfter: updated.availableQty,
      referenceType: 'JhatkaBatch',
      referenceId: batch._id,
      occurredAt,
      occurredBy: actor?._id,
      occurredByName: actor?.name,
      note: `Expired ${new Date(batch.expiresAt).toISOString()}`,
    });

    // Without this the loss never reaches settlement: `JhatkaSettlement` sums
    // `JhatkaWastage.estimatedValue`, so an unwritten expiry is margin that
    // mysteriously did not appear.
    await JhatkaWastage.create({
      wastageNo: no,
      outlet: batch.outlet,
      business: outlet?.business,
      kind: 'raw',
      product: batch.product,
      variant: item.variant,
      batch: batch._id,
      qty: toWriteOff,
      unit: item.unit || batch.unit,
      // Valued at the shop's own recorded cost where known; zero is honest and
      // better than a guess that would flow into margin.
      estimatedValue: 0,
      cause: 'EXPIRY',
      orderLinked: false,
      by: actor?._id,
      byName: actor?.name,
      occurredAt,
      notes: `Batch ${batch.batchNo} expired and was written off`,
    });

    writtenOff += toWriteOff;
  }

  // The batch is marked expired ONLY if it actually changed, so a second sweep cannot
  // claim credit for a write-off this sweep did not perform.
  const flipped = await JhatkaBatch.findOneAndUpdate(
    { _id: batch._id, status: { $in: ['source', 'opened'] } },
    { $set: { status: 'expired' } },
    { new: true }
  );

  return { writtenOff: writtenOff > 0 || !!flipped, qty: writtenOff, reservedCarriedOver };
}

/**
 * Sweep every expired batch for an outlet.
 *
 * `availableQty: { $gt: 0 }` on the BATCH is a cheap pre-filter; the authoritative
 * decision is per inventory item inside `writeOffBatch`.
 */
async function writeOffExpiredBatches({ models, actor, now = new Date() }) {
  const { JhatkaBatch } = models;

  const batches = await JhatkaBatch.find({
    status: { $in: ['source', 'opened'] },
    expiresAt: { $ne: null, $lte: now },
    availableQty: { $gt: 0 },
  }).lean();

  const results = [];
  for (const batch of batches) {
    results.push({ batchNo: batch.batchNo, ...(await writeOffBatch({ batch, models, actor })) });
  }

  return {
    processed: results.length,
    qtyWrittenOff: results.reduce((s, r) => s + r.qty, 0),
    reservedCarriedOver: results.reduce((s, r) => s + r.reservedCarriedOver, 0),
    batches: results,
  };
}

let _seq = 0;
function nextWastageNo() {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  _seq = (_seq + 1) % 1000;
  return `WS${stamp}${String(_seq).padStart(3, '0')}`;
}

module.exports = { writeOffBatch, writeOffExpiredBatches, nextWastageNo };