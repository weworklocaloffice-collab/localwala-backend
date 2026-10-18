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
 * jhatka.subscription-lifecycle.service.js — partner-operated subscription moves.
 *
 * ## Why this exists beside `jhatka.subscription.service.js`
 *
 * That module owns the SHARED rules — creation, repricing, item updates — used by
 * both the customer surface and the partner surface. This one owns the PARTNER-only
 * operational actions: listing with the auto-pause view, detail with the event trail,
 * pause, resume, cancel, and the manual skip.
 *
 * They were all inline in `jhatka.partner.subscriptions.route.js`, which meant the
 * only way to exercise a pause-then-resume-then-autopause sequence was over HTTP
 * against a live database. The rules are stateful (a resume resets the failure
 * streak; a cancel marks occurrences rather than deleting them) and stateful rules
 * tested only through HTTP are rules tested rarely.
 *
 * ## What stays in the route
 *
 * Auth, capability, validation, tenancy (`loadOwnSub`), the response envelope.
 * `dayKey` and `nextOccurrence` stay exported from the route module because the
 * customer router and the cron require them from there — moving them would break two
 * importers for no behavioural gain.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/** Subscription statuses the list filter accepts. Read from the model in spirit. */
const LISTABLE_STATUSES = [
  'pending_payments', 'active', 'paused', 'payment_failed',
  'cancelled', 'completed', 'failed',
];

/** Consecutive failures at which the auto-pause view flags a subscription. §9.6. */
const AUTO_PAUSE_STREAK = 2;

/** Hard cap so a list cannot page the whole collection. */
const MAX_PAGE_LIMIT = 200;

/**
 * List an outlet's subscriptions.
 *
 * `autoPauseCandidates=true` is the §9.6 view: active subscriptions with a failure
 * streak, which the outlet needs to see BEFORE the threshold trips — not after.
 */
async function listSubscriptions({ models, outletId, query = {} } = {}) {
  const { JhatkaSubscription } = models;
  const { status, customer, autoPauseCandidates, page = 1, limit = 50 } = query;

  const filter = { outlet: outletId };

  if (autoPauseCandidates === 'true') {
    filter.status = 'active';
    filter['stats.consecutiveStockFailures'] = { $gte: AUTO_PAUSE_STREAK };
  } else if (status) {
    if (!LISTABLE_STATUSES.includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown subscription status '${status}'`);
    }
    filter.status = status;
  }
  if (customer) filter.customer = customer;

  const subs = await JhatkaSubscription.find(filter)
    .populate('customer', 'name phone email')
    .sort({ nextOccurrenceDate: 1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), MAX_PAGE_LIMIT))
    .lean();

  return {
    subscriptions: subs.map(toListView),
    page: Number(page),
    limit: Number(limit),
  };
}

function toListView(s) {
  return {
    id: String(s._id),
    subscriptionNo: s.subscriptionNo,
    customer: s.customer
      ? { id: String(s.customer._id), name: s.customer.name, phone: s.customer.phone }
      : null,
    status: s.status,
    statusReason: s.statusReason,
    scheduleType: s.scheduleType,
    intervalCount: s.intervalCount,
    deliverySlot: s.deliverySlot,
    priceMode: s.priceMode,
    paymentMode: s.paymentMode,
    prepaid: s.prepaid,
    estimatedAmountPerOccurrence: s.estimatedAmountPerOccurrence,
    nextOccurrenceDate: s.nextOccurrenceDate,
    lastOccurrenceDate: s.lastOccurrenceDate,
    totals: s.totals,
    stats: s.stats,
    items: (s.items || []).map((i) => ({
      sku: i.sku,
      name: i.name,
      requestedQuantity: i.requestedQuantity,
      chargeMode: i.chargeMode,
      subscriptionCeilingPct: i.subscriptionCeilingPct,
    })),
    willAutoPause:
      s.status === 'active' && (s.stats?.consecutiveStockFailures || 0) >= AUTO_PAUSE_STREAK,
  };
}

/**
 * Detail: the subscription, its event trail, and upcoming occurrences.
 */
async function subscriptionDetail({ models, sub } = {}) {
  const { JhatkaSubscriptionEvent, JhatkaRecurringOrder } = models;

  const [events, occurrences] = await Promise.all([
    JhatkaSubscriptionEvent.find({ subscription: sub._id })
      .sort({ at: -1 })
      .limit(50)
      .lean(),
    JhatkaRecurringOrder.find({ subscription: sub._id })
      .sort({ occurrenceDate: 1 })
      .limit(20)
      .lean(),
  ]);

  return {
    subscription: {
      id: String(sub._id),
      subscriptionNo: sub.subscriptionNo,
      customer: sub.customer
        ? { id: String(sub.customer._id), name: sub.customer.name, phone: sub.customer.phone }
        : null,
      status: sub.status,
      statusReason: sub.statusReason,
      scheduleType: sub.scheduleType,
      intervalCount: sub.intervalCount,
      customDays: sub.customDays,
      startDate: sub.startDate,
      endDate: sub.endDate,
      nextOccurrenceDate: sub.nextOccurrenceDate,
      lastOccurrenceDate: sub.lastOccurrenceDate,
      deliverySlot: sub.deliverySlot,
      priceMode: sub.priceMode,
      paymentMode: sub.paymentMode,
      prepaid: sub.prepaid,
      estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
      substitutionPolicy: sub.substitutionPolicy,
      stockFailurePolicy: sub.stockFailurePolicy,
      totals: sub.totals,
      stats: sub.stats,
      items: sub.items,
      pausedAt: sub.pausedAt,
      cancelledAt: sub.cancelledAt,
    },
    events: events.map((e) => ({
      id: String(e._id),
      type: e.type,
      actorType: e.actorType,
      actorName: e.actorName,
      reason: e.reason,
      note: e.note,
      fromValue: e.fromValue,
      toValue: e.toValue,
      consecutiveStockFailures: e.consecutiveStockFailures,
      at: e.at,
    })),
    occurrences: occurrences.map((o) => ({
      id: String(o._id),
      occurrenceDate: o.occurrenceDate,
      generationStatus: o.generationStatus,
      chargeAmount: o.chargeAmount,
      estimatedAmount: o.estimatedAmount,
      skipReason: o.skipReason,
      order: o.order ? String(o.order) : null,
      generatedAt: o.generatedAt,
    })),
  };
}

/**
 * Pause. Requires a reason — a pause nobody explained is indistinguishable from an
 * abandonment when the customer asks about it next week.
 */
async function pauseSubscription({ sub, body = {}, actor, actorType = 'admin', recordEvent } = {}) {
  if (sub.status !== 'active') {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Subscription is ${sub.status}; only an active subscription can be paused`,
      true,
      '',
      { status: sub.status }
    );
  }

  const { reason, until } = body;
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required to pause');

  sub.status = 'paused';
  sub.statusReason = reason;
  sub.pausedAt = new Date();
  if (until) sub.pauseWindows = [...(sub.pauseWindows || []), { from: new Date(), to: new Date(until), reason }];
  await sub.save();

  await recordEvent(sub, {
    type: 'paused',
    actorType,
    actor: actor._id,
    actorName: actor.name,
    reason,
    toValue: 'paused',
    fromValue: 'active',
  });

  return {
    subscription: {
      id: String(sub._id),
      status: sub.status,
      pausedAt: sub.pausedAt,
      nextOccurrenceDate: sub.nextOccurrenceDate,
    },
    note: 'Already-raised occurrences are not cancelled by a pause; skip them individually.',
  };
}

