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

const { status: httpStatus } = require('http-status');
const {
  DairyPartner,
  DairyFranchise,
  DairySettlement,
  DairyOrder,
  Wallet,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const transactionService = require('../../../services/transaction.service');

/**
 * Settlement engine for both commercial shapes.
 *
 *   commission — the platform OWES the partner a cut of their sales
 *   franchise  — the franchisee OWES the platform a revenue share
 *
 * Sign convention, applied consistently: `netAmount` is **positive when the
 * platform owes money** and **negative when the counterparty owes the platform**.
 * One convention across both types, so a single payout path and a single
 * dashboard total work without per-type special cases.
 *
 * Commission basis is configurable per agreement (`product_only` by default).
 * Counting delivery fees by default would double-count: the platform pays the
 * rider, then takes a cut of what the rider collected.
 */

const nextSettlementNo = async () => {
  const latest = await DairySettlement.findOne().sort({ settlementNo: -1 }).select('settlementNo');
  return latest && latest.settlementNo ? latest.settlementNo + 1 : 1;
};

/**
 * Resolves a period name to a concrete date range.
 *
 * @param {string} period
 * @param {Date} reference
 * @returns {{from: Date, to: Date}}
 */
const resolvePeriod = (period, reference) => {
  const ref = reference ? new Date(reference) : new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const from = startOfDay(ref);
  let to;

  switch (period) {
    case 'daily':
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
      break;
    case 'weekly': {
      // Week starting Monday, matching how Indian dairy schedules run.
      const dayOffset = (from.getDay() + 6) % 7;
      const monday = new Date(from.getTime() - dayOffset * 24 * 60 * 60 * 1000);
      return { from: monday, to: new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000) };
    }
    case 'monthly': {
      const first = new Date(from.getFullYear(), from.getMonth(), 1);
      const nextMonth = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      return { from: first, to: nextMonth };
    }
    default:
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown period: ${period}`);
  }

  return { from, to };
};

/**
 * Orders that count toward a settlement.
 *
 * Only **delivered** and **paid** orders count. A pending or cancelled order is
 * not revenue, and an unpaid COD order is not money the platform has received.
 *
 * @param {string} businessId
 * @param {Date} from
 * @param {Date} to
 */
const collectSettleableOrders = async (businessId, from, to) => {
  return DairyOrder.find({
    business: businessId,
    status: 'delivered',
    paymentStatus: 'paid',
    deliveredAt: { $gte: from, $lt: to },
  }).select('orderNo itemTotal depositTotal serviceCharge grandTotal deliveredAt');
};

/**
 * Builds a commission settlement for a partner.
 *
 * @param {Object} param
 * @returns {Promise<Object>} settlement
 */
const createCommissionSettlement = async (param) => {
  const partner = await DairyPartner.findById(param.partnerId);
  if (!partner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Partner not found');
  }
  if (partner.status !== 'active') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Partner is ${partner.status}`);
  }

  const { from, to } = param.from && param.to
    ? { from: new Date(param.from), to: new Date(param.to) }
    : resolvePeriod(param.period || 'monthly', param.reference);

  const existing = await DairySettlement.findOne({
    partner: partner._id,
    from,
    status: { $in: ['draft', 'submitted', 'approved', 'paid'] },
  });
  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A settlement already exists for this period (${existing.settlementNo}, ${existing.status})`
    );
  }

  const orders = await collectSettleableOrders(partner.business, from, to);

  // Read via the getters so figures are in rupees, not paise.
  const grossSales = orders.reduce((sum, o) => sum + Number(o.itemTotal), 0);
  const deliveryCharges = orders.reduce((sum, o) => sum + Number(o.serviceCharge), 0);

  const includeDelivery = partner.commissionBasis === 'product_and_delivery';
  const commissionBase = Number((grossSales + (includeDelivery ? deliveryCharges : 0)).toFixed(2));

  const rate = partner.commissionPercentage || 0;
  const commissionAmount = Number(((commissionBase * rate) / 100).toFixed(2));

  const settlementNo = await nextSettlementNo();
  const settlement = await DairySettlement.create({
    settlementNo,
    settlementType: 'commission',
    partner: partner._id,
    business: partner.business,
    period: param.period || 'monthly',
    from,
    to,
    totals: {
      orderCount: orders.length,
      grossSales,
      deliveryCharges,
      refunds: 0,
      commissionBase,
      ratePercentage: rate,
      commissionAmount,
      royalty: 0,
      joiningFee: 0,
      // Platform owes the partner, so positive.
      netAmount: commissionAmount,
    },
    lineItems: orders.map((o) => ({
      orderNo: o.orderNo,
      orderId: o._id,
      grossSales: Number(o.itemTotal),
      deliveredAt: o.deliveredAt,
    })),
    payoutMethod: partner.payoutMethod,
    status: 'draft',
  });

  return settlement;
};

/**
 * Builds a franchise settlement — the mirror image of the commission path.
 *
 * @param {Object} param
 * @returns {Promise<Object>} settlement
 */
const createFranchiseSettlement = async (param) => {
  const franchise = await DairyFranchise.findById(param.franchiseId);
  if (!franchise) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Franchise not found');
  }
  if (franchise.status !== 'active') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Franchise is ${franchise.status}`);
  }

  const { from, to } = param.from && param.to
    ? { from: new Date(param.from), to: new Date(param.to) }
    : resolvePeriod(param.period || 'monthly', param.reference);

  const existing = await DairySettlement.findOne({
    franchise: franchise._id,
    from,
    status: { $in: ['draft', 'submitted', 'approved', 'paid'] },
  });
  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A settlement already exists for this period (${existing.settlementNo}, ${existing.status})`
    );
  }

  const orders = await collectSettleableOrders(franchise.business, from, to);

  const grossSales = orders.reduce((sum, o) => sum + Number(o.itemTotal), 0);
  const deliveryCharges = orders.reduce((sum, o) => sum + Number(o.serviceCharge), 0);

  const includeDelivery = franchise.revenueShareBasis === 'product_and_delivery';
  const shareBase = Number((grossSales + (includeDelivery ? deliveryCharges : 0)).toFixed(2));

  const rate = franchise.revenueSharePercentage || 0;
  const shareAmount = Number(((shareBase * rate) / 100).toFixed(2));

  // Royalty is a flat fee, not a proportion, so it is not scaled by the period.
  const royalty = Number(franchise.royalty || 0);

  // The joining fee is charged once, in the period the agreement starts.
  const isFirstPeriod =
    new Date(franchise.agreement.startDate) >= from && new Date(franchise.agreement.startDate) < to;
  const joiningFee = isFirstPeriod ? Number(franchise.joiningFee || 0) : 0;

  // Franchisee owes the platform, so the amounts subtract.
  const netAmount = Number((-(shareAmount + royalty + joiningFee)).toFixed(2));

  const settlementNo = await nextSettlementNo();
  const settlement = await DairySettlement.create({
    settlementNo,
    settlementType: 'franchise',
    franchise: franchise._id,
    business: franchise.business,
    period: param.period || 'monthly',
    from,
    to,
    totals: {
      orderCount: orders.length,
      grossSales,
      deliveryCharges,
      refunds: 0,
      commissionBase: shareBase,
      ratePercentage: rate,
      commissionAmount: shareAmount,
      royalty,
      joiningFee,
      netAmount,
    },
    lineItems: orders.map((o) => ({
      orderNo: o.orderNo,
      orderId: o._id,
      grossSales: Number(o.itemTotal),
      deliveredAt: o.deliveredAt,
    })),
    payoutMethod: 'wallet',
    status: 'draft',
  });

  return settlement;
};

const assertTransition = (from, to) => {
  const allowed = {
    draft: ['submitted', 'void'],
    submitted: ['approved', 'draft', 'disputed', 'void'],
    approved: ['paid', 'disputed', 'void'],
    disputed: ['approved', 'draft', 'void'],
    paid: [],
    void: [],
  }[from] || [];

  if (!allowed.includes(to)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Illegal settlement transition: ${from} -> ${to}. Allowed from ${from}: ${allowed.join(', ') || 'none'}`
    );
  }
};

