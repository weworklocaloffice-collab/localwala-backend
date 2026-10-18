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
const { cartItemService } = require('../services');

const addToCart = catchAsync(async (req, res) => {
  if (req && req.body && req.body.addons && req.body.addons !== '') {
    req.body.addons = req.body.addons.split(',');
  } else {
    req.body.addons = [];
  }

  const cart = await cartItemService.addToCart(req.body);
  res.send({ cartId: cart.id, success: true });
});

const removeCartItemByRestaurant = catchAsync(async (req, res) => {
  const { trackingId, restaurant } = req.body;
  await cartItemService.removeCartItemByRestaurant(trackingId, restaurant);
  res.send({ success: true });
});

const removeCartItemByTrackingId = catchAsync(async (req, res) => {
  const { trackingId } = req.params;
  await cartItemService.removeCartItemByTrackingId(trackingId);
  res.send({ success: true });
});

const removeFromCartWithUuid = catchAsync(async (req, res) => {
  const { trackingId, uuid, id } = req.body;
  await cartItemService.removeFromCartWithUuid(trackingId, uuid, id);
  res.send({ success: true });
});

const removeFromCartWithFoodId = catchAsync(async (req, res) => {
  const { trackingId, id } = req.body;
  await cartItemService.removeFromCartWithFoodId(trackingId, id);
  res.send({ success: true });
});

const updateFoodQuantity = catchAsync(async (req, res) => {
  const { trackingId, id, quantity } = req.body;
  await cartItemService.updateFoodQuantity(trackingId, id, quantity);
  res.send({ success: true });
});

const updateFoodVariationQuantity = catchAsync(async (req, res) => {
  const { trackingId, uuid, id, quantity } = req.body;
  await cartItemService.updateFoodVariationQuantity(trackingId, uuid, id, quantity);
  res.send({ success: true });
});

module.exports = {
  addToCart,
  removeCartItemByRestaurant,
  removeCartItemByTrackingId,
  removeFromCartWithUuid,
  removeFromCartWithFoodId,
  updateFoodQuantity,
  updateFoodVariationQuantity,
};

