/**
 * jhatka.weigh.service.js — weight confirmation for partner orders.
 *
 * ## Why this exists
 *
 * `jhatka.partner.orders.route.js` ran ~490 lines of weigh logic inline. Every
 * defect the integration suite found in this vertical lived inside that block —
 * a 100× money mix-up, a lifecycle transition that validated but never applied, a
 * `finalTotal` that forgot tax, a replay that crashed on a unique index. None of
 * them were findable by reading the route, because the route is where the rules
 * were *described* rather than the place where they were checked. Extracting them
 * makes the unit-testable surface match the bug-prone surface.
 *
 * ## Contract
 *
 *   weighOrder({ order, outlet, actor, items, evidence, override })
 *     -> { replayed: true, order, confirmations: [confirmation] }
 *     -> { replayed: false, order, confirmations, codTolerancePct, collectable }
 *
 * The service PERSISTS nothing itself beyond the confirmations, flags and refunds
 * it creates, and the caller saves `order` — no. It saves the order too: the
 * lifecycle and totals must land atomically with the confirmations, and splitting
 * that across a route would reintroduce the "validated but never applied" class of
 * bug. The service owns the save; the route owns HTTP.
 *
 * ## Money discipline (the rule this file exists to keep)
 *
 *   `reconcileWeight` returns PAISE. `*Paise` model fields store PAISE.
 *   `moneyField` SETTERS take RUPEES and GETTERS return RUPEES.
 *
 * Every crossing of that boundary goes through `asMoney` (paise -> rupees) or
 * `toPaiseAmount` (rupees -> paise). A computed paise value assigned straight to a
 * `moneyField` is 100× too large; a getter read added into a paise accumulator is
 * 100× too small. Both happened here, and both are silent.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { reconcileWeight, codCollectablePaise } = require('../utils/weight.arithmetic');
const { toGrams } = require('../utils/quantity');
const { asMoney, toPaiseAmount } = require('../utils/money');
// Platform defaults sit BEHIND category and outlet (tightening-only): with
// nothing saved the getters return the same literals below, so behavior is
// identical until an admin saves the settings screen.
const jhatkaSettingsService = require('../../../services/jhatka.settings.service');
const notifyService = require('./jhatka.notify.service');
const lifecycleService = require('./jhatka.order-lifecycle.service');

/**
 * Resolve the weight policy for an order item.
 *
 * §16.2 VW-11 and the `policy.source` enum on `JhatkaWeightConfirmation` both
 * require the policy to be RECORDED at confirmation time, because a refund months
 * later must use the rate that was in force when the weight was taken.
 *
 * Precedence, per the model's own enum:
 *   category.weightPolicy                       -> 'category'
 *   outlet.orderConfig (tightening only)        -> 'outlet'
 *   category, then a TIGHTER outlet override    -> 'category_then_outlet_tightened'
 *
 * "Tightening only" is the important word: an outlet may make its own guarantee
 * stricter (a 3% tolerance instead of 5%) but never looser, because loosening
 * would be the outlet deciding it may over-deliver to the customer without
 * consequence. That asymmetry is enforced by taking the MINIMUM of the two.
 */
async function resolvePolicy(item, outlet, models) {
  const { JhatkaProduct, JhatkaCategory } = models;

  const product = await JhatkaProduct.findById(item.product).select('category').lean();
  const category = product ? await JhatkaCategory.findById(product.category).lean() : null;

  const cat = category?.weightPolicy || {};
  const out = outlet.orderConfig || {};
  const platform = await jhatkaSettingsService.getWeightPolicy();

  const tolerancePct = Number(cat.tolerancePct ?? platform.tolerancePct);
  const hardOverchargePct = Number(cat.hardOverchargePct ?? platform.hardOverchargePct);
  const hardShortfallPct = Number(cat.hardShortfallPct ?? platform.hardShortfallPct);

  const outTolerance =
    out.weightTolerancePct === undefined || out.weightTolerancePct === null
      ? null
      : Number(out.weightTolerancePct);
  const outOver =
    out.weightHardOverchargePct === undefined || out.weightHardOverchargePct === null
      ? null
      : Number(out.weightHardOverchargePct);
  const outShort =
    out.weightHardShortfallPct === undefined || out.weightHardShortfallPct === null
      ? null
      : Number(out.weightHardShortfallPct);

  const tightened =
    (outTolerance !== null && outTolerance < tolerancePct) ||
    (outOver !== null && outOver < hardOverchargePct) ||
    (outShort !== null && outShort > hardShortfallPct);

  // Take the stricter of the two for every bound.
  return {
    tolerancePct: outTolerance !== null ? Math.min(tolerancePct, outTolerance) : tolerancePct,
    hardOverchargePct: outOver !== null ? Math.min(hardOverchargePct, outOver) : hardOverchargePct,
    hardShortfallPct: outShort !== null ? Math.max(hardShortfallPct, outShort) : hardShortfallPct,
    codTolerancePct: Number(cat.codTolerancePct ?? 0),
    source:
      outTolerance === null && outOver === null && outShort === null
        ? 'category'
        : tightened
          ? 'category_then_outlet_tightened'
          : 'outlet',
  };
}

