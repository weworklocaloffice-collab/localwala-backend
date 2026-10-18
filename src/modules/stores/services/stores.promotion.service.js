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

const validatePromotion = async ({ chain, outlet, code, cartAmount, customerId }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const now = new Date();

  const promo = await StorePromotion.findOne({
    $or: [{ chain }, { outlet }],
    code: code.toUpperCase(),
    status: 'active',
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  });

  if (!promo) throw new ApiError(httpStatus.NOT_FOUND, 'Invalid or expired promotion code');
  if (promo.minOrderAmount > cartAmount) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Minimum order amount for this promotion is ${promo.minOrderAmount}`);
  }
  if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) {
    throw new ApiError(httpStatus.CONFLICT, 'Promotion usage limit exceeded');
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

const createPromotion = async ({ chain, outlet, name, description, type, value, maxDiscount, minOrderAmount, applicableProducts, applicableCategories, applicableVariants, code, usageLimit, perCustomerLimit, startsAt, endsAt, createdBy }) => {
  const StorePromotion = mongoose.model('StorePromotion');
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
    startsAt,
    endsAt,
    createdBy,
    status: 'active',
    isActive: true,
  });
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
};