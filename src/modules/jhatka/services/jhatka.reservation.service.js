/**
 * jhatka.reservation.service.js — §9.4 stock reservation.
 *
 * ## The bug this exists to fix
 *
 * The subscription generator checked stock with
 * `JhatkaInventoryItem.findOne({outlet, variant, kind}).select('availableQty')` and
 * then did NOTHING with the answer. It never reserved. Two subscriptions due on the
 * same morning, both seeing the same 5 kg, both promising it to a customer — and the
 * second shop to accept the order has no chicken.
 *
 * Two further defects in those same three lines:
 *
 *   - `findOne` with no sort returns an ARBITRARY batch. A variant with an expired
 *     batch at 0 and a fresh one at 5 would report 0 and skip a perfectly good week.
 *   - The check was read-then-act with no atomicity, so even if it had written
 *     `reserved`, two concurrent generators could both pass the check.
 *
 * ## The guard is the CONDITIONAL UPDATE, not a check
 *
 * `findOneAndUpdate({ _id, availableQty: { $gte: want } }, { $inc: { reserved: want } })`
 * is a single atomic document operation. Mongo guarantees the predicate is re-evaluated
 * under the write lock, so of two concurrent claims for the last 2 kg, exactly one
 * matches. A separate `find` then `save` would let both read 2 and both write.
 *
 * "Check first, then reserve" is the shape that produces overselling. The check is
 * *inside* the update.
 *
 * ## FEFO, not FIFO
 *
 * Batches are consumed shortest-expiry-first. An item with 2 days left and one with 5
 * days left are not interchangeable: taking the fresh one first routinely leaves a
 * customer holding chicken that is about to become wastage, and §5.5 counts that
 * against the shop.
 *
 * ## Expired and quarantined batches are skipped
 *
 * Not filtered in the query alone — `expiresAt` is compared in JS so a batch expiring
 * mid-loop is still rejected. A batch whose `expiresAt` has passed is not sellable
 * stock, and reserving it is how "we quarantined it" becomes "it reappeared".
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');

/**
 * Reserve stock for one occurrence's lines.
 *
 * ALL-OR-NOTHING within a line: a line either gets its full quantity (possibly split
 * across batches, per §5.4) or gets nothing. A partial reservation would let a customer
 * receive 1 kg of a 2 kg order with no error raised, which is worse than a clear
 * shortfall the shop can resolve before delivery.
 *
 * @returns {{reserved: Array, shortfalls: Array}}
 */
