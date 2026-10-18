/**
 * jhatka.analytics.service.js — outlet-scoped dashboard summary (B9).
 *
 * ## Why this exists as a service, not a route
 *
 * The Partner dashboard and the admin panel both need the same numbers, and
 * neither can compute them client-side. Two screens computing "revenue" two
 * ways is how a dashboard disagrees with a settlement.
 *
 * ## Money discipline (§0.0, F-7, F-9)
 *
 * Aggregations project COUNTS ONLY. Money is read LEAN — raw PAISE — summed
 * raw, and converted once with `asMoney` at the response boundary. Converting
 * through `toPaiseAmount` here would treat paise as rupees and inflate 100x.
 * Field names below were verified against the live schemas before writing
 * (F-7): `estimatedTotal`, `finalTotal`, `refundedAmount`,
 * `weightAdjustmentTotal`, `absorbedOverchargeTotal` on `JhatkaOrder`; `qty`,
 * `unit`, `cause`, `occurredAt`, `orderLinked` on `JhatkaWastage`.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { asMoney } = require('../utils/money');

/** Default window (days) and hard cap, so a dashboard cannot scan a year. */
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;

/**
 * Resolve and validate a `[from, to)` window.
 *
 * Extracted because `outletSummary` and `platformSummary` MUST agree on what a window
 * is. Two copies of a date guard is how one endpoint starts accepting a 5-year scan
 * that the other rejects, and the one that accepts it is the one that times out.
 */