/**
 * Advances a settlement through its approval flow.
 *
 * `approved` and `paid` both **lock** the document: a settlement that has been
 * approved is a financial statement, and a later refund must not silently restate
 * it. Disputes are handled by voiding and reissuing, which is auditable.
 */
const updateSettlementStatus = async (settlementId, toStatus, param) => {
  const settlement = await DairySettlement.findById(settlementId);
  if (!settlement) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const from = settlement.status;
  if (from === toStatus) {
    return settlement;
  }
  assertTransition(from, toStatus);

  settlement.status = toStatus;
  if (toStatus === 'approved') {
    settlement.approvedAt = new Date();
    settlement.approvedBy = param.actor;
  }
  if (toStatus === 'disputed') {
    settlement.dispute = {
      raisedAt: new Date(),
      reason: param.reason,
    };
  }
  if (param.notes) {
    settlement.notes = param.notes;
  }
  await settlement.save();

  return settlement;
};

/**
 * Pays an approved settlement.
 *
 * Positive `netAmount` credits the counterparty's wallet. Negative debits it —
 * which is what a franchise owes the platform. A partner without enough balance
 * cannot be debited, so a franchise shortfall is surfaced rather than silently
 * left unpaid.
 */
const paySettlement = async (settlementId, param) => {
  const settlement = await DairySettlement.findById(settlementId);
  if (!settlement) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (settlement.status !== 'approved') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Only an approved settlement can be paid (this is ${settlement.status})`);
  }

  const holderId =
    settlement.settlementType === 'franchise'
      ? (await DairyFranchise.findById(settlement.franchise)).operator
      : (await DairyPartner.findById(settlement.partner)).user;

  const wallet = await Wallet.findOne({ holderId });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Counterparty wallet not found');
  }

  const amount = Number(settlement.totals.netAmount);

  if (amount < 0 && wallet.balance < Math.abs(amount)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Counterparty owes ₹${Math.abs(amount)} but holds only ₹${wallet.balance}. Collect before settling.`
    );
  }

  wallet.balance = Number((wallet.balance + amount).toFixed(2));
  wallet.meta = [
    ...(wallet.meta || []),
    {
      description:
        amount >= 0
          ? `Dairy settlement #${settlement.settlementNo} credit`
          : `Dairy settlement #${settlement.settlementNo} debit`,
      amount,
      date: new Date(),
    },
  ];
  await wallet.save();

  await transactionService.saveTransation({
    payableId: holderId,
    walletId: `${wallet._id}`,
    type: amount >= 0 ? 'dairy_settlement_credit' : 'dairy_settlement_debit',
    amount: `${Math.abs(amount)}`,
    confirmed: true,
    meta: [
      {
        reason: `${settlement.settlementType} settlement #${settlement.settlementNo}`,
        settlement: `${settlement._id}`,
      },
    ],
    status: true,
  });

  settlement.status = 'paid';
  settlement.paidAt = new Date();
  settlement.payoutReference = param.reference;
  await settlement.save();

  return settlement;
};