/**
 * Weigh one or more lines on an order, persisting confirmations, variance flags,
 * refunds and the order's own totals and lifecycle.
 *
 * @param {object}   p
 * @param {object}   p.order     HYDRATED `JhatkaOrder` (moneyField getters -> rupees)
 * @param {object}   p.outlet    `JhatkaOutlet`, lean is fine
 * @param {object}   p.actor     `{ _id, name }` of the person weighing
 * @param {object}   p.body      `{ items, evidence, override }` from the request
 * @param {object}   p.models    `{ JhatkaWeightConfirmation, JhatkaRefund, ... }`
 * @param {Function} p.nextNumber        id generator, from the route module
 * @returns {Promise<{replayed: boolean, order: object, confirmations: Array}>}
 *
 * The lifecycle guard is NOT a parameter. It used to be, injected by the route on
 * every call, which meant the transition rule had as many owners as it had callers.
 * It now resolves `jhatka.order-lifecycle.service` directly, like every other caller.
 */
/**
 * B6 (§5.4) — consume the ACTUAL grams FEFO across live batches.
 *
 * One order line routinely draws on more than one batch (0.9 kg from the
 * morning batch, 0.1 kg from yesterday's), which is why the batch→order join
 * is many-to-many. Previously weigh wrote NOTHING to batches or inventory:
 * `item.allocations` was an echo of caller-supplied `entry.batchAllocations`,
 * so stock never moved and recall traceability had no consumption rows.
 *
 * Rules:
 * - Candidates are variant-keyed rows of kind raw|prepared, unexpired, FEFO.
 * - Each take is a guarded conditional update (`availableQty >= plain`), so two
 *   concurrent weighs cannot claim the same gram.
 * - Ledger math per take: `onHand -= take`, `reserved -= rel` (releasing any
 *   prior reservation hold), `availableQty -= plain`. `rel = min(reserved, take)`.
 * - Per-batch `CONSUMPTION` allocation rows + `ORDER_CONSUMPTION` movements +
 *   batch `availableQty/consumedQty` move with every take.
 * - Shortfall does NOT throw. The meat is already cut: refusing the confirmation
 *   strands the operator with no path forward (there is no un-cut), and drops the
 *   already-computed actualQuantity with it. Stock gating belongs at accept /
 *   start-preparation, which already refuses unfulfillable orders before the
 *   ticket is persisted. Here the partial takes are KEPT (they are real
 *   consumption) and the gap is returned as `shortfallGrams`, so the ledger
 *   stays truthful instead of blocking truthfully-recorded reality.
 * - No stock rows at all for the variant → untracked (not a failure): shops
 *   that never modelled a variant's stock keep weighing as before.
 *
 * @returns {{takes: Array<{batch, inventoryItem, qty}>, shortfallGrams: number, untracked: string|null}}
 */