async function reserveOccurrenceStock({ occurrence, lines, outlet, models, actor }) {
  const { JhatkaInventoryItem, JhatkaInventoryMovement, JhatkaBatchAllocation } = models;

  // `JhatkaBatchAllocation` requires `batch` and `business`, and neither lives on the
  // occurrence. `outlet` may arrive as an id or as a document depending on the caller,
  // so both are handled rather than assuming the richer form — a caller that passed an
  // id previously produced `business: undefined` and a ValidationError naming one field.
  const outletDoc =
    outlet && outlet.business ? outlet : await models.JhatkaOutlet.findById(outlet).lean();
  const itemBusiness = occurrence.business || outletDoc?.business;

  if (!itemBusiness) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Cannot allocate a reservation without a business — it is required on JhatkaBatchAllocation',
      true,
      '',
      { code: 'BUSINESS_UNKNOWN', outlet: String(outlet) }
    );
  }

  const reserved = [];
  const shortfalls = [];

  for (const line of lines) {
    const want = Number(line.quantity || 0);
    if (want <= 0) continue;

    let remaining = want;
    const taken = [];

    // FEFO: shortest expiry first, and never take one that has already expired.
    const candidates = await JhatkaInventoryItem.find({
      outlet,
      variant: line.variant,
      kind: 'raw',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ expiresAt: 1, createdAt: 1 })
      .select('_id batch onHand reserved availableQty unit expiresAt')
      .lean();

    for (const candidate of candidates) {
      if (remaining <= 0) break;

      // Re-check the expiry against the wall clock, not just the query. A batch that
      // expires while this loop runs must not be reserved.
      if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() <= Date.now()) continue;

      const take = Math.min(remaining, candidate.availableQty);
      if (take <= 0) continue;

      // A raw item with no `batch` cannot be allocated, and an allocation without a
      // batch is what makes a recall unanswerable (§11). Refuse rather than allocate
      // against nothing.
      if (!candidate.batch) continue;

      // THE GUARD. Atomic, conditional, and the only place stock is claimed.
      //
      // `availableQty` MUST be decremented in the SAME update as `reserved` is
      // incremented. An earlier version did `$inc: { reserved: take }` alone, which
      // left the guard field `availableQty` at 5 forever — so the predicate
      // `availableQty >= take` stayed true and TWO concurrent claims both succeeded,
      // reserving 10 kg of a 5 kg batch. The guard was checking a field nothing wrote.
      //
      // This is the whole reason the assertion exists.
      const claimed = await JhatkaInventoryItem.findOneAndUpdate(
        {
          _id: candidate._id,
          availableQty: { $gte: take },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        },
        { $inc: { reserved: take, availableQty: -take } },
        { new: true }
      );

      // null means another writer took it first. Move on to the next batch; do NOT
      // fail the whole line, because the next batch may cover the remainder.
      if (!claimed) continue;

      const movementSeq = (claimed.movementSeq || 0) + 1;
      await JhatkaInventoryMovement.create({
        outlet,
        inventoryItem: claimed._id,
        kind: 'raw',
        movementType: 'ORDER_RESERVATION',
        qtyDelta: 0,
        reservedDelta: take,
        onHandAfter: claimed.onHand,
        reservedAfter: claimed.reserved,
        availableAfter: claimed.onHand - claimed.reserved,
        reason: `Subscription occurrence ${occurrence.occurrenceDate}`,
        referenceType: 'JhatkaRecurringOrder',
        referenceId: occurrence._id,
        movementSeq,
        performedBy: actor?._id,
        performedByName: actor?.name,
      });

      await JhatkaBatchAllocation.create({
        batch: claimed.batch,
        outlet,
        business: itemBusiness,
        allocationType: 'RESERVATION',
        qtyDelta: take,
        qtyAfter: claimed.reserved,
        recurringOrder: occurrence._id,
        subscription: occurrence.subscription,
        referenceType: 'JhatkaRecurringOrder',
        referenceId: occurrence._id,
        occurredAt: new Date(),
        occurredBy: actor?._id,
        occurredByName: actor?.name,
        note: `Reserved for subscription occurrence ${occurrence.occurrenceDate}`,
      });

      await JhatkaInventoryItem.updateOne({ _id: claimed._id }, { movementSeq });

      taken.push({ inventoryItem: claimed._id, batch: claimed.batch, qty: take });
      remaining -= take;
    }

    if (remaining > 0) {
      // All-or-nothing: give back whatever this line managed to claim, so a shortfall
      // on line 2 does not silently hold stock for a line that will never ship.
      for (const t of taken) {
        await JhatkaInventoryItem.updateOne(
          { _id: t.inventoryItem },
          { $inc: { reserved: -t.qty, availableQty: t.qty } }
        );
      }
      shortfalls.push({
        sku: line.sku,
        variant: String(line.variant),
        wanted: want,
        available: want - remaining,
      });
    } else {
      reserved.push({ sku: line.sku, variant: String(line.variant), qty: want, from: taken });
    }
  }

  return { reserved, shortfalls };
}

/**
 * Release a previous reservation when an occurrence is cancelled, skipped or expired.
 *
 * Symmetric with `reserveOccurrenceStock` and driven from the ALLOCATION rows rather
 * than from a recomputation, so it releases exactly what was reserved even if the
 * catalogue has moved on since.
 */
