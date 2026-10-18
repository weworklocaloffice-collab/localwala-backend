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

const Joi = require('joi');
const { objectId } = require('./custom.validation');

const createCoupon = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    type: Joi.string().required(),
    couponType: Joi.string()
      .allow('default', 'restaurant', 'freedelivery', 'firstorder', 'loyality', 'bogo')
      .required(),
    allRestaurants: Joi.boolean(),
    restaurant: Joi.string().allow(null, ''),
    allUsers: Joi.boolean(),
    user: Joi.string().allow(null, ''),
    code: Joi.string().required(),
    limitSameUser: Joi.number().required(),
    start: Joi.date().required(),
    expires: Joi.date().required(),
    discountType: Joi.string().allow('amount', 'percentage'),
    minDiscount: Joi.number().allow(null, 0, ''),
    maxDiscount: Joi.number().allow(null, 0, ''),
    minCartTotal: Joi.number().allow(null, 0, ''),
    loyalityPoints: Joi.number().allow(null, 0, ''),
    status: Joi.string().allow('hold', 'live', 'reject', 'hide'),
    translations: Joi.allow(),
    createdById: Joi.string().custom(objectId).required(),
  }),
};

const cityzenCreateCoupon = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    name: Joi.string().required(),
    couponType: Joi.string()
      .allow('default', 'restaurant', 'freedelivery', 'firstorder', 'loyality', 'bogo')
      .required(),
    allRestaurants: Joi.boolean(),
    restaurant: Joi.string().allow(null, ''),
    allUsers: Joi.boolean(),
    user: Joi.string().allow(null, ''),
    code: Joi.string().required(),
    limitSameUser: Joi.number().required(),
    start: Joi.date().required(),
    expires: Joi.date().required(),
    discountType: Joi.string().allow('amount', 'percentage'),
    minDiscount: Joi.number().allow(null, 0, ''),
    maxDiscount: Joi.number().allow(null, 0, ''),
    minCartTotal: Joi.number().allow(null, 0, ''),
    loyalityPoints: Joi.number().allow(null, 0, ''),
    status: Joi.string().allow('hold', 'live', 'reject', 'hide'),
    translations: Joi.allow(),
    createdById: Joi.string().custom(objectId).required(),
  }),
};

const requestNewCouponValidation = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    code: Joi.string().required(),
    limitSameUser: Joi.number().required(),
    start: Joi.date().required(),
    expires: Joi.date().required(),
    discountType: Joi.string().allow('amount', 'percentage'),
    minDiscount: Joi.number().allow(null, 0, ''),
    maxDiscount: Joi.number().allow(null, 0, ''),
    minCartTotal: Joi.number().allow(null, 0, ''),
    restaurantId: Joi.string().custom(objectId).required(),
    createdById: Joi.string().custom(objectId).required(),
    translations: Joi.allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
};

const userValidation = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }),
};

const redeemValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    coupon: Joi.string().custom(objectId).required(),
    tracking: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const vendorCouponInfoValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    userId: Joi.string().custom(objectId).required(),
  }),
};

const updateVendorCouponValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys({
    name: Joi.string().required(),
    code: Joi.string().required(),
    limitSameUser: Joi.number().required(),
    start: Joi.date().required(),
    expires: Joi.date().required(),
    discountType: Joi.string().allow('amount', 'percentage'),
    minDiscount: Joi.number().allow(null, 0, ''),
    maxDiscount: Joi.number().allow(null, 0, ''),
    minCartTotal: Joi.number().allow(null, 0, ''),
    restaurantId: Joi.string().custom(objectId).required(),
    createdById: Joi.string().custom(objectId).required(),
    translations: Joi.allow(),
  }),
};

const deleteVendorCouponValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
    userId: Joi.string().custom(objectId),
  }),
};

const vendorCouponUpdateStatusValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys({
    status: Joi.string().required().allow('live', 'hide'),
  }),
};

const detailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const allValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
    status: Joi.boolean().required(),
  }),
};

const cityMasterValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  createCoupon,
  idValidation,
  userValidation,
  redeemValidation,
  requestNewCouponValidation,
  vendorCouponInfoValidation,
  updateVendorCouponValidation,
  deleteVendorCouponValidation,
  vendorCouponUpdateStatusValidation,
  detailValidation,
  cityzenCreateCoupon,
  allValidation,
  exportValidation,
  cityMasterValidation,
};

