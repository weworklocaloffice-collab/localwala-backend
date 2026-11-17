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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { computeOpenStatus } = require('../../../utils/openStatus');
const profileService = require('./stores.profile.service');

/** Local midnight for `date`. The dashboard's work queue is a local-business-day question. */
const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const getOutletDashboard = async (outletId, { from, to } = {}, actorRole = null) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const StoreReview = mongoose.model('StoreReview');
  const StoreDriver = mongoose.model('StoreDriver');
  const StoreDelivery = mongoose.model('StoreDelivery');
  const StoreSubscription = mongoose.model('StoreSubscription');
  const StoreComplianceDocument = mongoose.model('StoreComplianceDocument');
  const StoreOutlet = mongoose.model('StoreOutlet');
  const StoreChain = mongoose.model('StoreChain');

  const dateFilter = {};
  if (from || to) {
    dateFilter.createdAt = {};
    if (from) dateFilter.createdAt.$gte = new Date(from);
    if (to) dateFilter.createdAt.$lte = new Date(to);
  }

  // The action strip and sales strip are always "as of now". They answer "what needs
  // me today", which is a different question from the caller's analytic window; pinning
  // them to fixed windows means changing `from`/`to` cannot blank the operator's queue.
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = new Date(dayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(dayStart);
  monthStart.setDate(monthStart.getDate() - 29);

  // Unpaid, abandoned and reversed rows are not sales. Everything else counts.
  const SALES_EXCLUDED = ['created', 'payment_pending', 'payment_failed', 'rejected', 'cancelled'];

  const outlet = await StoreOutlet.findById(outletId).select('name operatingHours chain').lean();
  // The dashboard header is the only place a human reads these; resolve the chain
  // label alongside the outlet so the screen never renders a bare id.
  const chain = outlet && outlet.chain
    ? await StoreChain.findById(outlet.chain).select('name').lean()
    : null;
  const expiryWindowEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    orderStats,
    stockStats,
    reviewStats,
    topProducts,
    dashStats,
    driverStats,
    onDeliveryDrivers,
    subscriptionRow,
    expiringDocs,
  ] = await Promise.all([

    StoreOrder.aggregate([
      { $match: { outlet: new mongoose.Types.ObjectId(outletId), ...dateFilter } },
      { $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$grandTotal' },
        totalRefunds: { $sum: '$refundedAmount' },
        avgOrderValue: { $avg: '$grandTotal' },
      } },
    ]),
    StoreOutletStockItem.aggregate([
      { $match: { outlet: new mongoose.Types.ObjectId(outletId) } },
      // Cost lives on the OUTLET PRODUCT, not the stock item: join it in by
      // (outlet, variant) before valuing. A stock row with no join row (or a join row
      // with no cost) contributes 0 rather than nulling the whole sum — an untracked
      // SKU must not zero out every tracked one.
      {
        $lookup: {
          from: 'storeoutletproducts',
          let: { outlet: '$outlet', variant: '$variant' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$outlet', '$$outlet'] },
                    { $eq: ['$productVariant', '$$variant'] },
                  ],
                },
              },
            },
            { $project: { costPrice: 1 } },
          ],
          as: 'costRow',
        },
      },
      { $group: {
        _id: null,
        totalSkus: { $sum: 1 },
        lowStock: { $sum: { $cond: [{ $lte: ['$availableQty', '$lowStockThreshold'] }, 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $eq: ['$availableQty', 0] }, 1, 0] } },
        totalValue: {
          $sum: {
            $multiply: [
              '$onHand',
              { $ifNull: [{ $arrayElemAt: ['$costRow.costPrice', 0] }, 0] },
            ],
          },
        },
      } },
    ]),
    StoreReview.aggregate([
      { $match: { outlet: new mongoose.Types.ObjectId(outletId), status: 'approved' } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } },
    ]),
    StoreOrder.aggregate([
      { $match: { outlet: new mongoose.Types.ObjectId(outletId), ...dateFilter } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', name: { $first: '$items.name' }, totalSold: { $sum: '$items.quantity' }, totalRevenue: { $sum: '$items.lineTotal' } } },
      { $sort: { totalSold: -1 } },
      { $limit: 10 },
    ]),
    // The dashboard head: action counts (current queue), sales windows and recent orders.
    StoreOrder.aggregate([
      { $match: { outlet: new mongoose.Types.ObjectId(outletId) } },
      {
        $facet: {
          lifecycleCounts: [
            { $match: { lifecycle: { $in: ['store_received', 'paid', 'accepted', 'picking', 'packing', 'ready'] } } },
            { $group: { _id: '$lifecycle', count: { $sum: 1 } } },
          ],
          windows: [
            { $match: { createdAt: { $gte: monthStart } } },
            {
              $group: {
                _id: null,
                todayOrders: { $sum: { $cond: [{ $gte: ['$createdAt', dayStart] }, 1, 0] } },
                todayDelivered: {
                  $sum: {
                    $cond: [
                      { $and: [{ $gte: ['$createdAt', dayStart] }, { $in: ['$lifecycle', ['delivered', 'completed']] }] },
                      1,
                      0,
                    ],
                  },
                },
                todayRevenue: {
                  $sum: {
                    $cond: [
                      { $and: [{ $gte: ['$createdAt', dayStart] }, { $not: { $in: ['$lifecycle', SALES_EXCLUDED] } }] },
                      '$grandTotal',
                      0,
                    ],
                  },
                },
                weekRevenue: {
                  $sum: {
                    $cond: [
                      { $and: [{ $gte: ['$createdAt', weekStart] }, { $not: { $in: ['$lifecycle', SALES_EXCLUDED] } }] },
                      '$grandTotal',
                      0,
                    ],
                  },
                },
                monthRevenue: {
                  $sum: { $cond: [{ $not: { $in: ['$lifecycle', SALES_EXCLUDED] } }, '$grandTotal', 0] },
                },
              },
            },
          ],
          recent: [
            { $sort: { createdAt: -1 } },
            { $limit: 6 },
            {
              $project: {
                orderNo: 1,
                grandTotal: 1,
                lifecycle: 1,
                createdAt: 1,
                customerName: '$addressSnapshot.name',
                itemCount: { $size: { $ifNull: ['$items', []] } },
              },
            },
          ],
        },
      },
    ]),
    StoreDriver.aggregate([
      {
        $match: {
          outlet: new mongoose.Types.ObjectId(outletId),
          status: { $in: ['active', 'reactivated'] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          available: { $sum: { $cond: [{ $eq: ['$isAvailable', true] }, 1, 0] } },
        },
      },
    ]),
    StoreDelivery.distinct('driver', {
      outlet: new mongoose.Types.ObjectId(outletId),
      status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
    }),
    outlet && outlet.chain
      ? StoreSubscription.findOne({
        chain: outlet.chain,
        status: { $in: ['trial', 'active', 'payment_due', 'retrying', 'grace_period', 'suspended'] },
      }).sort({ createdAt: -1 })
      : null,
    StoreComplianceDocument.countDocuments({
      outlet: new mongoose.Types.ObjectId(outletId),
      status: 'approved',
      expiresAt: { $ne: null, $gte: now, $lte: expiryWindowEnd },
    }),
  ]);

  const openStatus = outlet
    ? computeOpenStatus(outlet, new Date())
    : { isOpenNow: null, openReason: null, nextOpensAt: null };

  const dash = dashStats[0] || {};
  const lifecycleCounts = {};
  (dash.lifecycleCounts || []).forEach((row) => {
    lifecycleCounts[row._id] = row.count;
  });
  const windows = (dash.windows && dash.windows[0]) || {};
  const newOrders =
    (lifecycleCounts.store_received || 0) +
    (lifecycleCounts.paid || 0) +
    (lifecycleCounts.accepted || 0);
  const inventory =
    stockStats[0] || { totalSkus: 0, lowStock: 0, outOfStock: 0, totalValue: 0 };
  // Stock ON HAND at cost is a financial figure: §6.23.1 keeps cost price with the
  // owner. Managers still get the counts that run the shop floor; the valuation is
  // removed rather than zeroed so a client cannot mistake it for real data.
  if (!profileService.can(actorRole, 'costprice.view')) {
    delete inventory.totalValue;
  }
  const reviews = reviewStats[0] || { avgRating: 0, totalReviews: 0 };
  const drivers = driverStats[0] || { total: 0, available: 0 };

  return {
    outlet: outlet ? outlet.name : null,
    chain: chain ? chain.name : null,
    orders: orderStats[0] || { totalOrders: 0, totalRevenue: 0, totalRefunds: 0, avgOrderValue: 0 },
    inventory,
    reviews,
    topProducts,
    // What the operator acts on right now, not the analytic window.
    totals: {
      orderCount: windows.todayOrders || 0,
      revenue: windows.todayRevenue || 0,
      avgOrderValue: windows.todayOrders
        ? Math.round((windows.todayRevenue || 0) / windows.todayOrders)
        : 0,
      delivered: windows.todayDelivered || 0,
      newOrders,
      picking: lifecycleCounts.picking || 0,
      packing: lifecycleCounts.packing || 0,
      ready: lifecycleCounts.ready || 0,
      lowStock: inventory.lowStock,
      outOfStock: inventory.outOfStock,
      rating: reviews.avgRating,
      totalReviews: reviews.totalReviews,
    },
    sales: {
      today: windows.todayRevenue || 0,
      week: windows.weekRevenue || 0,
      month: windows.monthRevenue || 0,
    },
    drivers: {
      total: drivers.total || 0,
      available: drivers.available || 0,
      onDelivery: Array.isArray(onDeliveryDrivers) ? onDeliveryDrivers.length : 0,
    },
    recentOrders: dash.recent || [],
    ...openStatus,
    // Section 37 banners ride along so the screen never needs a second call.
    subscription: subscriptionRow
      ? {
        status: subscriptionRow.effectiveStatus,
        plan: subscriptionRow.plan,
        nextBillingDate: subscriptionRow.nextPaymentDueAt || null,
        daysToBilling: subscriptionRow.daysUntilDue,
        graceEndsAt: subscriptionRow.graceEndsAt || null,
        trialEndsAt: subscriptionRow.trialEndsAt || null,
      }
      : null,
    alerts: {
      noActiveDriver: (drivers.total || 0) === 0,
      lowStockCount: inventory.lowStock,
      expiringDocs,
    },
  };
};

const getChainAnalytics = async (chainId, { from, to } = {}) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const StoreOutlet = mongoose.model('StoreOutlet');

  const dateFilter = {};
  if (from || to) {
    dateFilter.createdAt = {};
    if (from) dateFilter.createdAt.$gte = new Date(from);
    if (to) dateFilter.createdAt.$lte = new Date(to);
  }

  const [outletStats, orderTrend] = await Promise.all([
    StoreOutlet.aggregate([
      { $match: { chain: new mongoose.Types.ObjectId(chainId) } },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgRating: { $avg: '$rating' },
      } },
    ]),
    StoreOrder.aggregate([
      { $match: { chain: new mongoose.Types.ObjectId(chainId), ...dateFilter } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        orders: { $sum: 1 },
        revenue: { $sum: '$grandTotal' },
      } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return { outlets: outletStats, orderTrend };
};

module.exports = {
  getOutletDashboard,
  getChainAnalytics,
};
