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
const ApiError = require('../../../utils/ApiError');

/**
 * The admin read surface for records that have no outlet-scoped admin route yet.
 *
 * ## Why this exists instead of loosening the partner services
 *
 * Every list in `stores.order.service`, `stores.driver.service` and friends requires an
 * `outlet` (or `chain`) because BR-38 makes tenancy mandatory for a partner. Making
 * `outlet` optional to serve the admin panel would delete that guarantee from the one
 * place it is enforced — a route that forgets the filter would return the whole platform's
 * orders to a partner. So the admin reads are declared here, cross-tenant by
 * construction, and the partner services keep their floor.
 *
 * ## Filters are optional, never required
 *
 * Every filter here is genuinely optional and an unfiltered call returns the whole
 * platform, which is correct for an admin and dangerous for anyone else — hence this file
 * is reachable only through routes guarded by an admin-only right.
 */

const paginate = async (Model, { page = 1, limit = 20, filter = {}, sort = { createdAt: -1 }, populate } = {}) => {
  let query = Model.find(filter).sort(sort);

  if (populate) {
    // `populate` arrives as an array of { path, select } so the caller never has to build
    // a query object inline, which is where the populate/lean combination usually breaks.
    populate.forEach((p) => {
      query = query.populate(p.path, p.select);
    });
  }

  // lean WITH getters: moneyField-backed amounts (notably StoreSubscription)
  // are stored as paise and must read back as rupees. Plain-Number fields
  // (orders, settlements, refunds) carry no getters and are unaffected, so
  // this is safe across every list in this file. A bare .lean() here was a
  // silent 100x display bug on every paise-stored column.
  const [results, totalResults] = await Promise.all([
    query.skip((page - 1) * limit).limit(limit).lean({ getters: true }),
    Model.countDocuments(filter),
  ]);

  return { results, totalResults, page, limit, totalPages: Math.ceil(totalResults / limit) || 1 };
};

/** A case-insensitive `$or` over the named fields, for the search box. */
const textFilter = (search, fields) => {
  if (!search) return null;
  const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return fields.map((f) => ({ [f]: rx }));
};

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------

const listOrders = async ({ page, limit, search, lifecycle, outlet, chain, from, to }) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const filter = {};

  if (lifecycle) filter.lifecycle = { $in: [].concat(lifecycle) };
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const or = textFilter(search, ['orderNo']);
  if (or) filter.$or = or;

  return paginate(StoreOrder, {
    page,
    limit,
    filter,
    sort: { createdAt: -1 },
    populate: [
      { path: 'outlet', select: 'name outletCode' },
      { path: 'chain', select: 'name slug' },
      { path: 'customer', select: 'name mobile' },
    ],
  });
};

/**
 * One order, for the admin detail screen.
 *
 * Cross-tenant by construction — an admin reviewing a dispute needs the customer's order
 * regardless of which chain placed it. The partner path stays outlet-scoped.
 */
const getOrder = async (orderId) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = await StoreOrder.findById(orderId)
    .populate('outlet', 'name outletCode address')
    .populate('chain', 'name slug')
    .populate('customer', 'name mobile email')
    .populate('delivery')
    .populate('cancellation')
    .lean();

  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  return order;
};

// ---------------------------------------------------------------------------
// drivers
// ---------------------------------------------------------------------------

const listDrivers = async ({ page, limit, search, status, outlet, chain }) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;

  const or = textFilter(search, ['driverCode']);
  if (or) filter.$or = or;

  return paginate(StoreDriver, {
    page,
    limit,
    filter,
    populate: [
      { path: 'outlet', select: 'name outletCode' },
      { path: 'user', select: 'name mobile email' },
    ],
  });
};

// ---------------------------------------------------------------------------
// returns, exchanges, warranties
// ---------------------------------------------------------------------------

