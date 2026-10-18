/**
 * jhatka.recall.service.js — opening and closing a batch recall.
 *
 * ## Why this is in a transaction now, and was not before
 *
 * Opening a recall writes FOUR things: the `JhatkaRecall` record, the batch status
 * flip, one `RECALL_FREEZE` ledger row per affected inventory item, and the
 * `availableQty = 0` on each of those items. The route did all of that WITHOUT a
 * session.
 *
 * So a failure on the third item of five left a batch marked `quarantined`, a recall
 * row claiming a freeze that half happened, and stock rows where some were frozen and
 * some were not — with no way to tell which. Worse, the failure mode is not loud:
 * the request 500s, the operator retries, and the retry takes the `discarded` /
 * already-recalled branch on a batch whose state no longer matches its ledger.
 *
 * A recall is the one operation in this vertical where a half-applied state is worse
 * than no state at all: the whole point is that suspect stock stops being sold.
 *
 * ## Why the freeze does NOT go through `applyMovement`
 *
 * A freeze does not change `onHand` and does not change `reserved`. It changes
 * whether the stock is OFFERABLE. Those are different facts, so this ledger row is
 * written directly rather than derived from a delta.
 *
 * The consequence is deliberate and worth stating: on a `RECALL_FREEZE` row,
 * `availableAfter` is NOT `onHandAfter - reservedAfter`. Any replay that recomputes
 * availability that way will disagree for these rows and must honour the freeze.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const receiptService = require('./jhatka.receipt.service');
const { assessRecallScope } = require('../utils/compliance.arithmetic');
const { withTransaction } = require('../utils/transaction');
const notifyService = require('./jhatka.notify.service');

const RECALL_SEVERITIES = ['advisory', 'withdraw', 'recall'];

// A recall touches one batch plus every stock line on it, so it contends with any
  // concurrent stock write. The retry matters here more than average: losing this race
  // would mean the batch is quarantined but its availability was never zeroed.
  async function inTransaction(models, fn) {
  return withTransaction({
    startSession: () => models.JhatkaBatch.startSession(),
    fn,
  });
}

/**
 * Open a recall: record it, freeze the batch, and zero availability across its stock.
 *
 * Scoped to the outlet on every read, so another outlet's batch id is indistinguishable
 * from one that does not exist.
 */
async function openRecall({ models, outletId, actor, nextNumber, batch: batchId, severity, reason, supplier }) {
  if (!batchId) throw new ApiError(httpStatus.BAD_REQUEST, 'batch is required');
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required');
  if (!RECALL_SEVERITIES.includes(severity)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'severity must be advisory|withdraw|recall');
  }

  return inTransaction(models, async (session) => {
    const batch = await models.JhatkaBatch.findOne({ _id: batchId, outlet: outletId }).session(session);
    if (!batch) throw new ApiError(httpStatus.NOT_FOUND, 'Batch not found for this outlet');
    if (batch.status === 'discarded') {
      throw new ApiError(httpStatus.CONFLICT, 'A discarded batch cannot be recalled');
    }

    const outlet = await models.JhatkaOutlet.findById(outletId).select('business').session(session).lean();

    const recall = new models.JhatkaRecall({
      recallNo: nextNumber('RC'),
      batch: batch._id,
      outlet: outletId,
      business: outlet?.business,
      supplier: supplier || batch.supplier,
      severity,
      reason,
      initiatedBy: actor._id,
      initiatedByName: actor.name,
      initiatedAt: new Date(),
      status: 'open',
      notifiedCount: 0,
      acknowledgedCount: 0,
    });

    const recallError = recall.validateSync();
    if (recallError) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Recall failed validation', true, '', {
        fields: Object.keys(recallError.errors),
      });
    }
    await recall.save({ session });

    // Freeze the batch FIRST, before anything is reconciled or notified. That order is
    // the §-5 reversal rule: quarantine, then stock, then customers.
    batch.status = 'quarantined';
    batch.quarantinedAt = new Date();
    batch.quarantineReason = `Recall ${recall.recallNo}: ${reason}`;
    batch.recalls = [...(batch.recalls || []), recall._id];
    await batch.save({ session });

    // Record the freeze in the ledger for every stock line on this batch.
    const items = await models.JhatkaInventoryItem.find({ batch: batch._id, outlet: outletId }).session(session);

    for (const item of items) {
      const movementSeq = await receiptService.nextSeq(
        { JhatkaInventoryMovement: models.JhatkaInventoryMovement },
        session,
        item._id
      );

      // `qtyDelta` and `reservedDelta` are both 0: the stock is still physically on
      // hand and still reserved. Only its AVAILABILITY changes. See the file header.
      await models.JhatkaInventoryMovement.create(
        [
          {
            outlet: outletId,
            inventoryItem: item._id,
            kind: item.kind,
            movementType: 'RECALL_FREEZE',
            qtyDelta: 0,
            reservedDelta: 0,
            onHandAfter: item.onHand,
            reservedAfter: item.reserved,
            availableAfter: 0,
            reason: `Recall ${recall.recallNo}`,
            referenceType: 'JhatkaRecall',
            referenceId: recall._id,
            movementSeq,
            performedBy: actor._id,
            performedByName: actor.name,
          },
        ],
        { session }
      );

      // Only `availableQty` changes; `onHand` and `reserved` are untouched, and
      // `quarantined` is deliberately NOT incremented here.
      //
      // `JhatkaInventoryItem` documents `availableQty = onHand - reserved - quarantined`,
      // so writing 0 without raising `quarantined` leaves the stored triple
      // inconsistent, and `POST /batches/:batch/release` does not put the availability
      // back. That is a PRE-EXISTING behaviour, carried over verbatim rather than
      // silently "fixed" during a refactor: making the freeze reversible is a decision
      // about release semantics that also has to be applied to the admin quarantine
      // route, which writes the same movement without touching availability at all.
      // Raised for review rather than changed here.
      item.availableQty = 0;
      await item.save({ session });
    }

    return {
      recall: {
        id: String(recall._id),
        recallNo: recall.recallNo,
        severity: recall.severity,
        status: recall.status,
        initiatedAt: recall.initiatedAt,
        frozenLines: items.length,
      },
      batch: { id: String(batch._id), batchNo: batch.batchNo, status: batch.status },
    };
  }).then(async (result) => {
    // B8: fan-out runs AFTER the freeze commits, never inside it. A notification
    // is a side effect, and side effects do not belong in a transaction — if the
    // freeze rolls back, nothing must have been sent.
    const scope = await scopeRecall({
      models,
      outletId,
      recallId: result.recall.id,
      batchId: result.batch.id,
      actor,
    });
    result.recall.status = scope.status;
    result.scope = scope.summary;
    return result;
  });
}

