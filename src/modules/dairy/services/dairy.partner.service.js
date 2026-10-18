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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const {
  DairyPartner,
  DairyFranchise,
  Business,
  User,
  DairyOrder,
  DairySubscription,
  DairyDriver,
  DairySettlement,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');

/**
 * Partner and franchise agreements.
 *
 * The onboarding side, as opposed to `dairy.settlement.service` which is the money
 * side. Kept separate because the two change for different reasons and are owned
 * by different people: an operator negotiates an agreement once, while a
 * settlement is produced every period.
 */

const createPartner = async (param) => {
  const business = await Business.findById(param.business);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }

  const existing = await DairyPartner.findOne({
    $or: [{ business: param.business }, { partnerCode: param.partnerCode }],
  });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This outlet already has a partner agreement, or the code is taken');
  }

  if (param.commissionPercentage < 0 || param.commissionPercentage > 100) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Commission must be between 0 and 100 percent');
  }

  const partner = await DairyPartner.create({ ...param, status: 'active' });

  // Reflect the commercial model on the outlet so catalogue and routing code
  // does not have to join the agreement to know how the outlet trades.
  business.businessModel = 'commission_partner';
  await business.save();

  return partner;
};

const listPartners = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = {};
  if (options.status) query.status = options.status;
  if (options.business) query.business = options.business;

  const [partners, totalResults] = await Promise.all([
    DairyPartner.find(query)
      // `city` and `locality` are included because an operator looking at an outlet
      // needs to see where it is: an outlet with no location can never be dispatched
      // to, and that is not visible from the partner record alone.
      .populate('business', 'name businessModel verified city locality')
      .populate('business.city', 'name')
      .populate('business.locality', 'name')
      .populate('user', 'firstName lastName mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyPartner.countDocuments(query),
  ]);

  return { partners, totalResults, page, limit };
};

/**
 * Renegotiates the commission rate.
 *
 * Applies from `effectiveFrom`, never retrospectively: settlements already
 * approved are financial statements and must not move.
 */
const updatePartnerTerms = async (partnerId, param) => {
  const partner = await DairyPartner.findById(partnerId);
  if (!partner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  if (param.commissionPercentage !== undefined) {
    if (param.commissionPercentage < 0 || param.commissionPercentage > 100) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Commission must be between 0 and 100 percent');
    }
    partner.commissionPercentage = param.commissionPercentage;
  }
  if (param.commissionBasis) {
    partner.commissionBasis = param.commissionBasis;
  }
  if (param.driverPayoutMode) {
    partner.driverPayoutMode = param.driverPayoutMode;
  }
  if (param.payoutMethod) {
    partner.payoutMethod = param.payoutMethod;
  }
  if (param.payoutDetails) {
    partner.payoutDetails = { ...partner.payoutDetails, ...param.payoutDetails };
  }
  if (param.agreement) {
    partner.agreement = { ...partner.agreement.toObject(), ...param.agreement };
  }

  await partner.save();
  return partner;
};

const setPartnerStatus = async (partnerId, status, param) => {
  const partner = await DairyPartner.findById(partnerId);
  if (!partner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const allowed = {
    pending: ['active', 'terminated'],
    active: ['suspended', 'terminated'],
    suspended: ['active', 'terminated'],
    terminated: [],
  }[partner.status] || [];

  if (!allowed.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot move a ${partner.status} partner to ${status}`
    );
  }

  partner.status = status;
  if (status === 'terminated') {
    partner.terminatedAt = new Date();
    // The reason is kept on the agreement, not just logged: a terminated
    // relationship is exactly what gets disputed later.
    partner.terminationReason = param.reason;
  }
  await partner.save();

  return partner;
};

// //// Franchise ////

const createFranchise = async (param) => {
  const business = await Business.findById(param.business);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }

  const operator = await User.findById(param.operator);
  if (!operator) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Operator not found');
  }

  const existing = await DairyFranchise.findOne({
    $or: [{ business: param.business }, { franchiseCode: param.franchiseCode }],
  });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This outlet already has a franchise agreement, or the code is taken');
  }

  if (param.revenueSharePercentage < 0 || param.revenueSharePercentage > 100) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Revenue share must be between 0 and 100 percent');
  }

  // Territory overlap check. Two franchises covering the same locality would
  // make settlement attribution ambiguous.
  if (param.territory && Array.isArray(param.territory.localities) && param.territory.localities.length > 0) {
    const clash = await DairyFranchise.findOne({
      _id: { $ne: param.franchiseId },
      status: 'active',
      'territory.localities': { $in: param.territory.localities },
    });
    if (clash) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Territory overlaps active franchise ${clash.franchiseCode}`
      );
    }
  }

  const franchise = await DairyFranchise.create({
    ...param,
    // A franchisee on a full supply model has no procurement screens.
    procurementEnabled: param.procurementEnabled === true || param.supplyModel === 'local_procurement',
    status: 'active',
  });

  business.businessModel = 'franchise';
  await business.save();

  return franchise;
};

