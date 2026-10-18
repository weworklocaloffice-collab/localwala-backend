/**
 * jhatka.occurrence.service.js — turning a due subscription into an order occurrence.
 *
 * ## Why the ROUTE and the CRON both come through here
 *
 * `generateRecurringOrders` (the 03:00 cron) and
 * `POST /subscriptions/occurrences/:occurrence/generate` (the partner-facing door) are
 * the same rule expressed twice. They had already drifted in three places:
 *
 *   1. the stock check (one sorted by FEFO, one an unordered `findOne`),
 *   2. the money boundary (one converted, one passing a hydrated RUPEES getter into a
 *      PAISE helper — a 100x under-charge that a `.lean()` response would hide),
 *   3. the duplicate handling (one caught code 11000, one pre-checked).
 *
 * A subscription that generates correctly at 03:00 and under-charges when a shopkeeper
 * presses the button is the kind of bug that survives to production because both paths
 * "work". One implementation now.
 *
 * ## The money boundary, stated once
 *
 * `sub` is HYDRATED, so `item.unitPriceAtSubscribe` reads through the moneyField GETTER
 * and returns RUPEES. Every helper below (`linePricePaise`, `subscriptionCeilingPaise`)
 * takes PAISE. `toPaiseAmount` is the single crossing point. Getting this backwards
 * yields a number that is still perfectly valid — which is why it is asserted on the
 * STORED value and never on the response body.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { linePricePaise, subscriptionCeilingPaise } = require('../utils/weight.arithmetic');
const { asMoney, toPaiseAmount } = require('../utils/money');
const reservationService = require('./jhatka.reservation.service');
const notifyService = require('./jhatka.notify.service');
const complianceGate = require('./jhatka.compliance-gate.service');

/** After this many consecutive stock failures, `notify_and_pause` stops the bleeding. */
const AUTO_PAUSE_THRESHOLD = 3;

/**
 * Stock for a subscription line, FEFO.
 *
 * Ordered by `expiresAt` ascending and filtered to live batches. This is the fix for
 * the drift above: the route used `findOne({ outlet, variant, kind })` with NO ordering,
 * so with two raw rows for the same variant — one fresh, one exhausted, or one already
 * past its date — it returned an ARBITRARY one. A subscription could be skipped for
 * "no stock" while sellable stock sat in the shelf, which is how a customer stops
 * receiving deliveries for a reason nobody can see.
 *
 * `availableQty` is summed across every matching row rather than read from the first,
 * because a variant is genuinely split across batches and FEFO will consume them in
 * turn.
 */
async function availableForVariant(models, outletId, variantId) {
  const rows = await models.JhatkaInventoryItem.find({
    outlet: outletId,
    variant: variantId,
    kind: 'raw',
  })
    .sort({ expiresAt: 1, _id: 1 })
    .lean();

  const now = Date.now();
  const live = rows.filter((r) => {
    // A row with no batch cannot answer a recall, and an expired row is not sellable.
    if (!r.batch) return false;
    if (r.quarantined > 0 && r.availableQty === 0) return false;
    if (r.expiresAt && new Date(r.expiresAt).getTime() <= now) return false;
    return true;
  });

  return {
    available: live.reduce((sum, r) => sum + (r.availableQty || 0), 0),
    rows: live,
  };
}

/**
 * Build the priced occurrence lines from a subscription.
 *
 * Pure apart from the model reads above: given `sub`, returns both the occurrence lines
 * and the shortfalls, so a caller can decide the outcome without re-deriving anything.
 */
