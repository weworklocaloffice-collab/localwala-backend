const { DairyOrder, DairyCompliance, DairySettlement, DairySku } = require('../../../models');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const buildDateFilter = (from, to) => {
  if (!from && !to) return null;
  const filter = {};
  if (from) filter.$gte = new Date(from);
  if (to) filter.$lte = new Date(to);
  return filter;
};

const salesSummary = async ({ from, to, businessId } = {}) => {
  const createdAt = buildDateFilter(from, to);
  const match = { ...(createdAt ? { createdAt } : {}), ...(businessId ? { business: businessId } : {}) };

  const [byModel, byStatus, topOutlets, totals] = await Promise.all([
    DairyOrder.aggregate([
      { $match: match },
      { $lookup: { from: 'businesses', localField: 'business', foreignField: '_id', as: 'businessDoc' } },
      { $unwind: { path: '$businessDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$businessDoc.businessModel',
          orders: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        },
      },
      { $sort: { grandTotal: -1 } },
    ]),
    DairyOrder.aggregate([
      { $match: match },
      { $group: { _id: '$status', orders: { $sum: 1 }, grandTotal: { $sum: '$grandTotal' } } },
      { $sort: { orders: -1 } },
    ]),
    DairyOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$business',
          orders: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
        },
      },
      { $sort: { grandTotal: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'businesses', localField: '_id', foreignField: '_id', as: 'business' } },
      { $unwind: { path: '$business', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          business: { _id: '$business._id', name: '$business.name', businessModel: '$business.businessModel' },
          orders: 1,
          grandTotal: 1,
        },
      },
    ]),
    DairyOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const money = (value) => Number(((Number(value) || 0) / 100).toFixed(2));
  return {
    totals: {
      orders: totals[0]?.orders || 0,
      grandTotal: money(totals[0]?.grandTotal),
      delivered: totals[0]?.delivered || 0,
      cancelled: totals[0]?.cancelled || 0,
    },
    byModel: byModel.map((row) => ({ ...row, grandTotal: money(row.grandTotal) })),
    byStatus: byStatus.map((row) => ({ ...row, grandTotal: money(row.grandTotal) })),
    topOutlets: topOutlets.map((row) => ({ ...row, grandTotal: money(row.grandTotal) })),
  };
};

/** Outlet-scoped commercial report. Mongo aggregates use paise; the API returns rupees. */
const partnerSalesReport = async ({ businessId, from, to }) => {
  const period = buildDateFilter(from, to);
  const match = { business: businessId, ...(period ? { createdAt: period } : {}) };
  const completed = { ...match, status: 'delivered' };
  const [orders, statuses, trend, topProducts, coupons, settlements, skuCount] = await Promise.all([
    DairyOrder.aggregate([
      { $match: match },
      { $group: {
        _id: null,
        orderCount: { $sum: 1 },
        completedCount: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        cancelledCount: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'refunded']] }, 1, 0] } },
        grossSales: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$itemTotal', 0] } },
        discounts: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$discountAmount', 0] } },
        deliveredOrderValue: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$grandTotal', 0] } },
      } },
    ]),
    DairyOrder.aggregate([
      { $match: match },
      { $group: { _id: '$status', orders: { $sum: 1 }, value: { $sum: '$grandTotal' } } },
      { $sort: { orders: -1 } },
    ]),
    DairyOrder.aggregate([
      { $match: completed },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: process.env.TZ || 'UTC' } },
        orders: { $sum: 1 },
        sales: { $sum: '$grandTotal' },
        discounts: { $sum: '$discountAmount' },
      } },
      { $sort: { _id: 1 } },
    ]),
    DairyOrder.aggregate([
      { $match: completed },
      { $unwind: '$items' },
      { $group: {
        _id: '$items.sku',
        name: { $first: '$items.name' },
        units: { $sum: '$items.quantity' },
        grossSales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
      } },
      { $sort: { grossSales: -1 } },
      { $limit: 10 },
    ]),
    DairyOrder.aggregate([
      { $match: { ...completed, couponCode: { $exists: true, $ne: '' } } },
      { $group: { _id: '$couponCode', redemptions: { $sum: 1 }, discount: { $sum: '$discountAmount' } } },
      { $sort: { redemptions: -1 } },
    ]),
    DairySettlement.aggregate([
      { $match: { business: businessId, ...(period ? { createdAt: period } : {}) } },
      { $group: { _id: '$status', count: { $sum: 1 }, netAmount: { $sum: '$netAmount' } } },
      { $sort: { _id: 1 } },
    ]),
    DairySku.countDocuments({ business: businessId, status: true }),
  ]);
  const total = orders[0] || { orderCount: 0, completedCount: 0, cancelledCount: 0, grossSales: 0, discounts: 0, deliveredOrderValue: 0 };
  const money = (value) => Number(((Number(value) || 0) / 100).toFixed(2));
  return {
    totals: {
      orders: total.orderCount,
      completedOrders: total.completedCount,
      cancelledOrders: total.cancelledCount,
      grossSales: money(total.grossSales),
      discounts: money(total.discounts),
      netProductSales: money(total.grossSales - total.discounts),
      deliveredOrderValue: money(total.deliveredOrderValue),
      averageOrderValue: total.completedCount ? money(total.deliveredOrderValue / total.completedCount) : 0,
      activeSkus: skuCount,
    },
    byStatus: statuses.map((row) => ({ status: row._id, orders: row.orders, value: money(row.value) })),
    dailyTrend: trend.map((row) => ({ date: row._id, orders: row.orders, sales: money(row.sales), discounts: money(row.discounts) })),
    topProducts: topProducts.map((row) => ({ sku: row._id, name: row.name || 'Product', units: row.units, grossSales: money(row.grossSales) })),
    couponImpact: coupons.map((row) => ({ code: row._id, redemptions: row.redemptions, discounts: money(row.discount) })),
    settlements: settlements.map((row) => ({ status: row._id, count: row.count, netAmount: money(row.netAmount) })),
  };
};

