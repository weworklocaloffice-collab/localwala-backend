const { DairyOrder, DairyCompliance, DairySettlement } = require('../../../models');

const buildDateFilter = (from, to) => {
  if (!from && !to) return null;
  const filter = {};
  if (from) filter.$gte = new Date(from);
  if (to) filter.$lte = new Date(to);
  return filter;
};

const salesSummary = async ({ from, to } = {}) => {
  const createdAt = buildDateFilter(from, to);
  const match = createdAt ? { createdAt } : {};

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

  return {
    totals: totals[0] || { orders: 0, grandTotal: 0, delivered: 0, cancelled: 0 },
    byModel,
    byStatus,
    topOutlets,
  };
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

module.exports = { salesSummary, complianceSummary, settlementSummary };
