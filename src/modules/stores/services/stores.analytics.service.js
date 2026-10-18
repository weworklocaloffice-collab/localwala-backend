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

const getOutletDashboard = async (outletId, { from, to } = {}) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const StoreReview = mongoose.model('StoreReview');

  const dateFilter = {};
  if (from || to) {
    dateFilter.createdAt = {};
    if (from) dateFilter.createdAt.$gte = new Date(from);
    if (to) dateFilter.createdAt.$lte = new Date(to);
  }

  const [orderStats, stockStats, reviewStats, topProducts] = await Promise.all([
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
  ]);

  return {
    orders: orderStats[0] || { totalOrders: 0, totalRevenue: 0, totalRefunds: 0, avgOrderValue: 0 },
    inventory: stockStats[0] || { totalSkus: 0, lowStock: 0, outOfStock: 0, totalValue: 0 },
    reviews: reviewStats[0] || { avgRating: 0, totalReviews: 0 },
    topProducts,
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