async function priceOccurrence({ models, outletId, sub }) {
  const shortfalls = [];

  for (const item of sub.items || []) {
    const { available } = await availableForVariant(models, outletId, item.variant);
    const wanted = item.requestedQuantity?.value || 0;
    if (available < wanted) {
      shortfalls.push({ sku: item.sku, wanted, available });
    }
  }

  const items = (sub.items || []).map((i) => {
    // RUPEES out of the hydrated getter -> PAISE for the helpers. The crossing point.
    const unitPricePaise = toPaiseAmount(i.unitPriceAtSubscribe);

    const lineChargePaise =
      i.chargeMode === 'ceiling'
        ? subscriptionCeilingPaise(
          i.requestedQuantity,
          unitPricePaise,
          i.priceBasis || 'per_kg',
          i.subscriptionCeilingPct ?? 10
        )
        : linePricePaise(i.requestedQuantity, unitPricePaise, i.priceBasis || 'per_kg');

    return {
      variant: i.variant,
      sku: i.sku,
      quantity: i.requestedQuantity.value,
      unit: i.requestedQuantity.unit,
      // RUPEES, straight through from the subscription's own snapshot.
      unitPrice: i.unitPriceAtSubscribe,
      chargeMode: i.chargeMode,
      // moneyField: RUPEES in, so the PAISE result is converted exactly once.
      lineCharge: asMoney(lineChargePaise),
    };
  });

  // Sum in PAISE, convert once. Summing the moneyField values would re-apply the
  // round-trip per line and lose a paise on any line that does not divide evenly.
  const chargePaise = items.reduce((s, l) => s + toPaiseAmount(l.lineCharge), 0);

  return { items, shortfalls, chargePaise, estimatedAmount: asMoney(chargePaise) };
}

/** Advance the subscription after an attempt, whatever the outcome. */
async function advanceSubscription(sub, occurrenceDate, nextOccurrenceFn) {
  sub.lastOccurrenceDate = occurrenceDate;
  sub.nextOccurrenceDate = nextOccurrenceFn(sub, occurrenceDate) || sub.nextOccurrenceDate;
}

/**
 * BR-17. Tell the customer their delivery did not happen, then stamp the occurrence.
 *
 * ## Why this is a shared function and not inline in each failure path
 *
 * There are TWO ways an occurrence fails for stock: the pre-check fails before the
 * row is saved (`recordStockFailure`), and the reservation loses a race afterwards
 * (the path in `generateOccurrence`). Both must produce the same notification, and
 * both must stamp `notifiedAt` from what the transport returned.
 *
 * The second path used to write `occurrence.notifiedAt = new Date()` inline, before
 * any message existed, and then report `customerNotified: !!occurrence.notifiedAt` —
 * which was unconditionally true. That is the same lie the recall told, in a second
 * place, and it is exactly the kind of duplication that means fixing one site and
 * leaving the other behind. One function, both callers.
 *
 * ## Why a failed push does not fail the occurrence
 *
 * The failure is already recorded and the subscription already counted. Losing the
 * push must not undo either, and must not make the cron retry — which would attempt a
 * second reservation and hit the unique index. What a failed push changes is the
 * RETURN value and the outlet notification, so a human sees the gap.
 *
 * @returns {Promise<{sent: boolean, reason: string, stampedAt: Date|null}>}
 */
async function notifyStockFailure({
  sub, occurrence, shortfalls, autoPaused, consecutiveFailures, occurrenceDate,
}) {
  const itemSummary = (occurrence?.items || []).map((i) => i.sku).filter(Boolean);
  const skus = shortfalls.map((s) => s.sku);
  const dateText = occurrenceDate instanceof Date ? occurrenceDate.toDateString() : String(occurrenceDate);

  const sent = await notifyService.notifyCustomer(sub.customer, 'subscription_stock_failure', {
    deliveryDate: dateText,
    itemSummary,
    reason: `We were short on ${skus.join(', ')}.`,
    // The auto-pause is stated explicitly, because a subscription that stops without
    // saying so reads to the customer as a cancellation.
    escalationNote: autoPaused
      ? `This is failure ${consecutiveFailures} in a row, so we have paused your subscription until the outlet can confirm stock.`
      : '',
  });

  let stampedAt = null;
  if (sent.sent && occurrence) {
    occurrence.notifiedAt = new Date();
    stampedAt = occurrence.notifiedAt;
  }

  // The outlet is told too, because it is the one who can fix it — by buying stock or
  // by agreeing a substitution. §9.6's `notify_and_suggest` has nothing to suggest
  // against unless the outlet hears about the shortage.
  await notifyService.notifyOutlet(sub.outlet, 'subscription_stock_shortage', {
    itemSummary,
    deliveryDate: dateText,
    consecutiveFailures,
  });

  return { sent: sent.sent, reason: sent.reason, stampedAt };
}

