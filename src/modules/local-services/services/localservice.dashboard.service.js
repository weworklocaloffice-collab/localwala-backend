const { fromPaise } = require('../../../utils/money');
const { adminReportSummary } = require('./localservice.report.service');
const LocalServiceBooking = require('../models/localservice.booking.model');
const LocalServiceProvider = require('../models/localservice.provider.model');
const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');

const CONFIRMED_STATUSES = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];

const buildDateFilter = (from, to) => {
  if (!from && !to) return null;
  const filter = {};
  if (from) filter.$gte = new Date(from);
  if (to) filter.$lte = new Date(to);
  return filter;
};

const shiftDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

async function adminDashboard({ from, to } = {}) {
  const now = new Date();
  const toDate = to ? new Date(to) : now;
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const span = toDate.getTime() - fromDate.getTime();
  const prevTo = new Date(fromDate.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);

  const [current, previous, topProvidersAgg, seriesAgg, queues] = await Promise.all([
    adminReportSummary({ from: fromDate.toISOString(), to: toDate.toISOString() }),
    adminReportSummary({ from: prevFrom.toISOString(), to: prevTo.toISOString() }),
    LocalServiceBooking.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate }, provider: { $ne: null } } },
      { $group: { _id: '$provider', bookings: { $sum: 1 }, grossValuePaise: { $sum: '$serviceValue' } } },
      { $sort: { grossValuePaise: -1 } },
      { $limit: 10 },
    ]),
    LocalServiceBooking.aggregate([
      { $match: { createdAt: { $gte: fromDate, $lte: toDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          bookings: { $sum: 1 },
          grossValuePaise: { $sum: '$serviceValue' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    (async () => {
      const [applications, documents, offerings, refunds] = await Promise.all([
        LocalServiceProvider.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } }),
        (async () => {
          const Document = require('../models/localservice.document.model');
          return Document.countDocuments({ status: 'pending' });
        })(),
        (async () => {
          const Offering = require('../models/localservice.offering.model');
          return Offering.countDocuments({ status: 'pending' });
        })(),
        (async () => {
          const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');
          return LocalServiceRefundRequest.countDocuments({ status: 'requested' });
        })(),
      ]);
      return { applications, documents, offerings, refunds, total: applications + documents + offerings + refunds };
    })(),
  ]);

  const providerIds = topProvidersAgg.map((r) => r._id);
  const providerDocs = await LocalServiceProvider.find({ _id: { $in: providerIds } }).select('businessName').lean();
  const providerNameById = {};
  for (const p of providerDocs) providerNameById[String(p._id)] = p.businessName;
  const topProviders = topProvidersAgg.map((r) => ({
    providerId: r._id,
    businessName: providerNameById[String(r._id)] || '—',
    bookings: r.bookings,
    grossBookingValue: Number(((fromPaise(r.grossValuePaise) || 0)).toFixed(2)),
  }));

  const series = seriesAgg.map((r) => ({
    date: r._id,
    bookings: r.bookings,
    grossBookingValue: Number(((fromPaise(r.grossValuePaise) || 0)).toFixed(2)),
  }));

  const delta = (cur, prev) => {
    const c = Number(cur) || 0;
    const p = Number(prev) || 0;
    const diff = c - p;
    const pct = p !== 0 ? Number(((diff / p) * 100).toFixed(2)) : (c > 0 ? 100 : 0);
    return { current: c, previous: p, diff: Number(diff.toFixed(2)), pct };
  };

  const curRev = current.revenue || {};
  const prevRev = previous.revenue || {};
  const curBook = current.bookings || {};
  const prevBook = previous.bookings || {};
  const curRef = current.refunds || {};
  const prevRef = previous.refunds || {};

  const kpis = {
    grossBookingValue: delta(curRev.grossBookingValue, prevRev.grossBookingValue),
    cashCollected: delta(curRev.cashCollected, prevRev.cashCollected),
    netRevenue: delta(curRev.netRevenue, prevRev.netRevenue),
    platformRevenue: delta(curRev.platformRevenue, prevRev.platformRevenue),
    bookings: delta(curBook.total, prevBook.total),
    confirmed: delta(curBook.confirmed, prevBook.confirmed),
    cancelled: delta(curBook.cancelled, prevBook.cancelled),
    cancellationRate: delta(curBook.cancellationRate, prevBook.cancellationRate),
    activeProviders: delta(current.providers.active, previous.providers.active),
    pendingRefunds: delta(curRef.pending, prevRef.pending),
  };

  const funnel = {
    requested: (curBook.byStatus && curBook.byStatus.REQUESTED) || 0,
    pendingProvider: (curBook.byStatus && curBook.byStatus.PENDING_PROVIDER) || 0,
    accepted: (curBook.byStatus && curBook.byStatus.ACCEPTED) || 0,
    paymentPending: (curBook.byStatus && curBook.byStatus.PAYMENT_PENDING) || 0,
    confirmed: curBook.confirmed || 0,
    inProgress: (curBook.byStatus && curBook.byStatus.IN_PROGRESS) || 0,
    completed: curBook.completed || 0,
    cancelled: curBook.cancelled || 0,
    noShow: curBook.noShow || 0,
    disputed: (curBook.byStatus && curBook.byStatus.DISPUTED) || 0,
  };

  const refundRate = curBook.total > 0
    ? Number((( (curRef.requested + curRef.processing + curRef.approved + curRef.completed + curRef.failed + curRef.rejected) / curBook.total) * 100).toFixed(2))
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    previousPeriod: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
    kpis,
    funnel,
    refundRate,
    topProviders,
    series,
    categories: current.categories,
    queues,
    current,
  };
}

module.exports = { adminDashboard };