const listReturns = async ({ page, limit, status, outlet, chain, kind }) => {
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;

  const populate = [
    { path: 'outlet', select: 'name outletCode' },
    { path: 'customer', select: 'name mobile' },
    { path: 'order', select: 'orderNo grandTotal' },
  ];

  if (kind === 'exchange') {
    return paginate(mongoose.model('StoreExchangeRequest'), { page, limit, filter, populate });
  }
  if (kind === 'warranty') {
    return paginate(mongoose.model('StoreWarrantyRequest'), {
      page,
      limit,
      filter,
      populate: [
        { path: 'outlet', select: 'name outletCode' },
        { path: 'customer', select: 'name mobile' },
        { path: 'order', select: 'orderNo' },
      ],
    });
  }
  return paginate(mongoose.model('StoreReturnRequest'), { page, limit, filter, populate });
};

// ---------------------------------------------------------------------------
// promotions — admin type gating (BR-22)
// ---------------------------------------------------------------------------

/**
 * Cancellations — admin read (BR-28, §6.10).
 *
 * Cross-tenant by design: an admin investigating a dispute needs the
 * cancellation regardless of which chain it belongs to. Cancellations are
 * created by the order cancel flow (partner side), not from this screen —
 * a hand-written admin cancellation would skip the order's lifecycle
 * guard and could violate BR-28 (component refund ceiling).
 */
const listCancellations = async ({ page, limit, status, outlet, chain, from, to }) => {
  const StoreCancellation = mongoose.model('StoreCancellation');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  return paginate(StoreCancellation, {
    page,
    limit,
    filter,
    populate: [
      { path: 'outlet', select: 'name outletCode' },
      { path: 'chain', select: 'name slug' },
      { path: 'customer', select: 'name mobile' },
      { path: 'order', select: 'orderNo grandTotal' },
    ],
  });
};

/**
 * List promotions with the admin-only view of approval state.
 *
 * BR-22 makes promotion types Admin-gated: the chain's `settings.allowedPromotionTypes`
 * says which types it MAY create, and the admin approves or rejects the ones that need it.
 * That second half has no home anywhere else, so it is here.
 */
const listPromotions = async ({ page, limit, search, status, chain, approvalStatus }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (chain) filter.chain = chain;

  const or = textFilter(search, ['name', 'code']);
  if (or) filter.$or = or;

  // `approval.status` lives on the promotion only when the chain required approval, so it
  // is a sparse match rather than a nested equality that would exclude every promotion
  // created under a chain with approval switched off.
  if (approvalStatus) filter['approval.status'] = approvalStatus;

  return paginate(StorePromotion, {
    page,
    limit,
    filter,
    populate: [
      { path: 'chain', select: 'name slug' },
      { path: 'outlet', select: 'name outletCode' },
    ],
  });
};

/**
 * Approve or reject a promotion.
 *
 * The type check is re-read from the CHAIN here rather than trusted from the request,
 * because a client can post any `type` string. A chain that is not permitted to create
 * `buy_x_get_y` cannot have one approved even if it somehow submitted one.
 */
