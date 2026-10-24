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

const createReview = async ({ chain, outlet, customer, order, product, variant, rating, title, comment, images }) => {
  const StoreReview = mongoose.model('StoreReview');
  const existing = await StoreReview.findOne({ customer, order, product });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'Review already exists for this order and product');

  return StoreReview.create({
    chain,
    outlet,
    customer,
    order,
    product,
    variant,
    rating,
    title,
    comment,
    images: images || [],
    isVerifiedPurchase: !!order,
    status: 'pending',
  });
};

const moderateReview = async (reviewId, { status, reply }) => {
  const StoreReview = mongoose.model('StoreReview');
  const review = await StoreReview.findById(reviewId);
  if (!review) throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');

  review.status = status;
  if (reply) {
    review.reply = { ...reply, repliedAt: new Date() };
  }
  await review.save();

  await updateOutletRating(review.outlet);
  return review;
};

const updateOutletRating = async (outletId) => {
  const StoreReview = mongoose.model('StoreReview');
  const StoreOutlet = mongoose.model('StoreOutlet');
  const { avgRating, count } = await StoreReview.getAverageRating(outletId);
  await StoreOutlet.findByIdAndUpdate(outletId, { $set: { rating: avgRating, ratingCount: count } });
};

  const listReviews = async ({ chain, outlet, product, customer, status, page = 1, limit = 20 }) => {
    const StoreReview = mongoose.model('StoreReview');
    const filter = {};
    if (chain) filter.chain = chain;
    if (outlet) filter.outlet = outlet;
  if (product) filter.product = product;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreReview.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreReview.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const markHelpful = async (reviewId) => {
  const StoreReview = mongoose.model('StoreReview');
  return StoreReview.findByIdAndUpdate(reviewId, { $inc: { isHelpful: 1 } }, { new: true });
};

module.exports = {
  createReview,
  moderateReview,
  listReviews,
  markHelpful,
  updateOutletRating,
};