const salesExportRows = async ({ businessId, from, to } = {}) => {
  if (!from || !to) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a start and end date for the export');
  const rangeMs = new Date(to).getTime() - new Date(from).getTime();
  if (rangeMs < 0 || rangeMs > 92 * 24 * 60 * 60 * 1000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Exports are limited to a date range of 92 days');
  }
  const query = { createdAt: { $gte: new Date(from), $lte: new Date(to) } };
  if (businessId) query.business = businessId;
  const count = await DairyOrder.countDocuments(query);
  if (count > 10000) throw new ApiError(httpStatus.PAYLOAD_TOO_LARGE, 'Narrow the date range to export at most 10,000 orders');
  return DairyOrder.find(query)
    .sort({ createdAt: 1, _id: 1 })
    .select('orderNo business status createdAt itemTotal discountAmount serviceCharge taxAmount grandTotal paymentMode paymentStatus couponCode')
    .populate('business', 'name')
    .lean();
};

const complianceSummary = async () => {
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [byStatus, expiring, expired, missing] = await Promise.all([
    DairyCompliance.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    DairyCompliance.find({
      'fssai.expiresAt': { $gte: now, $lte: horizon },
    })
      .select('business fssai.expiresAt status')
      .populate('business', 'name businessModel')
      .lean(),
    DairyCompliance.countDocuments({ 'fssai.expiresAt': { $lt: now } }),
    DairyCompliance.countDocuments({ 'fssai.licenceNumber': { $in: [null, ''] } }),
  ]);

  return {
    byStatus,
    expiringCount: expiring.length,
    expiring,
    expiredCount: expired,
    missingLicenceCount: missing,
  };
};

const settlementSummary = async ({ from, to, status } = {}) => {
  const createdAt = from || to ? {} : null;
  if (from) createdAt.$gte = new Date(from);
  if (to) createdAt.$lte = new Date(to);
  const match = {};
  if (createdAt) match.createdAt = createdAt;
  if (status) match.status = status;

  const [byStatus, byType, totals] = await Promise.all([
    DairySettlement.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, netAmount: { $sum: '$netAmount' } } },
      { $sort: { count: -1 } },
    ]),
    DairySettlement.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $cond: [{ $ifNull: ['$partner', false] }, 'partner', 'franchise'] },
          count: { $sum: 1 },
          netAmount: { $sum: '$netAmount' },
        },
      },
    ]),
    DairySettlement.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          netAmount: { $sum: '$netAmount' },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  return {
    totals: totals[0] || { count: 0, netAmount: 0, approved: 0, paid: 0 },
    byStatus,
    byType,
  };
};

module.exports = { salesSummary, partnerSalesReport, salesExportRows, complianceSummary, settlementSummary };