/**
 * B8 — affected-customer fan-out (§5.4).
 *
 * Finds affected orders from the `{batch: 1}` allocation index ALONE (the -11
 * rule: no other input may be required), persists the scope onto the recall,
 * moves undelivered orders to `ON_HOLD` where the transition table allows it,
 * and records per-customer notification rows.
 *
 * The fan-out runs here, after the freeze commits and outside the transaction, and the
 * per-customer rows are stamped from what the transport returned. `notifiedAt` records
 * when a push was DELIVERED, not when the row was written — the close gate
 * (`UNACKNOWLEDGED_CUSTOMERS`) reads these rows, so a row that claims delivery without
 * one is worse than no row at all.
 */
async function scopeRecall({ models, outletId, recallId, batchId, actor }) {
  const recall = await models.JhatkaRecall.findOne({ _id: recallId, outlet: outletId });
  if (!recall) throw new ApiError(httpStatus.NOT_FOUND, 'Recall not found for this outlet');

  // Only for the customer-facing message. The recall's own document already refs the
  // batch, but a customer needs the human-readable code — "batch A09-26012" — because
  // it is on the pack's QR.
  const batchForMessage = await models.JhatkaBatch.findById(batchId).select('batchNo').lean();

  const allocations = await models.JhatkaBatchAllocation.find({ batch: batchId }).lean();

  const orderIds = [...new Set(
    allocations.map((a) => a.order).filter(Boolean).map(String)
  )];
  const orders = orderIds.length
    ? await models.JhatkaOrder.find({ _id: { $in: orderIds } })
      .select('_id customer lifecycle deliveredAt outlet')
      .lean()
    : [];
  const byOrderId = new Map(orders.map((o) => [String(o._id), o]));

  const enriched = allocations.map((a) => {
    const order = a.order ? byOrderId.get(String(a.order)) : null;
    return {
      ...a,
      orderLifecycle: order?.lifecycle || null,
      customer: a.customer || order?.customer || null,
      customerId: a.customer || order?.customer || null,
    };
  });

  const scope = assessRecallScope(enriched);
  const now = new Date();

  const affectedCustomers = scope.affectedCustomers
    .filter((c) => c.customer)
    .map((c) => ({
      customer: c.customer,
      orders: c.orders.map((o) => ({
        order: o.order || o,
        deliveredAt: (typeof o === 'object' ? byOrderId.get(String(o.order || o))?.deliveredAt : undefined) || undefined,
      })),
      // `notifiedAt` and `channel` are DELIBERATELY left unset here. They used to be
      // `now` and `'in_app'` at the instant the affected set was computed, which made
      // the record claim a delivery that had not been attempted. They are written from
      // the transport result below, per entry, so "who was told" is answerable.
      notifiedAt: undefined,
      channel: undefined,
    }));

  // Undelivered orders stop where they are, where the table allows it. States
  // without an ON_HOLD edge (e.g. DELIVERED-adjacent or terminal) stay put and
  // remain counted in undeliveredCount for the console.
  let heldCount = 0;
  for (const o of scope.affectedOrders) {
    if (!o.lifecycle || o.lifecycle === 'DELIVERED') continue;
    const doc = byOrderId.get(String(o.order));
    if (!doc) continue;
    if (!models.JhatkaOrder.canTransition(doc.lifecycle, 'ON_HOLD')) continue;
    await models.JhatkaOrder.updateOne(
      { _id: doc._id },
      {
        $set: {
          lifecycle: 'ON_HOLD',
          hold: {
            onHoldAt: now,
            reason: `Batch recall ${recall.recallNo}`,
            batch: batchId,
          },
        },
      }
    );
    heldCount += 1;
  }

  recall.affectedOrderItems = {
    queriedAt: now,
    count: scope.affectedOrders.length,
    sampleOrderItemIds: allocations
      .map((a) => a.orderItem)
      .filter(Boolean)
      .slice(0, 100),
  };
  recall.affectedCustomers = affectedCustomers;
  recall.undeliveredCount = scope.undeliveredCount;
  if (recall.requiresCustomerNotification() && affectedCustomers.length) {
    recall.status = 'notifying';
  }
  await recall.save();

  // §5.4. Fan out — for REAL, and record what actually happened.
  //
  // The previous implementation wrote `recall.notifiedCount = affectedCustomers.length`
  // and stopped. Since `fullyAcknowledged()` tests `acknowledgedCount === notifiedCount`
  // and nothing ever acknowledged anything, that number was both a lie and inert. An
  // operator closing a recall reads it.
  //
  // So the fan-out runs here, and `notifiedCount` is written by `markNotified` from the
  // TRANSPORT's result. When there is no Firebase admin app — every dev and staging
  // environment — the result is `no_admin_app`, the count stays 0, the reason is
  // recorded, and `fullyAcknowledged()` correctly returns false. A recall that cannot
  // prove it reached its customers must not be closeable as though it had.
  let notification = { attempted: 0, delivered: 0, reason: 'not_required' };
  if (recall.requiresCustomerNotification() && affectedCustomers.length) {
    notification = await notifyService.notifyAffectedCustomers(affectedCustomers, {
      batchNo: batchForMessage?.batchNo,
      reason: recall.reason,
      actionNote: 'Please do not consume the product. A refund or replacement is being arranged.',
    });

    notifyService.markNotified(recall, notification);

    // Stamp the entries the transport confirmed. Done per-entry rather than blanket,
    // so a partial fan-out leaves an accurate picture of who is still unreached.
    const delivered = new Set(notification.deliveredCustomers || []);
    recall.affectedCustomers = recall.affectedCustomers.map((c) =>
      delivered.size === 0 || delivered.has(String(c.customer))
        ? { ...c.toObject?.() ?? c, notifiedAt: new Date(), channel: 'push' }
        : c
    );

    if (notification.reason === 'sent' && !notification.failures?.length) {
      recall.status = 'open';
    }
    await recall.save();
  }

  return {
    status: recall.status,
    summary: {
      affectedOrders: scope.affectedOrders.length,
      affectedCustomers: affectedCustomers.length,
      undelivered: scope.undeliveredCount,
      held: heldCount,
      notifiedCount: recall.notifiedCount,
      notificationReason: notification.reason,
    },
  };
}

/**
 * Close a recall. The notification fan-out is a scheduled job, not part of this call:
 * a recall that waits for somebody to remember it is not a recall.
 */
async function closeRecall({ models, outletId, recall: recallId }) {
  const recall = await models.JhatkaRecall.findOne({ _id: recallId, outlet: outletId });
  if (!recall) throw new ApiError(httpStatus.NOT_FOUND, 'Recall not found for this outlet');
  if (recall.status === 'closed') {
    throw new ApiError(httpStatus.CONFLICT, 'Recall is already closed');
  }

  recall.status = 'closed';
  recall.closedAt = new Date();
  await recall.save();

  return {
    recall: {
      id: String(recall._id),
      recallNo: recall.recallNo,
      status: recall.status,
      closedAt: recall.closedAt,
      notifiedCount: recall.notifiedCount,
      acknowledgedCount: recall.acknowledgedCount,
    },
  };
}

module.exports = { openRecall, closeRecall, scopeRecall, RECALL_SEVERITIES };