async function releaseOccurrenceStock({ occurrence, outlet, models, actor, reason }) {
  const { JhatkaInventoryItem, JhatkaBatchAllocation, JhatkaInventoryMovement } = models;

  const allocations = await JhatkaBatchAllocation.find({
    recurringOrder: occurrence._id,
    allocationType: 'RESERVATION',
  }).lean();

  let released = 0;

  for (const alloc of allocations) {
    const item = await JhatkaInventoryItem.findOneAndUpdate(
      { _id: alloc.inventoryItem || (await itemIdFor(alloc, models)) },
      // Symmetric with the claim: `reserved` down AND `availableQty` back up.
      // Releasing only one of the pair leaves the item permanently unavailable.
      { $inc: { reserved: -alloc.qtyDelta, availableQty: alloc.qtyDelta } },
      { new: true }
    );
    if (!item) continue;

    const movementSeq = (item.movementSeq || 0) + 1;
    await JhatkaInventoryMovement.create({
      outlet,
      inventoryItem: item._id,
      kind: 'raw',
      movementType: 'RESERVATION_RELEASE',
      qtyDelta: 0,
      reservedDelta: -alloc.qtyDelta,
      onHandAfter: item.onHand,
      reservedAfter: item.reserved,
      availableAfter: item.onHand - item.reserved,
      reason: reason || `Occurrence ${occurrence.occurrenceDate} no longer proceeds`,
      referenceType: 'JhatkaRecurringOrder',
      referenceId: occurrence._id,
      movementSeq,
      performedBy: actor?._id,
      performedByName: actor?.name,
    });

    await JhatkaInventoryItem.updateOne({ _id: item._id }, { movementSeq });

    await JhatkaBatchAllocation.create({
      batch: alloc.batch,
      outlet,
      business: alloc.business || outlet.business,
      allocationType: 'RESERVATION_RELEASE',
      qtyDelta: -alloc.qtyDelta,
      qtyAfter: item.reserved,
      recurringOrder: occurrence._id,
      subscription: occurrence.subscription,
      referenceType: 'JhatkaRecurringOrder',
      referenceId: occurrence._id,
      occurredAt: new Date(),
      occurredBy: actor?._id,
      occurredByName: actor?.name,
      note: reason || 'Reservation released',
    });

    released += alloc.qtyDelta;
  }

  return { released };
}

/** Resolve the inventory item a batch allocation refers to. */
async function itemIdFor(alloc, models) {
  const { JhatkaInventoryItem } = models;
  const item = await JhatkaInventoryItem.findOne({ batch: alloc.batch, kind: 'raw' })
    .select('_id')
    .lean();
  if (!item) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `No raw inventory item for batch ${String(alloc.batch)}; cannot release its reservation`,
      true,
      '',
      { code: 'ALLOCATION_ITEM_MISSING', batch: String(alloc.batch) }
    );
  }
  return item._id;
}

/**
 * Allocate stock to ONE ORDER LINE, splitting across batches as needed. §5.4 / BR-10.
 *
 * ## Why this exists
 *
 * `JhatkaPreparationTicket` was created and the order moved to `PREPARING`, but
 * NOTHING ever wrote `orderItem.allocations`. So every packed line claimed to come
 * from no batch at all, and §11's recall — which queries `{batch: 1}` — could not
 * name a single customer affected by a given batch. That is the entire reason the
 * linear `Batch → Order` chain exists.
 *
 * ## The split is the point
 *
 * A line for 5 KG is routinely filled from two batches: 3 KG with 3 days left and
 * 2 KG with 8 days left. One line, TWO allocations. `JhatkaOrderItem.allocations` is
 * an array precisely so this is representable, and `JhatkaBatchAllocation.orderItem`
 * can then point at the same line twice.
 *
 * ## Why the label reader cannot just take `[0]`
 *
 * Because of this split. A pack cut from a 3-day batch and an 8-day batch has ONE
 * correct use-by — the SHORTER one, 3 days. Taking `allocations[0]` gives whichever
 * batch happened to be written first, which is an arbitrary order, so the label can
 * claim "use by next Tuesday" for meat that dies on Friday. See
 * `shortestExpiryForLine` below and the label route's use of it.
 *
 * FEFO again, so the short-dated batch is consumed first and this situation shrinks
 * over time rather than growing.
 *
 * @returns {{allocations: Array, shortfall: number}}
 */
