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

const resolveLifecycleStatus = (promotion, now = new Date()) => {
  if (promotion.endsAt && new Date(promotion.endsAt) < now) return 'expired';
  if (promotion.startsAt && new Date(promotion.startsAt) > now) return 'scheduled';
  return 'live';
};

const applyWindowStatus = (promotion, now = new Date()) => {
  promotion.status = resolveLifecycleStatus(promotion, now);
  promotion.isActive = promotion.status === 'live';
  return promotion;
};

const validatePromotion = async ({ chain, outlet, code, cartAmount, customerId }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const now = new Date();

  // `$or: [{ chain }, { outlet }]` was too wide: an outlet-scoped code from a DIFFERENT
  // outlet in the same chain matched on `chain` alone. The chain contains the catalogue,
  // but a coupon belongs to where it is redeemable, so the outlet must be this outlet or
  // absent (a chain-wide offer).
  const scope = chain
    ? { chain, $or: [{ outlet }, { outlet: null }] }
    : { outlet };

  const promo = await StorePromotion.findOne({
    ...scope,
    code: code.toUpperCase(),
    ...StorePromotion.redeemableFilter(now),
  }).sort({ outlet: -1 });

  if (!promo) throw new ApiError(httpStatus.NOT_FOUND, 'Invalid or expired promotion code');
  if (promo.minOrderAmount > cartAmount) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Minimum order amount for this promotion is ${promo.minOrderAmount}`);
  }
  if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) {
    throw new ApiError(httpStatus.CONFLICT, 'Promotion usage limit exceeded');
  }

  // A per-customer limit was stored on the promotion but never enforced, so a "one use
  // per customer" coupon could be applied to every order. Orders are the redemption
  // ledger in V1: cancelled and failed orders never consumed the coupon, so they are
  // excluded rather than counted against the customer.
  if (promo.perCustomerLimit > 0 && customerId) {
    const StoreOrder = mongoose.model('StoreOrder');
    const redemptions = await StoreOrder.countDocuments({
      customer: customerId,
      'promo.promotion': promo._id,
      lifecycle: { $nin: ['cancelled', 'payment_failed', 'rejected'] },
    });
    if (redemptions >= promo.perCustomerLimit) {
      throw new ApiError(httpStatus.CONFLICT, 'You have already used this promotion');
    }
  }

  return promo;
};

const calculateDiscount = (promo, cartAmount) => {
  let discount = 0;
  switch (promo.type) {
    case 'percent_off':
      discount = Math.round((cartAmount * promo.value) / 100);
      if (promo.maxDiscount) discount = Math.min(discount, promo.maxDiscount);
      break;
    case 'fixed_off':
      discount = Math.min(promo.value, cartAmount);
      break;
    case 'min_order_offer':
      discount = cartAmount >= promo.minOrderAmount ? promo.value : 0;
      break;
    case 'free_delivery':
      discount = 0;
      break;
    case 'product_discount':
      // Capped like fixed_off: a discount is bounded by what it discounts. Without the
      // cap a 500 product_discount on a 100 cart discounted 500 — five times the sale.
      discount = Math.min(promo.value, cartAmount);
      break;
  }
  return discount;
};

const applyPromotion = async (promoId) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const promo = await StorePromotion.findById(promoId);
  if (!promo) throw new ApiError(httpStatus.NOT_FOUND, 'Promotion not found');

  promo.usageCount += 1;
  await promo.save();
  return promo;
};

const createPromotion = async ({ chain, outlet, name, description, type, value, maxDiscount, minOrderAmount, applicableProducts, applicableCategories, applicableVariants, code, usageLimit, perCustomerLimit, stackable, priority, startsAt, endsAt, createdBy }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const StoreChain = mongoose.model('StoreChain');

  // BR-22: the chain's allowed types are an ADMIN gate, not a UI hint. Re-read here so a
  // partner cannot post a type the chain is not permitted to run; the same check is
  // repeated at approval time because the setting can change between the two.
  const chainDoc = chain ? await StoreChain.findById(chain).select('settings.allowedPromotionTypes').lean() : null;
  const allowed = chainDoc && chainDoc.settings ? chainDoc.settings.allowedPromotionTypes : null;
  if (Array.isArray(allowed) && allowed.length && !allowed.includes(type)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Promotion type '${type}' is not permitted for this chain`);
  }

  // BR-22 money guard: an uncapped percent-off has no upper bound, so it is not a legal
  // promotion even before it reaches Admin review.
  if (type === 'percent_off' && (!maxDiscount || maxDiscount <= 0)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'MAX_DISCOUNT_REQUIRED: percent_off promotions must set maxDiscount');
  }

  // Every promotion is reviewed before it can go live. The draft/pending state is the
  // boundary: a partner cannot publish money-off directly, and Admin approval moves it to
  // scheduled or live based on its own start/end window.
  return StorePromotion.create({
    chain,
    outlet,
    name,
    description,
    type,
    value,
    maxDiscount,
    minOrderAmount,
    applicableProducts: applicableProducts || [],
    applicableCategories: applicableCategories || [],
    applicableVariants: applicableVariants || [],
    code: code?.toUpperCase(),
    usageLimit: usageLimit || 0,
    perCustomerLimit: perCustomerLimit || 1,
    stackable: stackable === undefined ? true : stackable,
    priority: priority || 0,
    startsAt,
    endsAt,
    createdBy,
    status: 'draft',
    isActive: false,
    approval: { status: 'pending' },
  });
};

