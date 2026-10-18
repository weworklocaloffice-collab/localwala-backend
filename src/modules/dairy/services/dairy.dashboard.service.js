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
 * The partner's home screen, in one response.
 *
 * ## Why one endpoint
 *
 * The dashboard is the first thing an operator sees on opening the app, and it
 * asks six unrelated questions: how much did I sell today, what needs accepting,
 * what is running out, is my licence still valid, what do I owe my milk
 * suppliers, and how many plans are live. Fetched individually that is six round
 * trips before anything renders, on a connection that is often rural mobile data.
 *
 * So it is one call. The trade is that this is a *read model*, not a source of
 * truth: every figure here is derived live from the same collections the rest of
 * the system writes, so it cannot drift out of step with them the way a stored
 * counter would.
 *
 * ## Failure policy
 *
 * Each panel is gathered independently and a panel that throws is reported as
 * unavailable rather than failing the whole screen. A partner whose supplier
 * payables are broken must still see their order count — losing the entire
 * dashboard because one unrelated query failed is a worse outcome than one
 * missing card.
 */

const { status: httpStatus } = require('http-status');
const {
  Business,
  DairySku,
  DairyOrder,
  DairySubscription,
  DeliveryRun,
  DeliveryStop,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const complianceService = require('./dairy.compliance.service');
const payableService = require('./dairy.provider.payable.service');
const logger = require('../../../config/logger');

/** Below this many units a SKU counts as low stock. */
const LOW_STOCK_THRESHOLD = 10;

const DAY_MS = 86400000;

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/**
 * Runs one panel, converting a failure into an explicit "unavailable" marker.
 *
 * @param {string} name
 * @param {Function} fn
 */
const panel = async (name, fn) => {
  try {
    return { name, ok: true, data: await fn() };
  } catch (error) {
    logger.error(`partner dashboard: panel "${name}" failed — ${error.message}`);
    return { name, ok: false, error: error.message };
  }
};

const assertBusiness = async (businessId) => {
  const business = await Business.findById(businessId);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  }
  return business;
};

/**
 * Order counts and revenue for a window, grouped by status.
 *
 * @param {Object} businessId
 * @param {Date} from
 * @param {Date} to
 */
const orderTotals = async (businessId, from, to) => {
  // `await` on an Aggregate works because it is thenable. `.toArray()` is only on
  // the raw driver, so calling it here throws and the panel reports unavailable.
  const rows = await DairyOrder.aggregate([
      {
        $match: {
          business: businessId,
          createdAt: { $gte: from, $lt: to },
        },
      },
      {
        $group: {
          _id: '$status',
          orders: { $sum: 1 },
          // Raw paise; divided once below. Aggregation output bypasses the getter.
          revenue: { $sum: '$grandTotal' },
        },
},
  ]);

  const byStatus = {};
  let orders = 0;
  let revenue = 0;

  rows.forEach((row) => {
    byStatus[row._id] = {
      orders: row.orders,
      revenue: Number((row.revenue / 100).toFixed(2)),
    };
    orders += row.orders;
    revenue += row.revenue;
  });

  return { orders, revenue: Number((revenue / 100).toFixed(2)), byStatus };
};

/**
 * Builds the dashboard for one outlet.
 *
 * @param {string} businessId the outlet. Still taken from the path until partner
 *   scoping is settled — see §10 decision 7 of the implementation plan.
 * @param {Object} options `lowStockThreshold`
 * @returns {Promise<Object>}
 */
const getDashboard = async (businessId, options = {}) => {
  const business = await assertBusiness(businessId);

  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const threshold = options.lowStockThreshold && options.lowStockThreshold > 0
    ? options.lowStockThreshold
    : LOW_STOCK_THRESHOLD;

  const [todayOrders, lowStock, compliance, payables, livePlans, todaysRuns] = await Promise.all([
    panel('today', () => orderTotals(business._id, today, tomorrow)),

    panel('lowStock', async () => {
      const skus = await DairySku.find({
        business: business._id,
        status: true,
        inStock: true,
        availableQty: { $gt: 0, $lte: threshold },
      })
        .select('name availableQty packSize')
        .sort({ availableQty: 1 })
        .limit(10);

      return {
        threshold,
        count: skus.length,
        items: skus.map((sku) => ({
          id: sku._id,
          name: sku.name,
          availableQty: sku.availableQty,
          packSize: sku.packSize,
        })),
      };
    }),

    // Live figures, not the cached status — see dairy.compliance.service.
    panel('compliance', () => complianceService.getSummary(business._id)),

    panel('payables', async () => {
      const result = await payableService.listPayables({
        business: business._id,
        status: 'approved',
        limit: 50,
      });
      const payable = result.payables.reduce(
        (sum, p) => sum + Number(p.totals.netAmount),
        0
      );
      return {
        count: result.totalResults,
        // Positive: the platform owes these providers.
        payable: Number(payable.toFixed(2)),
      };
    }),

    panel('subscriptions', async () => {
      const active = await DairySubscription.countDocuments({
        business: business._id,
        status: 'active',
      });
      return { active };
    }),

    panel('deliveries', async () => {
      const runsInProgress = await DeliveryRun.countDocuments({
        business: business._id,
        serviceDate: today,
        status: { $in: ['dispatched', 'in_progress'] },
      });
      const stopsPending = await DeliveryStop.countDocuments({ status: 'pending' });
      return { runsInProgress, stopsPending };
    }),
  ]);

  return {
    outlet: {
      // A string, matching what the `toJSON` plugin does to every other dairy
      // payload. Handing back a raw ObjectId here would make this the one endpoint
      // where `id` is an object in-process and a string over HTTP.
      id: business._id.toString(),
      name: business.name,
      businessModel: business.businessModel,
      ownDeliveryPartner: business.ownDeliveryPartner,
    },
    generatedAt: new Date(),
    today: todayOrders,
    lowStock,
    compliance,
    payables,
    subscriptions: livePlans,
    deliveries: todaysRuns,
  };
};

module.exports = {
  LOW_STOCK_THRESHOLD,
  getDashboard,
  orderTotals,
};