const listFranchises = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = {};
  if (options.status) query.status = options.status;
  if (options.business) query.business = options.business;
  if (options.city) query['territory.city'] = options.city;

  const [franchises, totalResults] = await Promise.all([
    DairyFranchise.find(query)
      .populate('business', 'name businessModel verified')
      .populate('operator', 'firstName lastName mobile')
      .populate('territory.city', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyFranchise.countDocuments(query),
  ]);

  return { franchises, totalResults, page, limit };
};

const setFranchiseStatus = async (franchiseId, status, param) => {
  const franchise = await DairyFranchise.findById(franchiseId);
  if (!franchise) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const allowed = {
    pending: ['active', 'terminated'],
    active: ['suspended', 'expired', 'terminated'],
    suspended: ['active', 'terminated'],
    expired: ['active', 'terminated'],
    terminated: [],
  }[franchise.status] || [];

  if (!allowed.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot move a ${franchise.status} franchise to ${status}`
    );
  }

  franchise.status = status;
  if (['terminated', 'suspended'].includes(status) && param.reason) {
    franchise.statusReason = param.reason;
  }
  await franchise.save();

  return franchise;
};

/**
 * Check whether an outlet location falls inside a franchise territory.
 *
 * Used to decide which partner a new order belongs to. Locality matching is the
 * fast path; polygon containment is the precise one.
 */
// //// Partner-facing outlet views ////
//
// Everything below is read by the outlet's own partner, from the app. The outlet
// is never a parameter: it arrives as `businessId` from `resolveOutlet`, which
// reads it off the access token. A partner sees their own outlet and nothing
// else, because there is no code path here that could scope a query elsewhere.

/**
 * Every customer who has bought from this outlet.
 *
 * Derived by aggregating orders rather than by holding a customer list: the
 * customer app already owns the customer record, and a separate roster would
 * drift from who actually ordered. Someone who only holds a subscription still
 * belongs on this list, so both collections are unioned.
 *
 * A partner needs this to answer "who buys from me", which is also what a
 * subscription list cannot tell them - plans are per-customer but the partner
 * wants one row per person.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options search, limit, page
 * @returns {Promise<Object>}
 */
const listOutletCustomers = async (businessId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  // Matched against the populated name, since the query below cannot search a
  // populated field. The name filter is applied after the aggregation so the
  // search and the paging stay consistent with each other.
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const orderRows = await DairyOrder.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(businessId) } },
    {
      $group: {
        _id: '$user',
        orderCount: { $sum: 1 },
        // Top-level, not `totals.*` - these fields sit directly on the order.
        lifetimeValue: { $sum: '$grandTotal' },
        lastOrderAt: { $max: '$createdAt' },
        receiverName: { $last: '$receiverName' },
        receiverContact: { $last: '$receiverContact' },
        address: { $last: '$address' },
      },
    },
  ]);

  const subscriptionRows = await DairySubscription.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(businessId) } },
    {
      $group: {
        _id: '$user',
        subscriptionCount: { $sum: 1 },
        activeSubscriptions: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
        },
      },
    },
  ]);

  const subscriptionByUser = new Map(
    subscriptionRows.map((row) => [String(row._id), row])
  );

  const merged = orderRows.map((row) => {
    const subs = subscriptionByUser.get(String(row._id));
    subscriptionByUser.delete(String(row._id));
    return {
      user: row._id,
      orderCount: row.orderCount,
      // Paise holds rupees; the raw field is paise. Divided here so the endpoint
      // never reports a lifetime value a hundred times too large.
      lifetimeValue: Number((row.lifetimeValue / 100).toFixed(2)),
      subscriptionCount: subs ? subs.subscriptionCount : 0,
      activeSubscriptions: subs ? subs.activeSubscriptions : 0,
      lastOrderAt: row.lastOrderAt,
      receiverName: row.receiverName,
      receiverContact: row.receiverContact,
      address: row.address,
    };
  });

  // Subscription-only customers: they have never placed a one-time order, so they
  // appear in no order row above.
  for (const [userId, row] of subscriptionByUser) {
    merged.push({
      user: row._id,
      orderCount: 0,
      lifetimeValue: 0,
      subscriptionCount: row.subscriptionCount,
      activeSubscriptions: row.activeSubscriptions,
      lastOrderAt: null,
      receiverName: null,
      receiverContact: null,
      address: null,
    });
    void userId;
  }

  const populated = await User.find({
    _id: { $in: merged.map((row) => row.user) },
  }).select('firstName lastName mobile countryCode email status');

  const userById = new Map(populated.map((user) => [String(user._id), user]));

  let customers = merged.map((row) => {
    const user = userById.get(String(row.user));
    return {
      ...row,
      firstName: user ? user.firstName : null,
      lastName: user ? user.lastName : null,
      mobile: user ? user.mobile : null,
      countryCode: user ? user.countryCode : null,
      email: user ? user.email : null,
    };
  });

  // Sorted by recency first, then name, so the search below cannot reorder the
  // page the client asked for.
  customers.sort((a, b) => {
    const left = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
    const right = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
    return right - left;
  });

  if (options.search) {
    const needle = new RegExp(escapeRegExp(options.search), 'i');
    customers = customers.filter((row) =>
      needle.test(
        [row.firstName, row.lastName, row.mobile, row.receiverName, row.receiverContact]
          .filter(Boolean)
          .join(' ')
      )
    );
  }

  const totalResults = customers.length;

  return { customers: customers.slice(skip, skip + limit), totalResults, page, limit };
};

/**
 * The outlet's own riders.
 *
 * Only riders whose `business` is this outlet. Platform-pool riders have
 * `business: null` and belong to whoever dispatches them, so they are excluded
 * rather than shown as unassigned.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options status, search, limit, page
 * @returns {Promise<Object>}
 */
const listOutletDrivers = async (businessId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: new mongoose.Types.ObjectId(businessId) };
  if (options.status !== undefined) {
    query.status = options.status === 'true';
  }

  const [drivers, totalResults] = await Promise.all([
    DairyDriver.find(query)
      .populate('userId', 'firstName lastName mobile countryCode email status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyDriver.countDocuments(query),
  ]);

  let riders = drivers;

  if (options.search) {
    const needle = new RegExp(String(options.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    riders = drivers.filter((driver) => {
      const user = driver.userId;
      if (!user) return false;
      return needle.test(
        [user.firstName, user.lastName, user.mobile, user.email].filter(Boolean).join(' ')
      );
    });
  }

  return { drivers: riders, totalResults, page, limit };
};

/**
 * What the outlet has earned: the platform's commission on its sales.
 *
 * Read from settled orders rather than from `DairySettlement`, because the
 * settlement only exists once a period has been closed and this figure is
 * needed before that. A partner asking "what did I make this month" should not
 * have to wait for the finance run.
 *
 * Only `delivered` + `paid` orders count, matching
 * `settlement.collectSettleableOrders` - otherwise the two would disagree and
 * the partner would be shown a number the settlement later contradicts.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options from, to
 * @returns {Promise<Object>}
 */
const getOutletEarnings = async (businessId, options = {}) => {
  const match = {
    business: new mongoose.Types.ObjectId(businessId),
    status: 'delivered',
    paymentStatus: 'paid',
  };

  if (options.from || options.to) {
    match.deliveredAt = {};
    if (options.from) match.deliveredAt.$gte = new Date(options.from);
    if (options.to) match.deliveredAt.$lt = new Date(options.to);
  }

  const [rows] = await DairyOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        orderCount: { $sum: 1 },
        // Raw paise out of Mongo; divided once, here. The fields are top-level
        // on the order, not nested under `totals`.
        grossSalesPaise: { $sum: '$itemTotal' },
        deliveryPaise: { $sum: '$serviceCharge' },
        discountPaise: { $sum: '$discountAmount' },
      },
    },
  ]);

  const partner = await DairyPartner.findOne({ business: businessId });

  const grossSales = rows ? Number((rows.grossSalesPaise / 100).toFixed(2)) : 0;
  const deliveryCharges = rows ? Number((rows.deliveryPaise / 100).toFixed(2)) : 0;
  const discounts = rows ? Number((rows.discountPaise / 100).toFixed(2)) : 0;

  // Same basis and rate the settlement engine uses, so the preview and the
  // statement cannot diverge. An outlet with no agreement yet reports zero
  // commission rather than guessing a rate.
  const rate = partner ? partner.commissionPercentage || 0 : 0;
  const includeDelivery = partner ? partner.commissionBasis === 'product_and_delivery' : false;
  const commissionBase = Number((grossSales + (includeDelivery ? deliveryCharges : 0)).toFixed(2));
  const commissionAmount = Number(((commissionBase * rate) / 100).toFixed(2));

  return {
    period: {
      from: options.from ? new Date(options.from) : null,
      to: options.to ? new Date(options.to) : null,
    },
    orderCount: rows ? rows.orderCount : 0,
    grossSales,
    deliveryCharges,
    discounts,
    commissionBase,
    ratePercentage: rate,
    commissionBasis: includeDelivery ? 'product_and_delivery' : 'product_only',
    // The platform owes the partner this, so positive.
    commissionAmount,
    // Gross less the platform's cut is what the outlet keeps.
    netEarnings: Number((grossSales - commissionAmount).toFixed(2)),
    hasAgreement: Boolean(partner),
  };
};

/**
 * Settlements already closed for this outlet.
 *
 * The counterpart to `getOutletEarnings`: the earnings figure is a live preview,
 * this is what has actually been settled and paid.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options status, limit, page
 * @returns {Promise<Object>}
 */
const listOutletSettlements = async (businessId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: new mongoose.Types.ObjectId(businessId) };
  if (options.status) {
    query.status = options.status;
  }

  const [settlements, totalResults] = await Promise.all([
    DairySettlement.find(query)
      .select('settlementNo settlementType period from to totals status paidAt payoutReference')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairySettlement.countDocuments(query),
  ]);

  return { settlements, totalResults, page, limit };
};

const findTerritoryOwner = async (cityId, localityId) => {
  if (!cityId && !localityId) return null;
  return DairyFranchise.findOne({
    status: 'active',
    ...(localityId ? { 'territory.localities': localityId } : { 'territory.city': cityId }),
  });
};

/**
 * Candidate franchise operators for the admin picker.
 *
 * `DairyFranchise.operator` references a `User`, but nothing could list the
 * candidates — the only user search in the platform (`findUserWithName`) filters to
 * `role: 'user'`, which is customers. So the create screen faced a choice between a
 * raw id box and this.
 *
 * Restricted to `dairyPartner`, the only self-registerable dairy role that would
 * plausibly operate a franchise. This is a convenience list, not a permission: the
 * API still validates that the id resolves to a real user.
 *
 * @param {Object} options search, limit, page
 * @returns {Promise<Object>} results and totalResults
 */
const listFranchiseOperators = async (options = {}) => {
  const query = { role: 'dairyPartner' };

  if (options.search) {
    // Escaped: operator input goes straight into a RegExp.
    const term = new RegExp(
      String(options.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );
    query.$or = [{ firstName: term }, { lastName: term }, { email: term }];
  }

  const page = Math.max(0, Number(options.page) || 0);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));

  const [rows, totalResults] = await Promise.all([
    User.find(query)
      .select('firstName lastName email mobile')
      .sort({ firstName: 1 })
      .skip(page * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
  ]);

  return { results: rows, totalResults };
};

module.exports = {
  createPartner,
  listPartners,
  updatePartnerTerms,
  setPartnerStatus,
  createFranchise,
  listFranchises,
  setFranchiseStatus,
  listFranchiseOperators,
  findTerritoryOwner,
  listOutletCustomers,
  listOutletDrivers,
  getOutletEarnings,
  listOutletSettlements,
};