/**
 * Preview for an outlet: what a settlement would look like, without writing.
 *
 * Used by the partner app so a statement can be shown before the platform closes
 * the period.
 */
const previewSettlement = async (param) => {
  const { from, to } = param.from && param.to
    ? { from: new Date(param.from), to: new Date(param.to) }
    : resolvePeriod(param.period || 'monthly', param.reference);

  const agreement = param.partnerId
    ? await DairyPartner.findById(param.partnerId)
    : await DairyFranchise.findById(param.franchiseId);

  if (!agreement) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      param.partnerId ? 'Partner agreement not found' : 'Franchise agreement not found'
    );
  }

  const orders = await collectSettleableOrders(agreement.business, from, to);
  const grossSales = orders.reduce((sum, o) => sum + Number(o.itemTotal), 0);
  const deliveryCharges = orders.reduce((sum, o) => sum + Number(o.serviceCharge), 0);

  const isPartner = !!param.partnerId;
  const basis = isPartner ? agreement.commissionBasis : agreement.revenueShareBasis;
  const rate = isPartner ? agreement.commissionPercentage : agreement.revenueSharePercentage;
  const includeDelivery = basis === 'product_and_delivery';
  const base = Number((grossSales + (includeDelivery ? deliveryCharges : 0)).toFixed(2));
  const computed = Number(((base * rate) / 100).toFixed(2));

  return {
    period: param.period || 'monthly',
    from,
    to,
    orderCount: orders.length,
    grossSales,
    deliveryCharges,
    includesDelivery: includeDelivery,
    commissionBase: base,
    ratePercentage: rate,
    amount: isPartner ? computed : -computed,
  };
};

const getSettlement = async (settlementId) => {
  const settlement = await DairySettlement.findById(settlementId)
    .populate('partner', 'name partnerCode commissionPercentage commissionBasis')
    .populate('franchise', 'name franchiseCode revenueSharePercentage')
    .populate('business', 'name businessModel');

  if (!settlement) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return settlement;
};

const listSettlements = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = {};
  if (options.business) query.business = options.business;
  if (options.partner) query.partner = options.partner;
  if (options.franchise) query.franchise = options.franchise;
  if (options.status) query.status = options.status;
  if (options.settlementType) query.settlementType = options.settlementType;

  const [settlements, totalResults] = await Promise.all([
    DairySettlement.find(query)
      .populate('partner', 'name partnerCode')
      .populate('franchise', 'name franchiseCode')
      .populate('business', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairySettlement.countDocuments(query),
  ]);

  return { settlements, totalResults, page, limit };
};

/**
 * Platform-wide totals for the admin finance dashboard.
 */
const getSettlementSummary = async (options) => {
  const match = {};
  if (options.from) match.from = { $gte: new Date(options.from) };
  if (options.to) match.from = { ...(match.from || {}), $lt: new Date(options.to) };
  if (options.status) match.status = options.status;

  const rows = await DairySettlement.aggregate([
    { $match: match },
    {
      $group: {
        _id: { type: '$settlementType', status: '$status' },
        count: { $sum: 1 },
        net: { $sum: '$totals.netAmount' },
      },
    },
  ]);

  const byType = {};
  for (const row of rows) {
    const key = row._id.type;
    byType[key] = byType[key] || {};
    byType[key][row._id.status] = {
      count: row.count,
      // Raw paise summed in the pipeline, converted for display.
      net: Number((row.net / 100).toFixed(2)),
    };
  }

  return { byType };
};

module.exports = {
  resolvePeriod,
  collectSettleableOrders,
  createCommissionSettlement,
  createFranchiseSettlement,
  updateSettlementStatus,
  paySettlement,
  previewSettlement,
  getSettlement,
  listSettlements,
  getSettlementSummary,
  assertTransition,
};