function resolveWindow(query) {
  const to = query?.to ? new Date(query.to) : new Date();
  if (Number.isNaN(to.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'query.to must be a valid date');
  }
  let from = query?.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86400000);
  if (Number.isNaN(from.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'query.from must be a valid date');
  }
  if (from >= to) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'query.from must be before query.to');
  }
  if ((to - from) / 86400000 > MAX_WINDOW_DAYS) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Window may not exceed ${MAX_WINDOW_DAYS} days`,
      true,
      '',
      { code: 'ANALYTICS_WINDOW_TOO_WIDE', maxWindowDays: MAX_WINDOW_DAYS }
    );
  }
  return { from, to };
}

/**
 * Outlet dashboard summary for [from, to).
 *
 * @param {object} p
 * @param {object} p.models  `{ JhatkaOrder, JhatkaWastage, JhatkaSubscription, JhatkaRecurringOrder, JhatkaInventoryItem }`
 * @param {string} p.outletId
 * @param {object} p.query    `{ from?, to? }` ISO dates; defaults to last 30 days
 * @returns {Promise<object>} `{ period, orders, wastage, subscriptions, inventory }`
 */
async function outletSummary({ models, outletId, query }) {
  const { JhatkaOrder, JhatkaWastage, JhatkaSubscription, JhatkaRecurringOrder, JhatkaInventoryItem } = models;

  const { from, to } = resolveWindow(query);

  const window = { outlet: outletId, createdAt: { $gte: from, $lt: to } };

  // Counts only in the pipeline; money summed below from getters.
  const [orderCount, ordersByLifecycle] = await Promise.all([
    JhatkaOrder.countDocuments(window),
    JhatkaOrder.aggregate([
      { $match: window },
      { $group: { _id: '$lifecycle', count: { $sum: 1 } } },
    ]),
  ]);

  const orders = await JhatkaOrder.find(window)
    .select('estimatedTotal finalTotal refundedAmount weightAdjustmentTotal absorbedOverchargeTotal lifecycle')
    .lean();
  // LEAN reads: moneyField values arrive as RAW PAISE. Summing through
  // `toPaiseAmount` here would treat paise as rupees and inflate 100x — the
  // exact bug this file once shipped. Sum raw, convert once at the boundary.
  let estimatedPaise = 0;
  let finalPaise = 0;
  let refundedPaise = 0;
  let absorbedPaise = 0;
  for (const o of orders) {
    estimatedPaise += Number(o.estimatedTotal) || 0;
    finalPaise += Number(o.finalTotal) || 0;
    refundedPaise += Number(o.refundedAmount) || 0;
    absorbedPaise += Number(o.absorbedOverchargeTotal) || 0;
  }

  const [wastageCount, wastageByCause] = await Promise.all([
    JhatkaWastage.countDocuments({ outlet: outletId, occurredAt: { $gte: from, $lt: to } }),
    JhatkaWastage.aggregate([
      { $match: { outlet: outletId, occurredAt: { $gte: from, $lt: to } } },
      { $group: { _id: '$cause', count: { $sum: 1 } } },
    ]),
  ]);
  const orderLinkedWastage = await JhatkaWastage.countDocuments({
    outlet: outletId,
    occurredAt: { $gte: from, $lt: to },
    orderLinked: true,
  });

  const [subscriptionCount, subscriptionsByStatus, occurrencesGenerated, occurrencesSkipped] = await Promise.all([
    JhatkaSubscription.countDocuments({ outlet: outletId }),
    JhatkaSubscription.aggregate([
      { $match: { outlet: outletId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    JhatkaRecurringOrder.countDocuments({
      outlet: outletId,
      occurrenceDate: { $gte: from, $lt: to },
      generationStatus: { $in: ['generated', 'reserved'] },
    }),
    JhatkaRecurringOrder.countDocuments({
      outlet: outletId,
      occurrenceDate: { $gte: from, $lt: to },
      generationStatus: 'skipped_no_stock',
    }),
  ]);

  const [lowStockCount, expiredCount] = await Promise.all([
    JhatkaInventoryItem.countDocuments({
      outlet: outletId,
      $expr: { $lte: ['$onHand', '$lowStockThreshold'] },
    }),
    JhatkaInventoryItem.countDocuments({
      outlet: outletId,
      expiresAt: { $lte: new Date() },
    }),
  ]);

  return {
    period: { from, to },
    orders: {
      count: orderCount,
      byLifecycle: Object.fromEntries(ordersByLifecycle.map((r) => [r._id, r.count])),
      estimatedTotal: asMoney(estimatedPaise),
      finalTotal: asMoney(finalPaise),
      refundedTotal: asMoney(refundedPaise),
      absorbedOverchargeTotal: asMoney(absorbedPaise),
    },
    wastage: {
      count: wastageCount,
      orderLinked: orderLinkedWastage,
      byCause: Object.fromEntries(wastageByCause.map((r) => [r._id, r.count])),
    },
    subscriptions: {
      count: subscriptionCount,
      byStatus: Object.fromEntries(subscriptionsByStatus.map((r) => [r._id, r.count])),
      occurrencesGenerated,
      occurrencesSkipped,
    },
    inventory: { lowStockCount, expiredCount },
  };
}

/**
 * Sum a money field across LEAN documents.
 *
 * LEAN reads return RAW PAISE for a `moneyField`, because `.lean()` bypasses getters.
 * So these are summed as-is and converted ONCE, at the boundary. Running them through
 * `toPaiseAmount` here would treat paise as rupees and inflate 100x — which is exactly
 * what this module shipped before, and why the note at the top of the file is so
 * emphatic. Aggregations never touch money; only this function does.
 */
function sumPaise(docs, field) {
  let total = 0;
  for (const d of docs) total += Number(d?.[field]) || 0;
  return total;
}

/**
 * Platform-wide summary for the admin panel.
 *
 * ## Why the admin cannot reuse `outletSummary` by looping
 *
 * It can, and that is exactly the problem: one query per outlet turns a 200-outlet
 * network into 200 round trips for one screen, and the totals drift from the per-outlet
 * panels because each outlet's window is computed at a different `new Date()`. So this
 * is ONE pass over the window, grouped once.
 *
 * ## The number that decides whether Jhatka is working
 *
 * `contribution.check` — estimated minus refunds minus wastage value. Not profit: it
 * excludes COGS and operator payouts, which live in `JhatkaSettlement` and are built
 * on a different cadence. What it does answer is "are we selling more meat or more
 * air?", and `absorbedOvercharge` sits right beside it because a rising absorbed figure
 * is §3.6's COD ceiling being under-priced.
 *
 * @param {object} p
 * @param {object} p.models `{ JhatkaOrder, JhatkaWastage, JhatkaOutlet, JhatkaRefund,
 *                            JhatkaSubscription, JhatkaCompliance, JhatkaRecall,
 *                            JhatkaRecurringOrder, JhatkaInventoryItem }`
 * @param {object} p.query  `{ from?, to? }`
 */
async function platformSummary({ models, query }) {
  const {
    JhatkaOrder, JhatkaWastage, JhatkaOutlet, JhatkaRefund,
    JhatkaSubscription, JhatkaCompliance, JhatkaRecall, JhatkaRecurringOrder,
  } = models;

  const { from, to } = resolveWindow(query);
  const created = { createdAt: { $gte: from, $lt: to } };

  const [orders, orderCount, ordersByLifecycle, ordersByModel] = await Promise.all([
    JhatkaOrder.find(created)
      .select('estimatedTotal finalTotal refundedAmount weightAdjustmentTotal absorbedOverchargeTotal taxTotal')
      .lean(),
    JhatkaOrder.countDocuments(created),
    JhatkaOrder.aggregate([{ $match: created }, { $group: { _id: '$lifecycle', count: { $sum: 1 } } }]),
    JhatkaOrder.aggregate([{ $match: created }, { $group: { _id: '$businessModel', count: { $sum: 1 } } }]),
  ]);

  const estimatedPaise = sumPaise(orders, 'estimatedTotal');
  const finalPaise = sumPaise(orders, 'finalTotal');
  const refundedPaise = sumPaise(orders, 'refundedAmount');
  const absorbedPaise = sumPaise(orders, 'absorbedOverchargeTotal');
  const taxPaise = sumPaise(orders, 'taxTotal');

  const [wastage, wastageByCause] = await Promise.all([
    JhatkaWastage.find({ occurredAt: { $gte: from, $lt: to } })
      .select('estimatedValue orderLinked cause')
      .lean(),
    JhatkaWastage.aggregate([
      { $match: { occurredAt: { $gte: from, $lt: to } } },
      { $group: { _id: '$cause', count: { $sum: 1 } } },
    ]),
  ]);
  const wastageValuePaise = sumPaise(wastage, 'estimatedValue');

  const [refunds, refundsByStatus, refundsByReason, outletCount, outletsByModel] = await Promise.all([
    JhatkaRefund.find({ createdAt: { $gte: from, $lt: to } }).select('amount status').lean(),
    JhatkaRefund.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    JhatkaRefund.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: '$reason', count: { $sum: 1 } } },
    ]),
    JhatkaOutlet.countDocuments({}),
    JhatkaOutlet.aggregate([{ $group: { _id: '$businessModel', count: { $sum: 1 } } }]),
  ]);
  const refundDocPaise = sumPaise(refunds, 'amount');

  const [subscriptionCount, occurrencesGenerated, occurrencesSkipped, complianceByStatus, openRecalls] =
    await Promise.all([
      JhatkaSubscription.countDocuments({}),
      JhatkaRecurringOrder.countDocuments({
        occurrenceDate: { $gte: from, $lt: to },
        generationStatus: { $in: ['generated', 'reserved'] },
      }),
      JhatkaRecurringOrder.countDocuments({
        occurrenceDate: { $gte: from, $lt: to },
        generationStatus: 'skipped_no_stock',
      }),
      JhatkaCompliance.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      JhatkaRecall.countDocuments({ status: { $in: ['open', 'notifying'] } }),
    ]);

  const netCollectedPaise = estimatedPaise - refundedPaise;

  return {
    period: { from, to },
    orders: {
      count: orderCount,
      byLifecycle: Object.fromEntries(ordersByLifecycle.map((r) => [r._id, r.count])),
      byBusinessModel: Object.fromEntries(ordersByModel.map((r) => [r._id ?? 'unknown', r.count])),
      estimatedTotal: asMoney(estimatedPaise),
      finalTotal: asMoney(finalPaise),
      refundedTotal: asMoney(refundedPaise),
      absorbedOverchargeTotal: asMoney(absorbedPaise),
      taxCollected: asMoney(taxPaise),
    },
    contribution: {
      // Deliberately NOT called profit. COGS and operator payouts live in
      // `JhatkaSettlement` on a different cadence; mixing them here would produce a
      // number that disagrees with the settlement the finance team actually receives.
      grossCollected: asMoney(netCollectedPaise),
      wastageValue: asMoney(wastageValuePaise),
      contributionAfterWastage: asMoney(netCollectedPaise - wastageValuePaise),
      absorbedOvercharge: asMoney(absorbedPaise),
      // The single most useful ratio in the vertical: what fraction of orders were
      // short-delivered. §7.1 says a variant above ~2% will refund every week.
      refundRate: orderCount ? Number(((refundDocPaise / estimatedPaise) * 100).toFixed(2)) : 0,
    },
    wastage: {
      count: wastage.length,
      orderLinked: wastage.filter((w) => w.orderLinked).length,
      value: asMoney(wastageValuePaise),
      byCause: Object.fromEntries(wastageByCause.map((r) => [r._id, r.count])),
    },
    refunds: {
      count: refunds.length,
      value: asMoney(refundDocPaise),
      byStatus: Object.fromEntries(refundsByStatus.map((r) => [r._id, r.count])),
      byReason: Object.fromEntries(refundsByReason.map((r) => [r._id, r.count])),
    },
    outlets: {
      count: outletCount,
      byBusinessModel: Object.fromEntries(outletsByModel.map((r) => [r._id ?? 'unknown', r.count])),
    },
    subscriptions: {
      count: subscriptionCount,
      occurrencesGenerated,
      occurrencesSkipped,
    },
    compliance: {
      byStatus: Object.fromEntries(complianceByStatus.map((r) => [r._id, r.count])),
      openRecalls,
    },
  };
}

module.exports = {
  outletSummary,
  platformSummary,
  resolveWindow,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  _internal: { sumPaise },
};