async function consumeLineStock({ models, order, item, actualGrams, actor }) {
  const { JhatkaInventoryItem, JhatkaInventoryMovement, JhatkaBatch, JhatkaBatchAllocation } = models || {};
  if (!JhatkaInventoryItem || !JhatkaBatch || !JhatkaBatchAllocation) {
    return { takes: [], shortfallGrams: 0, untracked: 'no-inventory-models' };
  }

  const want = Math.round(Number(actualGrams) || 0);
  if (want <= 0) return { takes: [], shortfallGrams: 0, untracked: 'non-positive-actual' };

  const candidates = await JhatkaInventoryItem.find({
    outlet: order.outlet,
    variant: item.variant,
    kind: { $in: ['raw', 'prepared'] },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  })
    .sort({ expiresAt: 1, createdAt: 1 })
    .select('_id batch onHand reserved availableQty quarantined unit expiresAt kind')
    .lean();

  // Only rows that can actually be consumed count. A batch-less row (like a
  // hand-created adjustment row) or an expired one is not sellable stock: treating
  // it as a candidate turns "no modelled stock" into a false 409 shortfall and
  // blocks weighing for shops that never modelled the variant.
  const now = Date.now();
  const usable = candidates.filter(
    (r) => r.batch && !(r.expiresAt && new Date(r.expiresAt).getTime() <= now)
  );
  if (!usable.length) return { takes: [], shortfallGrams: 0, untracked: 'no-stock-rows' };

  const business = order.business;
  if (!business) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Cannot consume stock without a business — it is required on JhatkaBatchAllocation',
      true,
      '',
      { code: 'BUSINESS_UNKNOWN' }
    );
  }

  // All arithmetic here is GRAMS; rows may be denominated in KG. Comparing raw
  // numbers across units once turned a 5 KG reserved row into "5 grams" and
  // refused a weigh that had stock — a false shortfall that also dropped the
  // already-computed actualQuantity (the save comes later). Rows in
  // non-convertible units (PIECE, DOZEN, TIER) are skipped: a WEIGHT line never
  // draws on them.
  const gramsPer = (unit) => (unit === 'GRAM' ? 1 : unit === 'KG' ? 1000 : null);

  let remaining = want;
  const takes = [];
  const applied = [];

  for (const cand of usable) {
    if (remaining <= 0) break;
    const factor = gramsPer(cand.unit);
    if (!factor) continue;
    const availG = Number(cand.availableQty || 0) * factor;
    const resvG = Number(cand.reserved || 0) * factor;
    const takeG = Math.min(remaining, availG + resvG);
    if (takeG <= 0) continue;
    const relG = Math.min(resvG, takeG);
    const plainG = takeG - relG;
    const take = takeG / factor;
    const rel = relG / factor;
    const plain = plainG / factor;

    const updated = await JhatkaInventoryItem.findOneAndUpdate(
      {
        _id: cand._id,
        availableQty: { $gte: plain },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      },
      { $inc: { onHand: -take, reserved: -rel, availableQty: -plain } },
      { new: true }
    );
    if (!updated) continue;

    if (JhatkaInventoryMovement) {
      const movementSeq = (updated.movementSeq || 0) + 1;
      await JhatkaInventoryMovement.create({
        outlet: order.outlet,
        inventoryItem: updated._id,
        kind: updated.kind || 'raw',
        movementType: 'ORDER_CONSUMPTION',
        qtyDelta: -take,
        reservedDelta: -rel,
        onHandAfter: updated.onHand,
        reservedAfter: updated.reserved,
        availableAfter: updated.availableQty,
        reason: `Weighed ${take}g for order ${order.orderNo || order._id}`,
        referenceType: 'JhatkaOrder',
        referenceId: order._id,
        movementSeq,
        performedBy: actor?._id,
        performedByName: actor?.name,
      });
      await JhatkaInventoryItem.updateOne({ _id: updated._id }, { movementSeq });
    }

    const batch = await JhatkaBatch.findOneAndUpdate(
      { _id: cand.batch },
      { $inc: { availableQty: -take, consumedQty: take } },
      { new: true }
    );

    await JhatkaBatchAllocation.create({
      batch: cand.batch,
      outlet: order.outlet,
      business,
      allocationType: 'CONSUMPTION',
      qtyDelta: -take,
      qtyAfter: batch ? batch.availableQty : undefined,
      order: order._id,
      orderItem: item._id,
      referenceType: 'JhatkaOrder',
      referenceId: order._id,
      occurredAt: new Date(),
      occurredBy: actor?._id,
      occurredByName: actor?.name,
      note: `Weighed ${take}g of ${want}g for order line ${item.sku}`,
    });

    takes.push({ batch: cand.batch, inventoryItem: updated._id, qty: takeG });
    applied.push({ inventoryItem: updated._id, batch: cand.batch, take, rel });
    remaining -= takeG;
  }

  // Partial takes are kept and the gap is reported, never thrown (see above).
  // `applied` is retained for a future compensating path; today there is none
  // because un-consuming cut meat would be the fiction, not the fix.
  void applied;

  return { takes, shortfallGrams: remaining, untracked: null };
}

