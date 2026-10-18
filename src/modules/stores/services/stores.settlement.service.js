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
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const generateSettlementNo = async () => {
  const Settlement = mongoose.model('Settlement');
  const last = await Settlement.findOne().sort({ settlementNo: -1 }).select('settlementNo').lean();
  return (last?.settlementNo || 100000) + 1;
};

const generateSettlement = async ({ vertical, counterpartyType, counterparty, store, chain, settlementType, period, from, to }) => {
  const Settlement = mongoose.model('Settlement');
  const SettlementItem = mongoose.model('SettlementItem');
  const StoreOrder = mongoose.model('StoreOrder');

  const existing = await Settlement.findOne({ vertical, counterparty, store, period, from, to });
  if (existing) return existing;

  const orders = await StoreOrder.find({
    outlet: store,
    lifecycle: { $in: ['delivered', 'completed'] },
    createdAt: { $gte: from, $lte: to },
  }).lean();

  if (!orders.length) return null;

  const lineItems = [];
  let grossOrderValue = 0;
  let refunds = 0;
  let deliveryTips = 0;
  let orderCount = 0;

  // `SettlementItem.settlement` is required, so the parent row must exist before the first
  // item is written. The shell is created with empty totals and filled after the loop.
  const settlement = await Settlement.create({
    settlementNo: await generateSettlementNo(),
    vertical,
    counterpartyType,
    counterparty,
    store,
    chain,
    settlementType,
    period,
    from,
    to,
    totals: {
      orderCount: 0,
      grossOrderValue: 0,
      refunds: 0,
      adjustments: 0,
      platformFees: 0,
      deliveryTips: 0,
      netAmount: 0,
    },
    lineItems: [],
    status: 'pending',
  });

  for (const order of orders) {
    const item = await SettlementItem.create({
      settlement: settlement._id,
      order: order._id,
      orderNo: order.orderNo,
      outlet: order.outlet,
      chain: order.chain,
      grossAmount: order.itemsSubtotal,
      refundAmount: order.refundedAmount || 0,
      adjustmentAmount: 0,
      platformFee: 0,
      deliveryTip: order.deliveryTip || 0,
      netAmount: order.grandTotal - (order.refundedAmount || 0),
      customerVisibleTotal: order.grandTotal,
      taxTotal: order.taxTotal || 0,
      deliveryFee: order.deliveryFee || 0,
      packagingFee: order.packagingFee || 0,
      serviceFee: order.serviceFee || 0,
      discountTotal: order.discountTotal || 0,
      codAmount: order.codAmount || 0,
      itemCount: order.totalItems || 0,
      quantity: order.totalQuantity || 0,
      categorySnapshot: order.categorySnapshot || [],
    });
    lineItems.push(item._id);

    grossOrderValue += order.itemsSubtotal;
    refunds += order.refundedAmount || 0;
    deliveryTips += order.deliveryTip || 0;
    orderCount += 1;
  }

  const netAmount = grossOrderValue - refunds + deliveryTips;

  settlement.totals = {
    orderCount,
    grossOrderValue,
    refunds,
    adjustments: 0,
    platformFees: 0,
    deliveryTips,
    netAmount,
  };
  settlement.lineItems = lineItems;
  await settlement.save();

  return settlement;
};

const getSettlement = async (settlementId) => {
  const Settlement = mongoose.model('Settlement');
  const settlement = await Settlement.findById(settlementId)
    .populate('lineItems')
    .populate('counterparty', 'name')
    .populate('store', 'name outletCode')
    .lean();
  if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');
  return settlement;
};

const listSettlements = async ({ vertical, counterparty, store, status, period, page = 1, limit = 20 }) => {
  const Settlement = mongoose.model('Settlement');
  const filter = {};
  if (vertical) filter.vertical = vertical;
  if (counterparty) filter.counterparty = counterparty;
  if (store) filter.store = store;
  if (status) filter.status = status;
  if (period) filter.period = period;

  const [items, total] = await Promise.all([
    Settlement.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Settlement.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const markSettled = async (settlementId, { payoutMethod, payoutDetails, gatewayReference, approvedBy }) => {
  const Settlement = mongoose.model('Settlement');
  const settlement = await Settlement.findById(settlementId);
  if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');
  if (settlement.status !== 'pending') throw new ApiError(httpStatus.CONFLICT, `Settlement is ${settlement.status}, not pending`);

  settlement.status = 'settled';
  settlement.payoutMethod = payoutMethod;
  settlement.payoutDetails = payoutDetails;
  settlement.gatewayReference = gatewayReference;
  settlement.approvedBy = approvedBy;
  settlement.approvedAt = new Date();
  settlement.settlementDate = new Date();

  await settlement.save();
  return settlement;
};

const markFailed = async (settlementId, { failureReason }) => {
  const Settlement = mongoose.model('Settlement');
  const settlement = await Settlement.findById(settlementId);
  if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');

  settlement.status = 'failed';
  settlement.failureReason = failureReason;
  await settlement.save();
  return settlement;
};

const reverseSettlement = async (settlementId, { reason, approvedBy }) => {
  const Settlement = mongoose.model('Settlement');
  const settlement = await Settlement.findById(settlementId);
  if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');
  if (settlement.status !== 'settled') throw new ApiError(httpStatus.CONFLICT, 'Only settled settlements can be reversed');

  settlement.status = 'reversed';
  settlement.notes = reason;
  settlement.approvedBy = approvedBy;
  settlement.approvedAt = new Date();

  await settlement.save();
  return settlement;
};

module.exports = {
  generateSettlement,
  getSettlement,
  listSettlements,
  markSettled,
  markFailed,
  reverseSettlement,
  generateSettlementNo,
};