const findOwnedPromotion = async ({ promotion, chain, outlet }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const query = { _id: promotion };
  if (chain) query.chain = chain;
  if (outlet) query.outlet = outlet;
  const doc = await StorePromotion.findOne(query);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Promotion not found');
  return doc;
};

const pausePromotion = async ({ promotion, chain, outlet }) => {
  const doc = await findOwnedPromotion({ promotion, chain, outlet });
  if (!['active', 'live', 'scheduled'].includes(doc.status)) {
    throw new ApiError(httpStatus.CONFLICT, `PROMOTION_NOT_PAUSABLE: ${doc.status} cannot be paused`);
  }
  doc.status = 'paused';
  doc.isActive = false;
  await doc.save();
  return doc;
};

const resumePromotion = async ({ promotion, chain, outlet }) => {
  const doc = await findOwnedPromotion({ promotion, chain, outlet });
  if (doc.status !== 'paused') {
    throw new ApiError(httpStatus.CONFLICT, `PROMOTION_NOT_PAUSED: ${doc.status} cannot be resumed`);
  }
  if (doc.approval && ['pending', 'rejected'].includes(doc.approval.status)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'PROMOTION_NOT_APPROVED: Admin approval is required before this promotion can go live');
  }
  applyWindowStatus(doc);
  await doc.save();
  return doc;
};

const syncPromotionLifecycle = async (now = new Date()) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const expired = await StorePromotion.updateMany(
    { status: { $in: ['active', 'live', 'paused'] }, endsAt: { $lt: now } },
    { $set: { status: 'expired', isActive: false } }
  );
  const started = await StorePromotion.updateMany(
    { status: 'scheduled', startsAt: { $lte: now }, endsAt: { $gte: now } },
    { $set: { status: 'live', isActive: true } }
  );
  const missed = await StorePromotion.updateMany(
    { status: 'scheduled', endsAt: { $lt: now } },
    { $set: { status: 'expired', isActive: false } }
  );
  return {
    expired: expired.modifiedCount || 0,
    started: started.modifiedCount || 0,
    missed: missed.modifiedCount || 0,
  };
};

const listPromotions = async ({ chain, outlet, status, page = 1, limit = 20 }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const filter = {};
  if (chain) filter.chain = chain;
  if (outlet) filter.outlet = outlet;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StorePromotion.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StorePromotion.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

module.exports = {
  validatePromotion,
  calculateDiscount,
  applyPromotion,
  createPromotion,
  listPromotions,
  pausePromotion,
  resumePromotion,
  resolveLifecycleStatus,
  applyWindowStatus,
  syncPromotionLifecycle,
};