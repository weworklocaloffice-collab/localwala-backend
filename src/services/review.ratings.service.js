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

const foodOrderReviewService = require('./food.order.review.service');
const driverOrderReviewService = require('./driver.order.review.service');
const restaurantOrderReviewService = require('./restaurant.order.review.service');
const { Orders } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveOrderReview = async (param) => {
  const productArray = [];
  param.product.forEach((element) => {
    const productReviewObject = {
      user: param.user,
      orders: param.orders,
      food: element.id,
      ratingCount: element.rate,
      messages:
        element && element.message && element.message !== null && element.message !== ''
          ? element.message.split(',')
          : [],
      images:
        element && element.images && element.images !== null && element.images !== ''
          ? param.images.split(',')
          : [],
      shortReview: param.shortReview,
    };
    productArray.push(productReviewObject);
  });
  if (checkArrayNotEmpty(productArray)) {
    const saveProductPromises = productArray.map((product) =>
      foodOrderReviewService.saveFoodReview(product)
    );
    await Promise.all(saveProductPromises);
  }

  if (
    param &&
    param.driver &&
    param.driver !== null &&
    param.driver !== '' &&
    param.driverRate &&
    param.driverRate !== null &&
    param.driverRate !== '' &&
    param.driverRate > 0
  ) {
    const driverReviewObject = {
      user: param.user,
      orders: param.orders,
      driver: param.driver,
      ratingCount: param.driverRate,
      messages:
        param && param.driverMessage && param.driverMessage !== null && param.driverMessage !== ''
          ? param.driverMessage.split(',')
          : [],
      images:
        param && param.images && param.images !== null && param.images !== ''
          ? param.images.split(',')
          : [],
      shortReview: param.shortReview,
    };
    await driverOrderReviewService.saveDriverReview(driverReviewObject);
  }

  if (
    param &&
    param.restaurant &&
    param.restaurant !== null &&
    param.restaurant !== '' &&
    param.restaurantRate &&
    param.restaurantRate !== null &&
    param.restaurantRate !== '' &&
    param.restaurantRate > 0
  ) {
    const restaurantReviewObject = {
      user: param.user,
      orders: param.orders,
      restaurant: param.restaurant,
      ratingCount: param.restaurantRate,
      messages:
        param &&
        param.restaurantMessage &&
        param.restaurantMessage !== null &&
        param.restaurantMessage !== ''
          ? param.restaurantMessage.split(',')
          : [],
      images:
        param && param.images && param.images !== null && param.images !== ''
          ? param.images.split(',')
          : [],
      shortReview: param.shortReview,
    };
    await restaurantOrderReviewService.saveRestaurantReview(restaurantReviewObject);
  }
  await Orders.findByIdAndUpdate(param.orders, {
    ratingSaved: true,
  });
  return { success: true };
};

const getMyReviewList = async (userId) => {
  const foodReviews = await foodOrderReviewService.getMyFoodReview(userId);
  const driverReviews = await driverOrderReviewService.getMyDriverReview(userId);
  const restaurantReviews = await restaurantOrderReviewService.getMyRestaurantReview(userId);
  return Promise.all([foodReviews, driverReviews, restaurantReviews]).then(() => {
    const result = {
      foodReviews,
      driverReviews,
      restaurantReviews,
      success: true,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  saveOrderReview,
  getMyReviewList,
};