async function weighOrder({ order, outlet, actor, body, models, nextNumber }) {
  const {
    JhatkaWeightConfirmation,
    JhatkaRefund,
    JhatkaOutletVarianceFlag,
  } = models;

  const { items, evidence, override } = body || {};

  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items is required');
  }

  // VW-07: a COUNT line must NOT reach this endpoint. The blueprint asks for a
  // 409 NOT_VARIABLE_WEIGHT rather than a 400 validation error, because "you
  // cannot weigh eggs" is a domain refusal, not a malformed request.
  const countLines = order.items.filter((i) => i.measurementMode === 'COUNT');
  if (countLines.length) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'This order contains COUNT variants, which are not weighed',
      true,
      '',
      { code: 'NOT_VARIABLE_WEIGHT', skus: countLines.map((i) => i.sku) }
    );
  }

  // VW-08: WEIGHT_CONFIRMED must precede PACKING.
  //
  // The guard is resolved from `jhatka.order-lifecycle.service` rather than from the
  // injected parameter. Three callers used to pass three different transition guards
  // into business logic; this is the one that matters, and it now has one owner.
  if (!['WEIGHING', 'WEIGHT_CONFIRMED'].includes(order.lifecycle)) {
    lifecycleService.assertTransition(order.lifecycle, 'WEIGHING');
    order.lifecycle = 'WEIGHING';
  }

  const confirmations = [];
  let weightAdjustmentTotal = 0;
  let absorbedOverchargeTotal = 0;
  let refundTotal = 0;

  for (const entry of items) {
    const item = order.items.id(entry.orderItem || entry.itemId);
    if (!item) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Item ${entry.orderItem || entry.itemId} not on this order`);
    }
    if (item.measurementMode !== 'WEIGHT') {
      throw new ApiError(httpStatus.CONFLICT, `Line ${item.sku} is COUNT, not weighed`, true, '', {
        code: 'NOT_VARIABLE_WEIGHT',
      });
    }

    const actual = entry.actualQuantity;
    if (!actual || typeof actual.value !== 'number' || actual.value <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'actualQuantity.value must be > 0');
    }
    if (!actual.unit) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'actualQuantity.unit is required');
    }

    const policy = await resolvePolicy(item, outlet, models);

    // VW-10 — REPLAY IDEMPOTENCY.
    //
    // A duplicate POST (double-tap, client retry, flaky network) sends the SAME
    // weights again. That is not a new weighing: it must not mint a second
    // confirmation, a second refund, or a second adjustment.
    //
    // Compared against the CURRENT confirmation only, and on grams after unit
    // normalisation, so `900 GRAM` and `0.9 KG` are recognised as the same weighing.
    const currentConf = await JhatkaWeightConfirmation.findOne({
      order: order._id,
      orderItem: item._id,
      isCurrent: true,
    }).lean();

    if (currentConf && entry.actualQuantity) {
      const replayGrams = toGrams(entry.actualQuantity);
      if (replayGrams === currentConf.actualQuantity.value) {
        return {
          replayed: true,
          order: {
            id: String(order._id),
            lifecycle: order.lifecycle,
            finalTotal: order.finalTotal,
            refundedAmount: order.refundedAmount,
          },
          confirmations: [currentConf],
        };
      }
    }

    const result = reconcileWeight({
      requestedQty: item.requestedQuantity,
      actualQty: actual,
      // `item.unitPrice` is a moneyField on a hydrated document, so the getter
      // returns RUPEES. `reconcileWeight` takes PAISE. Passing the getter value
      // straight through made every adjustment 100× too small — a 10% shortfall on
      // a Rs 400 line refunded Rs 0.40 instead of Rs 40. Nothing threw; the
      // arithmetic was simply wrong by a factor of a hundred.
      unitPricePaise: toPaiseAmount(item.unitPrice),
      priceBasis: item.priceBasis,
      policy,
    });

    // VW-05: an overage beyond the hard cap is REFUSED unless an override reason is
    // present. Note it is refused — never converted into a larger charge.
    if (result.direction === 'override_required' && !(override && override.reason)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Weight for ${item.sku} is ${result.variancePct}% over, above the ${policy.hardOverchargePct}% hard cap. A manager override with a reason is required, and the overage will be absorbed, not charged.`,
        true,
        '',
        {
          code: 'WEIGHT_OVERRIDE_REQUIRED',
          sku: item.sku,
          variancePct: result.variancePct,
          hardOverchargePct: policy.hardOverchargePct,
        }
      );
    }

    const isOverride = result.direction === 'override_required';
    const attempted =
      (await JhatkaWeightConfirmation.countDocuments({ orderItem: item._id })) + 1;

    // VW-06: a reweigh supersedes rather than mutates, and only the current attempt
    // carries `isCurrent`. Evidence of what was claimed first is the whole point of
    // keeping the previous record.
    await JhatkaWeightConfirmation.updateMany({ orderItem: item._id, isCurrent: true }, { isCurrent: false });

    const taxRatePctUsed = item.taxRatePct || 0;
    const taxReversalPaise = result.refundablePaise
      ? Math.round((result.refundablePaise * taxRatePctUsed) / 100)
      : 0;

    const confirmation = new JhatkaWeightConfirmation({
      confirmationNo: nextNumber('WC'),
      order: order._id,
      orderItem: item._id,
      outlet: order.outlet,
      attempt: attempted,
      isCurrent: true,
      requestedQuantity: item.requestedQuantity,
      actualQuantity: actual,
      estimatedAmountPaise: result.estimatedAmountPaise,
      finalAmountPaise: result.finalAmountPaise,
      deltaPaise: result.deltaPaise,
      refundablePaise: result.refundablePaise,
      taxReversalPaise,
      netRefundPaise: Math.max(0, result.refundablePaise - taxReversalPaise),
      ratio: result.ratio,
      variancePct: result.variancePct,
      varianceGrams: Math.round((toGrams(actual) || 0) - (toGrams(item.requestedQuantity) || 0)),
      direction: result.direction,
      withinTolerance: result.withinTolerance,
      exceedsHardOvercharge: result.exceedsHardOvercharge,
      breachesShortfallFloor: result.breachesShortfallFloor,
      note: result.note,
      policy: {
        tolerancePct: policy.tolerancePct,
        hardOverchargePct: policy.hardOverchargePct,
        hardShortfallPct: policy.hardShortfallPct,
        source: policy.source,
      },
      // VW-11: the tax rate is SNAPSHOTTED here, never re-read at refund time.
      taxRatePctUsed,
      weighedBy: actor._id,
      weighedByName: actor.name,
      weighedAt: new Date(),
      override: isOverride
        ? {
            by: actor._id,
            byName: actor.name,
            reason: override.reason,
            at: new Date(),
            approvedBy: override.approvedBy,
          }
        : undefined,
      evidence: evidence
        ? {
            photoUrl: evidence.photoUrl,
            ticketNo: evidence.ticketNo,
            ticketPhotoUrl: evidence.ticketPhotoUrl,
            capturedAt: evidence.capturedAt || new Date(),
            deviceId: evidence.deviceId,
          }
        : undefined,
      batchAllocations: entry.batchAllocations,
      trimQty: entry.trimQty,
      yieldActualPct: entry.yieldActualPct,
    });

    const confirmError = confirmation.validateSync();
    if (confirmError) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Weight confirmation failed validation', true, '', {
        fields: Object.keys(confirmError.errors),
      });
    }
    await confirmation.save();

    // ---- apply to the line (VW-09: one write, or none) --------------------
    item.actualQuantity = actual;
    // `result.*` are PAISE; `asMoney` converts to the RUPEES a moneyField setter
    // expects. Never mix a getter read here with a paise value.
    item.finalAmount = asMoney(result.finalAmountPaise);
    item.deltaAmount = asMoney(result.deltaPaise);
    item.adjustmentDirection = result.direction;
    // BR-06: an overage is absorbed by the platform. `absorbedAmount` is the part of
    // the overage the customer is NOT charged.
    item.absorbedAmount = asMoney(result.deltaPaise > 0 ? result.deltaPaise : 0);
    item.refundedAmount = asMoney(result.refundablePaise);
    item.varianceGrams = confirmation.varianceGrams;
    item.variancePct = result.variancePct;
    item.withinTolerance = result.withinTolerance;
    item.weightEvidence = evidence
      ? {
          photoUrl: evidence.photoUrl,
          ticketNo: evidence.ticketNo,
          ticketPhotoUrl: evidence.ticketPhotoUrl,
          capturedAt: evidence.capturedAt || new Date(),
          deviceId: evidence.deviceId,
        }
      : undefined;
    if (isOverride) {
      item.override = { by: actor._id, byName: actor.name, reason: override.reason, at: new Date() };
    }
    // B6: the server computes batch provenance FEFO; a caller-supplied
    // `entry.batchAllocations` is not trusted for ledger writes.
    const consumed = await consumeLineStock({
      models,
      order,
      item,
      actualGrams: toGrams(actual) || 0,
      actor,
    });
    if (consumed.takes.length) {
      item.allocations = consumed.takes.map((t) => ({
        batch: t.batch,
        qty: t.qty,
        allocatedAt: new Date(),
      }));
    } else if (entry.batchAllocations) {
      item.allocations = entry.batchAllocations;
    }

    // PAISE, straight from `reconcileWeight`. Reading `item.absorbedAmount` here
    // would be a getter read (rupees) mixed into a paise accumulator.
    weightAdjustmentTotal += result.deltaPaise;
    absorbedOverchargeTotal += result.deltaPaise > 0 ? result.deltaPaise : 0;
    refundTotal += result.refundablePaise;

    // A variance flag is written for BOTH tails: over is the theft vector, under is
    // the outlet eating the customer's money to win a refund-free reputation.
    if (result.exceedsHardOvercharge || result.breachesShortfallFloor) {
      const direction = result.exceedsHardOvercharge ? 'over' : 'under';
      const selfApproved = isOverride && String(actor._id) === String(item.override?.by);
      await JhatkaOutletVarianceFlag.create({
        outlet: order.outlet,
        order: order._id,
        orderItem: item._id,
        weightConfirmation: confirmation._id,
        direction,
        ratio: result.ratio,
        variancePct: result.variancePct,
        requestedGrams: toGrams(item.requestedQuantity) || 0,
        actualGrams: toGrams(actual) || 0,
        policy: {
          tolerancePct: policy.tolerancePct,
          hardOverchargePct: policy.hardOverchargePct,
          hardShortfallPct: policy.hardShortfallPct,
        },
        wasOverridden: isOverride,
        overrideBy: isOverride ? actor._id : undefined,
        selfApproved: selfApproved || undefined,
        action: 'observed',
        flaggedAt: new Date(),
      });
    }

    // VW-04: an automatic refund, no ticket and no user action.
    //
    // UNIT NOTE: `JhatkaWeightConfirmation` stores its money as PLAIN numbers whose
    // names end in `Paise` — no moneyField, no conversion. `JhatkaRefund.amount/
    // taxAmount/netAmount` ARE moneyField, so they take rupees. The `*Paise` suffix
    // is a deliberate signal of "already in paise, do not convert".
    if (result.refundablePaise > 0) {
      await JhatkaRefund.create({
        refundNo: nextNumber('RF'),
        order: order._id,
        orderItem: item._id,
        outlet: order.outlet,
        business: order.business,
        customer: order.customer,
        // The financial leg the settlement engine credits.
        componentKey: `weight:${item.sku}`,
        // The enum is UPPERCASE — `weight_shortfall` is not a member and fails
        // validation.
        reason: 'WEIGHT_ADJUSTMENT',
        // §13.2/OD-2: the shortfall is borne by the platform (LocalWala is MoR),
        // not charged back to the outlet.
        fundingSource: 'platform_absorbed',
        amount: asMoney(result.refundablePaise),
        taxAmount: asMoney(taxReversalPaise),
        netAmount: asMoney(confirmation.netRefundPaise),
        reasonNote: result.note,
        weightConfirmation: confirmation._id,
        // A refund always starts PENDING and is settled by the gateway job, which is
        // what makes it auditable. For COD the amount goes back as platform credit.
        status: 'REFUND_PENDING',
        attempts: 0,
      });
    }

    confirmations.push({
      orderItem: String(item._id),
      sku: item.sku,
      // Grams the ledger could not cover from live batches (0 when fully
      // covered or untracked). The confirmation still stands: see consumeLineStock.
      stockShortfallGrams: consumed.shortfallGrams || 0,
      confirmationNo: confirmation.confirmationNo,
      attempt: attempted,
      requestedQuantity: confirmation.requestedQuantity,
      actualQuantity: confirmation.actualQuantity,
      estimatedAmountPaise: confirmation.estimatedAmountPaise,
      finalAmountPaise: confirmation.finalAmountPaise,
      deltaPaise: confirmation.deltaPaise,
      refundablePaise: confirmation.refundablePaise,
      direction: confirmation.direction,
      variancePct: confirmation.variancePct,
      withinTolerance: confirmation.withinTolerance,
      policy: confirmation.policy,
      isOverride,
    });
  }

  // ---- order-level totals (VW-01) ------------------------------------------
  // UNIT DISCIPLINE: the running totals below are PAISE; `order.<moneyField>` reads
  // give RUPEES. Convert the getter read back to PAISE before adding, and convert to
  // RUPEES on assignment. Mixing the two silently produces a 100× total.
  const existingAdjustmentPaise = toPaiseAmount(order.weightAdjustmentTotal || 0);
  const existingAbsorbedPaise = toPaiseAmount(order.absorbedOverchargeTotal || 0);
  const existingRefundedPaise = toPaiseAmount(order.refundedAmount || 0);

  order.weightAdjustmentTotal = asMoney(existingAdjustmentPaise + weightAdjustmentTotal);
  order.absorbedOverchargeTotal = asMoney(existingAbsorbedPaise + absorbedOverchargeTotal);
  order.refundedAmount = asMoney(existingRefundedPaise + refundTotal);

  // Only advance to WEIGHT_CONFIRMED once EVERY weight line is confirmed.
  const weightLines = order.items.filter((i) => i.measurementMode === 'WEIGHT');
  const allConfirmed = weightLines.length > 0 && weightLines.every((i) => i.actualQuantity);

  if (allConfirmed) {
    // BR-06, and this is the line that makes it true.
    //
    // A line's `finalAmount` is what the MEAT was WORTH — 1.2 kg at Rs 400/kg is
    // Rs 480. What the CUSTOMER PAYS is that MINUS whatever the platform absorbed.
    // Summing `finalAmount` and calling it `finalTotal` charges the customer for meat
    // they were not billed for, which is the exact thing VW-01 forbids.
    let finalPaiseSum = 0;
    weightLines.forEach((i) => {
      const lineFinal = toPaiseAmount(i.finalAmount ?? i.estimatedAmount ?? 0);
      const absorbed = toPaiseAmount(i.absorbedAmount || 0);
      const refunded = toPaiseAmount(i.refundedAmount || 0);
      // An over-delivery has `absorbed > 0` and `refunded == 0`; a shortfall has
      // `refunded > 0` and `absorbed == 0`. They never both apply.
      finalPaiseSum += lineFinal - absorbed - refunded;
    });
    order.items
      .filter((i) => i.measurementMode === 'COUNT')
      .forEach((i) => {
        finalPaiseSum += toPaiseAmount(i.lineTotal ?? 0);
      });

    // Add the tax that `estimatedTotal` already includes, so the two are comparable.
    // `estimatedTotal` = itemsSubtotal + taxTotal, but summing only line amounts here
    // produced a `finalTotal` that was ALWAYS short by exactly the tax — a Rs 420
    // estimate persisted as Rs 400 and BR-06 passed for the wrong reason.
    finalPaiseSum += toPaiseAmount(order.taxTotal || 0);

    order.finalTotal = asMoney(finalPaiseSum);

    // VW-01 checked against the figure ACTUALLY persisted. An earlier check ran
    // BEFORE `finalTotal` was assigned, so on a first weigh it compared against a
    // stale value and let a Rs 480 order through as "charged Rs 420".
    const chargedAfterWeigh = toPaiseAmount(order.finalTotal);
    const estimatedPaiseNow = toPaiseAmount(order.estimatedTotal || 0);
    if (chargedAfterWeigh > estimatedPaiseNow) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        'Refused: the order would charge above its estimate (BR-06)',
        true,
        '',
        {
          estimatedPaise: estimatedPaiseNow,
          wouldChargePaise: chargedAfterWeigh,
          excessPaise: chargedAfterWeigh - estimatedPaiseNow,
        }
      );
    }

    if (order.lifecycle === 'WEIGHING') {
      order.lifecycle = 'WEIGHT_CONFIRMED';
    }
    order.weightConfirmedAt = new Date();
  }

  await order.save();

  // §3.8. Notify the customer that the weight is settled — and, critically, that the
  // number they are charged has NOT changed.
  //
  // This is NOT an approval gate. The meat is cut, weighed and bagged before a rider
  // exists, so there is nothing for the customer to approve; the notification exists so
  // the number quoted at the door is the number they were told, which is the whole of
  // §3.3's promise to a first-time buyer.
  //
  // Placed AFTER the save so a push failure cannot roll back a completed weigh.
  //
  // No replay guard is needed, and that is worth being explicit about: VW-10's replay
  // branch RETURNS EARLY, at the top of the per-line loop, before any of this runs. So
  // reaching this point is itself proof that at least one line was genuinely re-weighed
  // — adding a `replayed` flag here would be testing a variable that does not exist.
  //
  // Gated on `WEIGHT_CONFIRMED` because a part-weighed basket has no final number to
  // report, and reporting a partial one would be worse than reporting nothing.
  if (order.lifecycle === 'WEIGHT_CONFIRMED') {
    const weighedGrams = (order.items || [])
      .filter((i) => i.measurementMode === 'WEIGHT' && i.actualQuantity)
      .reduce((sum, i) => sum + Number(i.actualQuantity?.value || 0), 0);

    await notifyService.notifyCustomer(
      order.customer,
      'weight_confirmed',
      notifyService.buildWeightConfirmationContext(order, {
        actualGrams: weighedGrams,
        absorbedPaise: absorbedOverchargeTotal,
        refundedPaise: refundTotal,
        toleranceApplied: confirmations.every((c) => c.withinTolerance),
      })
    );
  }

  // COD is frozen HERE, at weight confirmation, and never recomputed later — so what
  // the rider may collect cannot drift from what was agreed at the counter.
  const codTolerancePct = await resolveCodTolerance(order, models);
  const collectable =
    order.codAmount && order.finalTotal
      ? codCollectablePaise(order.estimatedTotal, order.finalTotal, codTolerancePct)
      : 0;

  return {
    replayed: false,
    order,
    confirmations,
    codTolerancePct,
    collectable,
  };
}

