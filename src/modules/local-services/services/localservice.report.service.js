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

const { fromPaise } = require('../../../utils/money');
const { summarizeEntries } = require('./localservice.settlement.service');

const LocalServiceBooking = require('../models/localservice.booking.model');
const LocalServiceProvider = require('../models/localservice.provider.model');
const LocalServiceService = require('../models/localservice.service.model');
const LocalServiceRevenueEntry = require('../models/localservice.revenue.entry.model');
const LocalServiceQuote = require('../models/localservice.quote.model');
const { LocalServiceRefundRequest } = require('../models/localservice.catalog.ext.model');

const CONFIRMED_STATUSES = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];
const DECIDED_QUOTE_STATUSES = ['ACCEPTED', 'REJECTED', 'EXPIRED'];

const rate = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0);

const buildDateFilter = (from, to) => {
  if (!from && !to) return null;
  const filter = {};
  if (from) filter.$gte = new Date(from);
  if (to) filter.$lte = new Date(to);
  return filter;
};

async function adminReportSummary({ from, to } = {}) {
  const createdAt = buildDateFilter(from, to);
  const dated = createdAt ? { createdAt } : {};

  const [providerActive, providerPending, providerTotal, servicesPublished, bookingGroups, quoteGroups, entries, unsettled, refunds, categories] =
    await Promise.all([
      LocalServiceProvider.countDocuments({ status: 'ACTIVE' }),
      LocalServiceProvider.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } }),
      LocalServiceProvider.countDocuments({}),
      LocalServiceService.countDocuments({ status: 'active' }),
      LocalServiceBooking.aggregate([
        { $match: dated },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      LocalServiceQuote.aggregate([
        { $match: dated },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      LocalServiceRevenueEntry.find(dated).lean(),
      LocalServiceRevenueEntry.find({ status: 'applied', settlement: null }).lean(),
      LocalServiceRefundRequest.find(dated).select('status requestedAmount approvedAmount').lean(),
      LocalServiceBooking.aggregate([
        { $match: { ...dated, categoryKey: { $nin: [null, ''] } } },
        {
          $group: {
            _id: '$categoryKey',
            bookings: { $sum: 1 },
            grossValuePaise: { $sum: '$serviceValue' },
          },
        },
        { $sort: { grossValuePaise: -1 } },
        { $limit: 20 },
      ]),
    ]);

  const byStatus = {};
  for (const row of bookingGroups) byStatus[row._id] = row.count;
  const bookingTotal = bookingGroups.reduce((sum, row) => sum + row.count, 0);
  const confirmed = CONFIRMED_STATUSES.reduce((sum, status) => sum + (byStatus[status] || 0), 0);
  const cancelled = byStatus.CANCELLED || 0;
  const noShow = byStatus.NO_SHOW || 0;
  const completed = byStatus.COMPLETED || 0;
  const closed = completed + cancelled + noShow;

  const quoteByStatus = {};
  for (const row of quoteGroups) quoteByStatus[row._id] = row.count;
  const decidedQuotes = DECIDED_QUOTE_STATUSES.reduce((sum, status) => sum + (quoteByStatus[status] || 0), 0);

  const financials = summarizeEntries(entries);
  let cashCollected = 0;
  let refunded = 0;
  for (const entry of entries) {
    const amount = Math.abs(fromPaise(entry.customerTotal) || 0);
    if (entry.entryType === 'reversal') refunded += amount;
    else cashCollected += amount;
  }
  const customerTotal = cashCollected - refunded;

  const refundSummary = { requested: 0, approved: 0, rejected: 0, completed: 0, failed: 0, processing: 0 };
  let requestedAmount = 0;
  let approvedAmount = 0;
  for (const refund of refunds) {
    if (refundSummary[refund.status] != null) refundSummary[refund.status] += 1;
    requestedAmount += fromPaise(refund.requestedAmount) || 0;
    approvedAmount += fromPaise(refund.approvedAmount) || 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    period: { from: from || null, to: to || null },
    providers: {
      total: providerTotal,
      active: providerActive,
      pendingVerification: providerPending,
    },
    services: { published: servicesPublished },
    bookings: {
      total: bookingTotal,
      byStatus,
      confirmed,
      completed,
      cancelled,
      noShow,
      conversionRate: rate(confirmed, bookingTotal),
      cancellationRate: rate(cancelled, bookingTotal),
      noShowRate: rate(noShow, bookingTotal),
      fulfilmentRate: rate(completed, closed),
    },
    revenue: {
      grossBookingValue: Number(customerTotal.toFixed(2)),
      cashCollected: Number(cashCollected.toFixed(2)),
      refunded: Number(refunded.toFixed(2)),
      bookingFees: financials.netFees,
      commission: financials.netCommission,
      platformRevenue: financials.netPlatform,
      providerPayable: financials.netPayable,
      reversals: financials.reversals,
      netRevenue: financials.net,
    },
    refunds: {
      ...refundSummary,
      requestedAmount: Number(requestedAmount.toFixed(2)),
      approvedAmount: Number(approvedAmount.toFixed(2)),
      pending: refundSummary.requested + refundSummary.processing,
    },
    quotes: {
      submitted: quoteByStatus.SUBMITTED || 0,
      accepted: quoteByStatus.ACCEPTED || 0,
      rejected: quoteByStatus.REJECTED || 0,
      expired: quoteByStatus.EXPIRED || 0,
      revised: quoteByStatus.REVISED || 0,
      acceptanceRate: rate(quoteByStatus.ACCEPTED || 0, decidedQuotes),
    },
    categories: categories.map((row) => ({
      categoryKey: row._id,
      bookings: row.bookings,
      grossBookingValue: Number((fromPaise(row.grossValuePaise) || 0).toFixed(2)),
    })),
    settlement: {
      unsettledEntries: unsettled.length,
      liability: summarizeEntries(unsettled).netPayable,
    },
  };
}

module.exports = { adminReportSummary };