async function allocateOrderItem({ order, item, outlet, models, actor }) {
  const { JhatkaInventoryItem, JhatkaBatchAllocation, JhatkaOutlet } = models;

  const outletDoc =
    outlet && outlet.business ? outlet : await JhatkaOutlet.findById(outlet).lean();

  // Already allocated — never allocate twice. A re-preparation creates a NEW ticket but
  // must not re-claim stock the first attempt already holds.
  if ((item.allocations || []).length) {
    return { allocations: item.allocations, shortfall: 0, alreadyAllocated: true };
  }

  const want = Number(
    item.actualQuantity?.value ?? item.requestedQuantity?.value ?? 0
  );
  if (want <= 0) return { allocations: [], shortfall: 0 };

  const unit = item.actualQuantity?.unit || item.requestedQuantity?.unit;

  const candidates = await JhatkaInventoryItem.find({
    outlet: outletDoc._id,
    product: item.product,
    kind: 'raw',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  })
    .sort({ expiresAt: 1, createdAt: 1 })
    .select('_id batch availableQty reserved unit expiresAt')
    .lean();

  let remaining = want;
  const allocations = [];
  const now = new Date();

  for (const candidate of candidates) {
    if (remaining <= 0) break;
    if (!candidate.batch) continue;
    if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() <= Date.now()) continue;

    const take = Math.min(remaining, candidate.availableQty);
    if (take <= 0) continue;

    const claimed = await JhatkaInventoryItem.findOneAndUpdate(
      {
        _id: candidate._id,
        availableQty: { $gte: take },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      },
      { $inc: { reserved: take, availableQty: -take } },
      { new: true }
    );
    if (!claimed) continue;

    // The item-level allocation. MULTIPLE entries for one line is the split.
    allocations.push({ batch: claimed.batch, qty: take, allocatedAt: now });

    await JhatkaBatchAllocation.create({
      batch: claimed.batch,
      outlet: outletDoc._id,
      business: outletDoc.business,
      allocationType: 'RESERVATION',
      qtyDelta: take,
      qtyAfter: claimed.reserved,
      order: order._id,
      orderItem: item._id,
      referenceType: 'JhatkaOrder',
      referenceId: order._id,
      occurredAt: now,
      occurredBy: actor?._id,
      occurredByName: actor?.name,
      note: `Order ${order.orderNo}: ${take} ${unit} from batch ${String(claimed.batch)}`,
    });

    remaining -= take;
  }

  if (remaining > 0) {
    // Give back a partial claim — a half-allocated line is a half-filled pack.
    for (const a of allocations) {
      const itemDoc = await JhatkaInventoryItem.findOne({ batch: a.batch, outlet: outletDoc._id, kind: 'raw' });
      if (itemDoc) {
        await JhatkaInventoryItem.updateOne(
          { _id: itemDoc._id },
          { $inc: { reserved: -a.qty, availableQty: a.qty } }
        );
      }
    }
    return { allocations: [], shortfall: remaining };
  }

  item.allocations = allocations;
  return { allocations, shortfall: 0 };
}

/**
 * The SHORTEST expiry across every batch a line was cut from.
 *
 * This is the ONLY correct use-by for a split line, and it is why
 * `resolveBatch(...)[0]` was wrong: it returned an arbitrary one of N. A pack
 * containing meat from a batch that dies tomorrow must say tomorrow, even if the rest
 * of it would last a week — §11 exists to stop a customer reading a date that has
 * already passed.
 *
 * @returns {Promise<{batch: string, expiresAt: Date, isSplit: boolean} | null>}
 */
async function shortestExpiryForLine(item, models) {
  const { JhatkaBatch } = models;

  const batchIds = (item.allocations || []).map((a) => a.batch).filter(Boolean);
  if (!batchIds.length) return null;

  const batches = await JhatkaBatch.find({ _id: { $in: batchIds } })
    .select('_id batchNo expiresAt')
    .lean();

  // A batch with NO expiry does not constrain the label — the pack is then as
  // long-lived as its shortest-dated sibling, not infinite.
  const dated = batches
    .filter((b) => b.expiresAt)
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));

  if (!dated.length) return null;

  return {
    batch: String(dated[0]._id),
    batchNo: dated[0].batchNo,
    expiresAt: dated[0].expiresAt,
    isSplit: batchIds.length > 1,
    batchCount: batchIds.length,
  };
}

module.exports = {
  reserveOccurrenceStock,
  releaseOccurrenceStock,
  allocateOrderItem,
  shortestExpiryForLine,
};