const moderatePromotion = async (promotionId, { status, by, note }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const StoreChain = mongoose.model('StoreChain');

  const promotion = await StorePromotion.findById(promotionId);
  if (!promotion) throw new ApiError(httpStatus.NOT_FOUND, 'Promotion not found');

  if (status === 'approved' && promotion.chain) {
    const chain = await StoreChain.findById(promotion.chain);
    const allowed = chain && chain.settings ? chain.settings.allowedPromotionTypes : null;
    // A null list means the chain has never been gated, so nothing is refused. Only an
    // explicit list that excludes the type blocks approval.
    if (Array.isArray(allowed) && allowed.length && !allowed.includes(promotion.type)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Promotion type '${promotion.type}' is not permitted for this chain`
      );
    }
  }

  promotion.approval = { status, by, at: new Date(), note };
  await promotion.save();
  return promotion;
};

// ---------------------------------------------------------------------------
// reviews and complaints
// ---------------------------------------------------------------------------

const listReviews = async ({ page, limit, status, outlet, chain, search }) => {
  const StoreReview = mongoose.model('StoreReview');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;

  const or = textFilter(search, ['comment', 'title']);
  if (or) filter.$or = or;

  return paginate(StoreReview, {
    page,
    limit,
    filter,
    populate: [
      { path: 'outlet', select: 'name outletCode' },
      { path: 'customer', select: 'name mobile' },
    ],
  });
};

const listComplaints = async ({ page, limit, status, outlet, chain, search, priority }) => {
  const StoreComplaint = mongoose.model('StoreComplaint');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;
  if (priority) filter.priority = priority;

  const or = textFilter(search, ['subject', 'description']);
  if (or) filter.$or = or;

  return paginate(StoreComplaint, {
    page,
    limit,
    filter,
    populate: [
      { path: 'outlet', select: 'name outletCode' },
      { path: 'customer', select: 'name mobile' },
    ],
  });
};

/**
 * Moderate a complaint.
 *
 * `escalated` is terminal from the admin's perspective — it exists so an operator hands a
 * case to whoever can actually settle it rather than closing it to make the queue shorter.
 */
const moderateComplaint = async (complaintId, { status, resolution, resolutionNotes, by }) => {
  const StoreComplaint = mongoose.model('StoreComplaint');
  const complaint = await StoreComplaint.findById(complaintId);
  if (!complaint) throw new ApiError(httpStatus.NOT_FOUND, 'Complaint not found');

  if (status === 'resolved') {
    if (!resolution) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'A resolution is required to close a complaint');
    }
    complaint.resolvedAt = new Date();
    complaint.resolvedBy = by;
  }
  if (status === 'escalated') {
    complaint.escalatedAt = new Date();
    complaint.escalatedTo = by;
  }

  complaint.status = status;
  if (resolution) complaint.resolution = resolution;
  if (resolutionNotes) complaint.resolutionNotes = resolutionNotes;

  await complaint.save();
  return complaint;
};

// ---------------------------------------------------------------------------
// settlements, refunds, subscriptions
// ---------------------------------------------------------------------------

const listSettlements = async ({ page, limit, status, counterparty, store, vertical }) => {
  const Settlement = mongoose.model('Settlement');
  const filter = {};
  if (vertical) filter.vertical = vertical;
  if (status) filter.status = { $in: [].concat(status) };
  if (counterparty) filter.counterparty = counterparty;
  if (store) filter.store = store;

  return paginate(Settlement, {
    page,
    limit,
    filter,
    populate: [
      { path: 'counterparty', select: 'name' },
      { path: 'store', select: 'name outletCode' },
    ],
  });
};

const listRefunds = async ({ page, limit, status, outlet, chain, order }) => {
  const StoreRefund = mongoose.model('StoreRefund');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;
  if (order) filter.order = order;

  return paginate(StoreRefund, {
    page,
    limit,
    filter,
    populate: [
      { path: 'outlet', select: 'name outletCode' },
      { path: 'customer', select: 'name mobile' },
      { path: 'order', select: 'orderNo grandTotal' },
    ],
  });
};

const listSubscriptionPayments = async ({ page, limit, status, chain, subscription }) => {
  const StoreSubscriptionPayment = mongoose.model('StoreSubscriptionPayment');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (chain) filter.chain = chain;
  if (subscription) filter.subscription = subscription;

  return paginate(StoreSubscriptionPayment, {
    page,
    limit,
    filter,
    populate: [{ path: 'chain', select: 'name slug' }],
  });
};

const listSubscriptions = async ({ page, limit, status, chain, business }) => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (chain) filter.chain = chain;
  if (business) filter.business = business;

  return paginate(StoreSubscription, {
    page,
    limit,
    filter,
    sort: { createdAt: -1 },
    populate: [{ path: 'chain', select: 'name slug outletCount' }],
  });
};

module.exports = {
  paginate,
  textFilter,
  listOrders,
  getOrder,
  listDrivers,
  listReturns,
  listCancellations,
  listPromotions,
  moderatePromotion,
  listReviews,
  listComplaints,
  moderateComplaint,
  listSettlements,
  listRefunds,
  listSubscriptionPayments,
  listSubscriptions,
};