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
// Ensure the StoreOutlet model is registered (used by updateOutletRating).
require('../models/store.outlet.model');

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

const createOrderReview = async ({ order, customer, rating, title, comment, images, productRatings }) => {
  const StoreReview = mongoose.model('StoreReview');
  const StoreOrder = mongoose.model('StoreOrder');

  const orderDoc = await StoreOrder.findById(order);
  if (!orderDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (String(orderDoc.customer) !== String(customer)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'ORDER_NOT_OWNED: this order belongs to another customer');
  }
  if (!['delivered', 'completed'].includes(orderDoc.lifecycle)) {
    throw new ApiError(httpStatus.CONFLICT, 'ORDER_NOT_REVIEWABLE: reviews open after delivery');
  }

  const existing = await StoreReview.findOne({ customer, order: orderDoc._id, product: null });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'REVIEW_ALREADY_EXISTS: this order has already been reviewed');

  const storeReview = await StoreReview.create({
    chain: orderDoc.chain,
    outlet: orderDoc.outlet,
    customer,
    order: orderDoc._id,
    rating,
    title,
    comment,
    images: images || [],
    isVerifiedPurchase: true,
    status: 'pending',
  });

  // Per-product ratings (optional). Each creates a separate StoreReview with product+variant.
  const productReviews = [];
  if (Array.isArray(productRatings)) {
    for (const pr of productRatings) {
      if (!pr || !pr.product) continue;
      const line = (orderDoc.items || []).find((it) => String(it.product) === String(pr.product));
      const existingPr = await StoreReview.findOne({ customer, order: orderDoc._id, product: pr.product });
      if (existingPr) continue;
      const prReview = await StoreReview.create({
        chain: orderDoc.chain,
        outlet: orderDoc.outlet,
        customer,
        order: orderDoc._id,
        product: pr.product,
        variant: line ? line.variant : undefined,
        rating: pr.rating,
        title: pr.title,
        comment: pr.comment,
        images: pr.images || [],
        isVerifiedPurchase: true,
        status: 'pending',
      });
      productReviews.push(prReview);
    }
  }

  await updateOutletRating(orderDoc.outlet);
  storeReview.productReviews = productReviews;
  return storeReview;
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
  createOrderReview,
  moderateReview,
  listReviews,
  markHelpful,
  updateOutletRating,
};