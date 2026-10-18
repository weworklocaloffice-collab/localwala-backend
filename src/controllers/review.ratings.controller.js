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

const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const {
  reviewRatingsService,
  restaurantOrderReviewService,
  foodOrderReviewService,
  driverOrderReviewService,
} = require('../services');

const saveOrderReview = catchAsync(async (req, res) => {
  const result = await reviewRatingsService.saveOrderReview(req.body);
  res.send(result);
});

const getRestaurantReview = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await restaurantOrderReviewService.getRestaurantReview(req.body.id, options);
  res.send(result);
});

const getFoodReview = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await foodOrderReviewService.getFoodReview(req.body.id, options);
  res.send(result);
});

const savePublicRestaurantReview = catchAsync(async (req, res) => {
  const result = await restaurantOrderReviewService.savePublicRestaurantReview(req.body);
  res.send(result);
});

const getMyReviewList = catchAsync(async (req, res) => {
  const { uid } = req.params;
  const result = await reviewRatingsService.getMyReviewList(uid);
  res.send(result);
});

const getDeliverymanReviewList = catchAsync(async (req, res) => {
  const { id } = req.body;
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await driverOrderReviewService.getMyReview(id, options);
  res.send(result);
});

const customerAllReviews = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await foodOrderReviewService.customerAllReviews(options);
  res.send(result);
});

const customerRestaurantReview = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await foodOrderReviewService.customerRestaurantReview(options);
  res.send(result);
});

const customerFoodReview = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await foodOrderReviewService.customerFoodReview(options);
  res.send(result);
});

const customerDeliverymanReview = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await foodOrderReviewService.customerDeliverymanReview(options);
  res.send(result);
});

const vendorAllReviews = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await foodOrderReviewService.vendorAllReviews(options);
  res.send(result);
});

const vendorReviews = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await foodOrderReviewService.vendorReviews(options);
  res.send(result);
});

const vendorFoodReviews = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await foodOrderReviewService.vendorFoodReviews(options);
  res.send(result);
});

const deliverymanReviews = catchAsync(async (req, res) => {
  const options = pick(req.query, ['deliveryman', 'limit', 'page']);
  const result = await foodOrderReviewService.deliverymanReviews(options);
  res.send(result);
});

module.exports = {
  saveOrderReview,
  getRestaurantReview,
  getFoodReview,
  savePublicRestaurantReview,
  getMyReviewList,
  getDeliverymanReviewList,
  customerAllReviews,
  customerRestaurantReview,
  customerFoodReview,
  customerDeliverymanReview,
  vendorAllReviews,
  vendorReviews,
  vendorFoodReviews,
  deliverymanReviews,
};