/**
 * Resume. Resets the failure streak and re-derives the schedule from today.
 *
 * Both resets matter and both were the kind of thing to forget: three failures then
 * a pause then a resume is a NEW streak, and carrying the old count auto-pauses
 * again within a day of resuming. A month-long pause re-derived from the old date
 * would queue a backlog of catch-up occurrences nobody wants.
 */
async function resumeSubscription({ sub, actor, actorType = 'admin', recordEvent, nextOccurrenceFn } = {}) {
  if (sub.status !== 'paused') {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Subscription is ${sub.status}; only a paused subscription can be resumed`,
      true,
      '',
      { status: sub.status }
    );
  }

  sub.status = 'active';
  sub.statusReason = undefined;
  sub.resumedAt = new Date();
  sub.stats.consecutiveStockFailures = 0;
  sub.nextOccurrenceDate = nextOccurrenceFn(sub, new Date()) || sub.nextOccurrenceDate;
  await sub.save();

  await recordEvent(sub, {
    type: 'resumed',
    actorType,
    actor: actor._id,
    actorName: actor.name,
    toValue: 'active',
    fromValue: 'paused',
  });

  return {
    subscription: {
      id: String(sub._id),
      status: sub.status,
      resumedAt: sub.resumedAt,
      nextOccurrenceDate: sub.nextOccurrenceDate,
      consecutiveStockFailures: sub.stats.consecutiveStockFailures,
    },
  };
}

/**
 * Cancel. Occurrences already generated are MARKED, not deleted — they are real
 * charges or real skips and the customer has to see them. Deleting them would
 * rewrite the customer's history to flatter the outlet.
 */
async function cancelSubscription({ models, sub, body = {}, actor, actorType = 'admin', recordEvent } = {}) {
  const { JhatkaRecurringOrder } = models;

  if (['cancelled', 'completed'].includes(sub.status)) {
    throw new ApiError(httpStatus.CONFLICT, `Subscription is already ${sub.status}`);
  }

  const { reason } = body;
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required to cancel');

  sub.status = 'cancelled';
  sub.statusReason = reason;
  sub.cancelReason = reason;
  sub.cancelledAt = new Date();
  await sub.save();

  const cancelled = await JhatkaRecurringOrder.updateMany(
    { subscription: sub._id, generationStatus: { $in: ['planned', 'reserved'] } },
    { generationStatus: 'cancelled', skipReason: 'explicitly_skipped', skipNote: `Subscription cancelled: ${reason}` }
  );

  await recordEvent(sub, {
    type: 'cancelled',
    actorType,
    actor: actor._id,
    actorName: actor.name,
    reason,
    toValue: 'cancelled',
  });

  return {
    subscription: { id: String(sub._id), status: sub.status, cancelledAt: sub.cancelledAt },
    occurrencesCancelled: cancelled.modifiedCount,
  };
}

/**
 * Skip the NEXT occurrence only. Not a pause: a pause is a state, a skip is one
 * date, and conflating them is how a customer who misses a week ends up cancelled.
 *
 * The UNIQUE {subscription, occurrenceDate} index is the concurrency guard: a second
 * skip for the same date raises E11000 rather than creating a second occurrence.
 */
async function skipNextOccurrence({
  models, sub, body = {}, actor, actorType = 'admin', recordEvent, dayKeyFn, nextOccurrenceFn, notifyStockFailure,
} = {}) {
  const { JhatkaRecurringOrder } = models;

  if (!['active', 'paused'].includes(sub.status)) {
    throw new ApiError(httpStatus.CONFLICT, `Subscription is ${sub.status}`);
  }

  const { occurrenceDate, reason } = body;
  if (!occurrenceDate) throw new ApiError(httpStatus.BAD_REQUEST, 'occurrenceDate is required');

  const occurrence = dayKeyFn(occurrenceDate);

  const existing = await JhatkaRecurringOrder.findOne({
    subscription: sub._id,
    occurrenceDate: occurrence,
  });
  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `An occurrence already exists for ${occurrence.toISOString().slice(0, 10)}`,
      true,
      '',
      { code: 'OCCURRENCE_EXISTS', generationStatus: existing.generationStatus }
    );
  }

  const skip = new JhatkaRecurringOrder({
    subscription: sub._id,
    outlet: sub.outlet,
    customer: sub.customer,
    occurrenceDate: occurrence,
    generationStatus: 'skipped_no_stock',
    skipReason: 'explicitly_skipped',
    skipNote: reason || 'Skipped by the outlet',
    items: (sub.items || []).map((i) => ({
      variant: i.variant,
      sku: i.sku,
      quantity: i.requestedQuantity.value,
      unit: i.requestedQuantity.unit,
      unitPrice: i.unitPriceAtSubscribe,
      chargeMode: i.chargeMode,
      lineCharge: 0,
    })),
    // `notifiedAt` is not stamped here — see the shared notifier below.
  });
  await skip.save();

  sub.stats.occurrencesSkipped = (sub.stats.occurrencesSkipped || 0) + 1;
  // Advance the schedule so the skip is not re-proposed as the next occurrence.
  sub.lastOccurrenceDate = occurrence;
  sub.nextOccurrenceDate = nextOccurrenceFn(sub, occurrence) || sub.nextOccurrenceDate;
  await sub.save();

  await recordEvent(sub, {
    type: 'skipped',
    actorType,
    actor: actor._id,
    actorName: actor.name,
    reason: reason || 'Skipped by the outlet',
    recurringOrder: skip._id,
  });

  // An outlet skipping a date is still BR-17 in reverse: the customer must learn it
  // without having to ask. Same helper as the three automated failure paths, so the
  // message and the `notifiedAt` stamp cannot disagree.
  const notification = await notifyStockFailure({
    sub,
    occurrence: skip,
    shortfalls: (sub.items || []).map((i) => ({ sku: i.sku })),
    autoPaused: false,
    consecutiveFailures: sub.stats?.consecutiveStockFailures || 0,
    occurrenceDate: occurrence,
  });
  if (notification.stampedAt) await skip.save();

  return {
    skip: {
      id: String(skip._id),
      occurrenceDate: skip.occurrenceDate,
      generationStatus: skip.generationStatus,
    },
    subscription: {
      id: String(sub._id),
      nextOccurrenceDate: sub.nextOccurrenceDate,
      occurrencesSkipped: sub.stats.occurrencesSkipped,
    },
  };
}

module.exports = {
  listSubscriptions,
  toListView,
  subscriptionDetail,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  skipNextOccurrence,
  LISTABLE_STATUSES,
  AUTO_PAUSE_STREAK,
  MAX_PAGE_LIMIT,
};