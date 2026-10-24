/**
 * LocalWala �?" Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
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

/**
 * Resolve a typed code within the chain/outlet it is redeemable at.
 *
 * A chain-wide coupon and an outlet coupon are both valid here; a coupon belonging to a
 * different outlet is not. The scope is the same as a promotion's, but the ledger is
 * separate so the order can honestly record which of the two was used.
 */
const validateCoupon = async ({ chain, outlet, code, cartAmount, customerId }) => {
  const StoreCoupon = mongoose.model('StoreCoupon');
  const now = new Date();

  const scope = chain
    ? { chain, $or: [{ outlet }, { outlet: null }] }
    : { outlet };

  const coupon = await StoreCoupon.findOne({
    ...scope,
    code: String(code || '').toUpperCase(),
    status: 'active',
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  }).sort({ outlet: -1 });

  if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, 'Invalid or expired coupon code');
  if (coupon.minOrderAmount > cartAmount) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Minimum order amount for this coupon is ${coupon.minOrderAmount}`);
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw new ApiError(httpStatus.CONFLICT, 'Coupon usage limit exceeded');
  }

  if (coupon.perCustomerLimit > 0 && customerId) {
    const StoreOrder = mongoose.model('StoreOrder');
    const redemptions = await StoreOrder.countDocuments({
      customer: customerId,
      'coupon.coupon': coupon._id,
      lifecycle: { $nin: ['cancelled', 'payment_failed', 'rejected'] },
    });
    if (redemptions >= coupon.perCustomerLimit) {
      throw new ApiError(httpStatus.CONFLICT, 'You have already used this coupon');
    }
  }

  return coupon;
};

const calculateDiscount = (coupon, cartAmount) => {
  if (!coupon) return 0;
  switch (coupon.type) {
    case 'percent_off': {
      let discount = Math.round((cartAmount * coupon.value) / 100);
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
      return Math.min(discount, cartAmount);
    }
    case 'fixed_off':
      return Math.min(coupon.value, cartAmount);
    case 'free_delivery':
      return 0;
    default:
      return 0;
  }
};

const applyCoupon = async (couponId) => {
  const StoreCoupon = mongoose.model('StoreCoupon');
  const coupon = await StoreCoupon.findByIdAndUpdate(
    couponId,
    { $inc: { usedCount: 1 } },
    { new: true }
  );
  if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, 'Coupon not found');
  return coupon;
};

const createCoupon = async ({ chain, outlet, code, title, description, type, value, maxDiscount, minOrderAmount, usageLimit, perCustomerLimit, startsAt, endsAt, createdBy }) => {
  const StoreCoupon = mongoose.model('StoreCoupon');
  return StoreCoupon.create({
    chain,
    outlet,
    code: String(code).toUpperCase(),
    title,
    description,
    type: type || 'percent_off',
    value: value || 0,
    maxDiscount,
    minOrderAmount: minOrderAmount || 0,
    usageLimit: usageLimit || 0,
    perCustomerLimit: perCustomerLimit === undefined ? 1 : perCustomerLimit,
    startsAt,
    endsAt,
    status: 'active',
    isActive: true,
    createdBy,
  });
};

const listCoupons = async ({ chain, outlet, status, page = 1, limit = 20 }) => {
  const StoreCoupon = mongoose.model('StoreCoupon');
  const filter = {};
  if (chain) filter.chain = chain;
  if (outlet) filter.outlet = outlet;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreCoupon.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreCoupon.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

/**
 * The customer-facing coupon cards for a store: active, in date, and not exhausted.
 * Chain-wide coupons are included with the outlet's own; a coupon scoped to another
 * outlet in the same chain is not.
 */
const listActiveCoupons = async ({ chain, outlet }) => {
  const StoreCoupon = mongoose.model('StoreCoupon');
  const now = new Date();
  return StoreCoupon.find({
    $or: [{ outlet }, { chain, outlet: null }],
    status: 'active',
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
    $and: [
      {
        $or: [
          { usageLimit: 0 },
          { $expr: { $lt: ['$usedCount', '$usageLimit'] } },
        ],
      },
    ],
  })
    .select('code title description type value maxDiscount minOrderAmount startsAt endsAt')
    .sort({ createdAt: -1 })
    .lean();
};

module.exports = {
  validateCoupon,
  calculateDiscount,
  applyCoupon,
  createCoupon,
  listCoupons,
  listActiveCoupons,
};
