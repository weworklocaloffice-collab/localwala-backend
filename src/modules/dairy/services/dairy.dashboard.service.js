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
 * gathers trading totals and trends, order and delivery work, stock and expiry
 * alerts, licence status, supplier payables, and live subscriptions. Fetched
 * individually, those panels add round trips before anything renders on a
 * connection that is often rural mobile data.
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
  DairyMilkBatch,
  DairySkuInventoryLot,
  DeliveryRun,
  DeliveryStop,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const complianceService = require('./dairy.compliance.service');
const payableService = require('./dairy.provider.payable.service');
const logger = require('../../../config/logger');
const dairyInventoryLotService = require('./dairy.inventory.lot.service');

/** Below this many units a SKU counts as low stock. */
const LOW_STOCK_THRESHOLD = 10;
const DASHBOARD_TIME_ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

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
  const business = await Business.findById(businessId)
    .populate('city', 'name')
    .populate('locality', 'name');
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

const localDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getSalesTrend = async (businessId, periodDays, today = startOfToday()) => {
  const end = new Date(today.getTime() + DAY_MS);
  const start = new Date(today);
  start.setDate(start.getDate() - (periodDays - 1));
  const previousStart = new Date(start);
  previousStart.setDate(previousStart.getDate() - periodDays);

  const rows = await DairyOrder.aggregate([
    { $match: { business: businessId, createdAt: { $gte: previousStart, $lt: end } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
            timezone: DASHBOARD_TIME_ZONE,
          },
        },
        orders: { $sum: 1 },
        revenue: { $sum: '$grandTotal' },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const startKey = localDateKey(start);
  const endKey = localDateKey(end);
  const byDate = new Map(rows
    .filter((row) => row._id >= startKey && row._id < endKey)
    .map((row) => [row._id, row]));
  const previousRows = rows.filter((row) => row._id < startKey);
  const days = [];
  for (let index = 0; index < periodDays; index += 1) {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const row = byDate.get(localDateKey(date));
    days.push({
      date: localDateKey(date),
      orders: row?.orders || 0,
      revenue: Number(((row?.revenue || 0) / 100).toFixed(2)),
    });
  }
  const previousOrders = previousRows.reduce((sum, row) => sum + row.orders, 0);
  const previousRevenue = previousRows.reduce((sum, row) => sum + row.revenue, 0);
  return {
    periodDays,
    totalOrders: days.reduce((sum, row) => sum + row.orders, 0),
    totalRevenue: Number(days.reduce((sum, row) => sum + row.revenue, 0).toFixed(2)),
    previousOrders,
    previousRevenue: Number((previousRevenue / 100).toFixed(2)),
    days,
  };
};

/**
 * Builds the dashboard for one outlet.
 *
 * @param {string} businessId the outlet. Still taken from the path until partner
 *   scoping is settled — see §10 decision 7 of the implementation plan.
 * @param {Object} options `lowStockThreshold` and `period` (`7d` or `30d`)
 * @returns {Promise<Object>}
 */
const getDashboard = async (businessId, options = {}) => {
  const business = await assertBusiness(businessId);
  try {
    await dairyInventoryLotService.expireLotsForBusiness(business._id);
  } catch (error) {
    logger.error(`dairy inventory expiry reconciliation failed for ${business._id}: ${error.message}`);
  }

  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const threshold = options.lowStockThreshold && options.lowStockThreshold > 0
    ? options.lowStockThreshold
    : LOW_STOCK_THRESHOLD;
  const periodDays = options.period === '30d' ? 30 : 7;
  const hasThresholdOverride = options.lowStockThreshold && options.lowStockThreshold > 0;

  const [todayOrders, salesTrend, lowStock, expiryAlerts, compliance, payables, livePlans, todaysRuns] = await Promise.all([
    panel('today', () => orderTotals(business._id, today, tomorrow)),
    panel('salesTrend', () => getSalesTrend(business._id, periodDays, today)),

    panel('lowStock', async () => {
      const filter = {
        business: business._id,
        status: true,
        inStock: true,
        $expr: {
          $and: [
            { $gt: [{ $ifNull: ['$availableQty', 0] }, 0] },
            { $lte: [
              { $ifNull: ['$availableQty', 0] },
              hasThresholdOverride ? threshold : { $ifNull: ['$stockAlertThreshold', threshold] },
            ] },
          ],
        },
      };
      const [skus, count, outOfStockSkus, outOfStockCount] = await Promise.all([
        DairySku.find(filter)
        .select('name availableQty packSize stockAlertThreshold inStock')
        .sort({ availableQty: 1 })
        .limit(10),
        DairySku.countDocuments(filter),
        DairySku.find({ business: business._id, status: true, availableQty: { $lte: 0 } })
          .select('name packSize availableQty')
          .sort({ name: 1 })
          .limit(10),
        DairySku.countDocuments({ business: business._id, status: true, availableQty: { $lte: 0 } }),
      ]);

      return {
        threshold,
        count,
        outOfStock: {
          count: outOfStockCount,
          items: outOfStockSkus.map((sku) => ({
            id: sku._id,
            name: sku.name,
            packSize: sku.packSize,
          })),
        },
        items: skus.map((sku) => ({
          id: sku._id,
          name: sku.name,
          availableQty: sku.availableQty,
          stockAlertThreshold: sku.stockAlertThreshold == null ? threshold : sku.stockAlertThreshold,
          inStock: sku.inStock,
          packSize: sku.packSize,
        })),
      };
    }),

    panel('expiryAlerts', async () => {
      const now = new Date();
      const expiresWithin = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      const baseFilter = {
        business: business._id,
        status: { $in: ['source', 'blended', 'expired'] },
        availableQtyL: { $gt: 0 },
      };
      const filter = { ...baseFilter, expiry: { $lte: expiresWithin } };
      const [batches, expiredCount, expiringSoonCount, skuLots, skuExpiredCount, skuExpiringSoonCount] = await Promise.all([
        DairyMilkBatch.find(filter).select('batchNo expiry availableQtyL status').sort({ expiry: 1 }).limit(20).lean(),
        DairyMilkBatch.countDocuments({ ...baseFilter, expiry: { $lte: now } }),
        DairyMilkBatch.countDocuments({ ...baseFilter, expiry: { $gt: now, $lte: expiresWithin } }),
        DairySkuInventoryLot.find({
          business: business._id,
          status: { $in: ['active', 'expired'] },
          $or: [{ availableQty: { $gt: 0 } }, { expiredQty: { $gt: 0 } }],
          expiry: { $ne: null, $lte: expiresWithin },
        }).populate('sku', 'name packSize').sort({ expiry: 1 }).limit(20).lean(),
        DairySkuInventoryLot.countDocuments({ business: business._id, status: { $in: ['active', 'expired'] }, $or: [{ availableQty: { $gt: 0 } }, { expiredQty: { $gt: 0 } }], expiry: { $ne: null, $lte: now } }),
        DairySkuInventoryLot.countDocuments({ business: business._id, status: 'active', availableQty: { $gt: 0 }, expiry: { $gt: now, $lte: expiresWithin } }),
      ]);
      const items = [
        ...batches.map((batch) => ({
          id: batch._id,
          batchNo: batch.batchNo,
          expiry: batch.expiry,
          availableQtyL: batch.availableQtyL,
          status: batch.expiry <= now ? 'expired' : 'expiring_soon',
          itemType: 'raw_milk',
        })),
        ...skuLots.map((lot) => ({
          id: lot._id,
          batchNo: lot.lotNo,
          expiry: lot.expiry,
          availableQty: lot.availableQty,
          expiredQty: lot.expiredQty || 0,
          productName: lot.sku && lot.sku.name,
          packSize: lot.sku && lot.sku.packSize,
          status: lot.expiry <= now ? 'expired' : 'expiring_soon',
          itemType: 'finished_product',
        })),
      ].sort((a, b) => new Date(a.expiry) - new Date(b.expiry)).slice(0, 20);
      return {
        windowHours: 72,
        expiredCount: expiredCount + skuExpiredCount,
        expiringSoonCount: expiringSoonCount + skuExpiringSoonCount,
        count: expiredCount + skuExpiredCount + expiringSoonCount + skuExpiringSoonCount,
        items,
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
      const activeRunsFilter = {
        business: business._id,
        serviceDate: today,
        status: { $nin: ['completed', 'cancelled'] },
      };
      const [runsInProgress, activeRunIds] = await Promise.all([
        DeliveryRun.countDocuments({
          ...activeRunsFilter,
          status: { $in: ['dispatched', 'in_progress'] },
        }),
        DeliveryRun.distinct('_id', activeRunsFilter),
      ]);
      const stopsPending = activeRunIds.length === 0
        ? 0
        : await DeliveryStop.countDocuments({ run: { $in: activeRunIds }, status: 'pending' });
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
      city: business.city || null,
      locality: business.locality || null,
    },
    generatedAt: new Date(),
    today: todayOrders,
    salesTrend,
    lowStock,
    expiryAlerts,
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
  getSalesTrend,
};