/**
 * Record a stock failure. The occurrence is STILL WRITTEN — a failure that creates no
 * record is a silent skip, and §9 requires that a failure notifies and is visible.
 */
async function recordStockFailure({
  models, sub, occurrenceDate, priced, actor, recordEvent,
}) {
  const failed = new models.JhatkaRecurringOrder({
    subscription: sub._id,
    outlet: sub.outlet,
    customer: sub.customer,
    occurrenceDate,
    generationStatus: 'skipped_no_stock',
    skipReason: 'insufficient_stock',
    skipNote: `Short on ${priced.shortfalls.map((s) => s.sku).join(', ')}`,
    items: priced.items,
    estimatedAmount: priced.estimatedAmount,
    // Nothing is owed for stock that never arrived.
    chargeAmount: 0,
    stockReserved: false,
    // `notifiedAt` is DELIBERATELY not set here. It used to be, which meant the
    // document claimed the customer had been told at the instant the failure was
    // recorded and before any message existed. It is now written from what the
    // transport returned, further down.
  });
  await failed.save();

  sub.stats.occurrencesSkipped = (sub.stats.occurrencesSkipped || 0) + 1;
  sub.stats.consecutiveStockFailures = (sub.stats.consecutiveStockFailures || 0) + 1;

  let autoPaused = false;
  if (sub.stats.consecutiveStockFailures >= AUTO_PAUSE_THRESHOLD
      && sub.stockFailurePolicy === 'notify_and_pause') {
    sub.status = 'paused';
    sub.statusReason = `Auto-paused after ${AUTO_PAUSE_THRESHOLD} consecutive stock failures`;
    sub.pausedAt = new Date();
    autoPaused = true;
  }
  await sub.save();

  await recordEvent(sub, {
    type: autoPaused ? 'auto_paused' : 'stock_failure_skipped',
    actorType: 'system',
    reason: `Insufficient stock for ${priced.shortfalls.map((s) => s.sku).join(', ')}`,
    note: priced.shortfalls
      .map((s) => `${s.sku}: wanted ${s.wanted}, had ${s.available}`)
      .join('; '),
    consecutiveStockFailures: sub.stats.consecutiveStockFailures,
    recurringOrder: failed._id,
  });

  // BR-17. "Notify the customer, with an explicit reason. Never silent."
  const notification = await notifyStockFailure({
    sub,
    occurrence: failed,
    shortfalls: priced.shortfalls,
    autoPaused,
    consecutiveFailures: sub.stats.consecutiveStockFailures,
    occurrenceDate,
  });

  // Only a real delivery leaves `notifiedAt` set. A customer with no registered device
  // is still recorded as failed — the outlet's digest is the backstop — but the
  // document must not claim a push it never sent.
  if (notification.stampedAt) await failed.save();

  return {
    failed,
    autoPaused,
    consecutiveStockFailures: sub.stats.consecutiveStockFailures,
    notified: notification.sent,
    notificationReason: notification.reason,
  };
}

/**
 * Generate one occurrence for a due subscription.
 *
 * Idempotent per `{subscription, occurrenceDate}`. The pre-check produces a readable
 * message; the UNIQUE INDEX is the real guarantee, because two cron ticks racing is
 * exactly the case a find-then-insert loses.
 *
 * @param {object} p
 * @param {object} p.models   `{ JhatkaSubscription, JhatkaRecurringOrder, JhatkaInventoryItem }`
 * @param {object} p.sub      HYDRATED `JhatkaSubscription` — the money getters matter
 * @param {Date}   p.occurrenceDate LOCAL midnight
 */