/**
 * Resolve the COD tolerance for an order, read from the FIRST weight line's category.
 *
 * Deliberately simple: one tolerance per order. A mixed basket (chicken + fish)
 * with two different tolerance bands would need a per-line ceiling, and the rider
 * collects ONE amount against one order — so the tightest applicable band governs
 * the whole order.
 *
 * Falls back to the 10% default that `codCeilingPaise` itself uses. Moved here
 * VERBATIM from the route, defaults included: a refactor that quietly changes a
 * fallback is a refactor that quietly changes what riders may collect.
 */
async function resolveCodTolerance(order, models) {
  const { JhatkaProduct, JhatkaCategory } = models;

  const firstWeightLine = (order.items || []).find((i) => i.measurementMode === 'WEIGHT');
  if (!firstWeightLine) return 10;

  const product = await JhatkaProduct.findById(firstWeightLine.product)
    .select('category')
    .lean();
  if (!product?.category) return 10;

  const category = await JhatkaCategory.findById(product.category)
    .select('weightPolicy.codTolerancePct')
    .lean();

  const perCategory = category?.weightPolicy?.codTolerancePct;
  if (perCategory !== undefined && perCategory !== null) return Number(perCategory);
  return jhatkaSettingsService.getCodTolerancePct();
}

module.exports = { weighOrder, resolvePolicy, resolveCodTolerance };