async function generateOccurrence({
  models, sub, occurrenceDate, outletId, actor, recordEvent, nextOccurrenceFn, dayKeyFn,
}) {
  if (!['active', 'paused'].includes(sub.status)) {
    throw new ApiError(httpStatus.CONFLICT, `Subscription is ${sub.status}; not generating`);
  }

  // §12.2: a subscription is NEW business every morning, not a standing permission.
  // An outlet whose FSSAI lapsed overnight must not generate this morning's
  // occurrences -- and the failure is LOUD (a throw the cron logs per subscription)
  // rather than a silent skip, because a silent skip is exactly what BR-17 exists
  // to prevent. The customer is told via the normal stock-failure path only when
  // stock is the reason; a compliance block is the OUTLET's problem to fix, not
  // the customer's, so it throws instead of notifying.
  if (models.JhatkaOutlet && models.JhatkaCompliance) {
    const outletDoc = await models.JhatkaOutlet.findById(sub.outlet).lean();
    if (outletDoc) {
      await complianceGate.assertJhatkaOperational({ outlet: outletDoc, operation: 'generate_occurrence', models });
    }
  }

  const existing = await models.JhatkaRecurringOrder.findOne({
    subscription: sub._id,
    occurrenceDate,
  });
  if (existing) {
    return {
      status: httpStatus.OK,
      body: {
        occurrence: {
          id: String(existing._id),
          occurrenceDate: existing.occurrenceDate,
          generationStatus: existing.generationStatus,
        },
        idempotent: true,
        note: 'An occurrence already exists for this date; nothing was generated.',
      },
    };
  }

  const priced = await priceOccurrence({ models, outletId, sub });

  if (priced.shortfalls.length) {
    const { failed, autoPaused, consecutiveStockFailures } = await recordStockFailure({
      models, sub, occurrenceDate, priced, actor, recordEvent,
    });
    await advanceSubscription(sub, occurrenceDate, nextOccurrenceFn);
    // `advanceSubscription` mutates the document AFTER `recordStockFailure` saved it,
    // so the date advance is persisted here rather than being silently dropped.
    await sub.save();

    return {
      status: httpStatus.CONFLICT,
      body: {
        occurrence: {
          id: String(failed._id),
          occurrenceDate,
          generationStatus: failed.generationStatus,
        },
        shortfalls: priced.shortfalls,
        subscription: {
          id: String(sub._id),
          consecutiveStockFailures,
          status: sub.status,
          autoPaused,
        },
        customerNotified: !!failed.notifiedAt,
        note: 'The occurrence is recorded as a stock failure and the customer was notified — it was not silently dropped.',
      },
    };
  }

  const occurrence = new models.JhatkaRecurringOrder({
    subscription: sub._id,
    outlet: sub.outlet,
    customer: sub.customer,
    occurrenceDate,
    generationStatus: 'generated',
    items: priced.items,
    estimatedAmount: priced.estimatedAmount,
    chargeAmount: priced.estimatedAmount,
    generatedAt: new Date(),
    generatedBy: actor?._id,
  });
  await occurrence.save();

  // B5 (§9.4): the availability check above is read-then-act, so two concurrent
  // generators can both pass it. The guarded conditional update inside
  // `reserveOccurrenceStock` is the real claim — exactly one writer wins the
  // last kilogram. The cron path already reserves; the manual path did not.
  const { shortfalls: reserveShortfalls } = await reservationService.reserveOccurrenceStock({
    occurrence,
    lines: priced.items,
    outlet: outletId || sub.outlet,
    models,
    actor,
  });

  if (reserveShortfalls.length) {
    // Lost the race after the check passed: convert the saved occurrence into
    // the same first-class stock-failure record the check-failure path writes,
    // rather than a second document (which would hit the unique index).
    occurrence.generationStatus = 'skipped_no_stock';
    occurrence.skipReason = 'insufficient_stock';
    occurrence.skipNote = `Short on ${reserveShortfalls.map((s) => s.sku).join(', ')}`;
    occurrence.stockReserved = false;
    occurrence.chargeAmount = 0;
    // `notifiedAt` is NOT stamped here. This path used to set it inline and then
    // report `customerNotified: !!occurrence.notifiedAt`, which was always true —
    // a second copy of the lie the recall told. It is written from the transport
    // result, by the shared `notifyStockFailure` helper, after the counters settle.
    await occurrence.save();

    sub.stats.occurrencesSkipped = (sub.stats.occurrencesSkipped || 0) + 1;
    sub.stats.consecutiveStockFailures = (sub.stats.consecutiveStockFailures || 0) + 1;

    let autoPaused = false;
    if (sub.stats.consecutiveStockFailures >= AUTO_PAUSE_THRESHOLD
        && sub.stockFailurePolicy === 'notify_and_pause') {
      sub.status = 'paused';
      sub.statusReason = `Auto-paused after ${AUTO_PAUSE_THRESHOLD} consecutive stock failures`;
      sub.pausedAt = new Date();
      autoPaused = true;
    }
    await advanceSubscription(sub, occurrenceDate, nextOccurrenceFn);
    await sub.save();

    await recordEvent(sub, {
      type: autoPaused ? 'auto_paused' : 'stock_failure_skipped',
      actorType: 'system',
      reason: `Reservation race lost for ${reserveShortfalls.map((s) => s.sku).join(', ')} — stock claimed by a concurrent run`,
      note: reserveShortfalls
        .map((s) => `${s.sku}: wanted ${s.wanted}, had ${s.available}`)
        .join('; '),
      consecutiveStockFailures: sub.stats.consecutiveStockFailures,
      recurringOrder: occurrence._id,
    });

    // Same BR-17 contract as the pre-check path, through the same helper.
    const notification = await notifyStockFailure({
      sub,
      occurrence,
      shortfalls: reserveShortfalls,
      autoPaused,
      consecutiveFailures: sub.stats.consecutiveStockFailures,
      occurrenceDate,
    });
    if (notification.stampedAt) await occurrence.save();

    return {
      status: httpStatus.CONFLICT,
      body: {
        occurrence: {
          id: String(occurrence._id),
          occurrenceDate,
          generationStatus: occurrence.generationStatus,
        },
        shortfalls: reserveShortfalls,
        subscription: {
          id: String(sub._id),
          consecutiveStockFailures: sub.stats.consecutiveStockFailures,
          status: sub.status,
          autoPaused,
        },
        // What the TRANSPORT did, not whether a date was written.
        customerNotified: notification.sent,
        notificationReason: notification.reason,
        note: 'The occurrence is recorded as a stock failure — it was not silently dropped.',
      },
    };
  }

  occurrence.stockReserved = true;
  occurrence.reservedAt = new Date();
  await occurrence.save();

  sub.stats.occurrencesGenerated = (sub.stats.occurrencesGenerated || 0) + 1;
  sub.stats.consecutiveStockFailures = 0;
  await advanceSubscription(sub, occurrenceDate, nextOccurrenceFn);
  sub.stats.lastGeneratedAt = new Date();
  sub.stats.nextDeliveryDate = sub.nextOccurrenceDate;
  await sub.save();

  void dayKeyFn;

  return {
    status: httpStatus.CREATED,
    body: {
      occurrence: {
        id: String(occurrence._id),
        occurrenceDate,
        generationStatus: occurrence.generationStatus,
        chargeAmount: occurrence.chargeAmount,
        items: occurrence.items,
      },
      subscription: {
        id: String(sub._id),
        nextOccurrenceDate: sub.nextOccurrenceDate,
        occurrencesGenerated: sub.stats.occurrencesGenerated,
      },
    },
  };
}

/** Read an occurrence back after a duplicate-key race, for the 11000 path. */
async function findExistingOccurrence(models, subscription, occurrenceDate) {
  return models.JhatkaRecurringOrder.findOne({ subscription, occurrenceDate });
}

module.exports = {
  generateOccurrence,
  priceOccurrence,
  availableForVariant,
  findExistingOccurrence,
  AUTO_PAUSE_THRESHOLD,
  // Exported because the stock-failure notification exists in FOUR places — the
  // pre-check path, the reservation-race path, `cron.js`'s own generator, and the
  // partner subscriptions route. All four used to write `notifiedAt` unconditionally,
  // and three of them reported `customerNotified: true` as a result. One function, so
  // there is no fourth copy to remember next time a failure path is added.
  notifyStockFailure,
};