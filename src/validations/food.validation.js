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

const createFood = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    shortDescription: Joi.string().required(),
    image: Joi.string().required(),
    restaurant: Joi.string().custom(objectId).required(),
    ownCategory: Joi.boolean().allow(),
    category: Joi.string().custom(objectId).allow(null, ''),
    subCategory: Joi.string().custom(objectId).allow(null, ''),
    customCategory: Joi.string().custom(objectId).allow(null, ''),
    customSubCategory: Joi.string().custom(objectId).allow(null, ''),
    foodType: Joi.string().allow(null, ''),
    addons: Joi.string().allow(null, ''),
    startTime: Joi.string().allow(null, ''),
    endTime: Joi.string().allow(null, ''),
    price: Joi.number().required(),
    discountType: Joi.string().allow(null, ''),
    discount: Joi.number().allow(null, ''),
    purchaseLimit: Joi.number().allow(null, ''),
    variations: Joi.array().allow(),
    tags: Joi.array().allow(),
    translations: Joi.allow(),
    inStock: Joi.boolean().allow(),
    stockType: Joi.string().allow('unlimited', 'limited', 'daily').required(),
    stockNumber: Joi.number().allow(-1, 0).required(),
    taxationEnable: Joi.boolean().allow(),
    foodTax: Joi.string().allow(null, ''),
    status: Joi.string()
      .allow()
      .valid('hold', 'live', 'photoreject', 'qualityreject', 'sizereject', 'reject', 'hide'),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    foodId: Joi.string().custom(objectId),
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

const cityValidation = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId),
  }),
};

const myFoodValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId),
  }),
};

const foodInfoValidation = {
  params: Joi.object().keys({
    foodId: Joi.string().custom(objectId),
    restaurant: Joi.string().custom(objectId),
  }),
};

const singleFoodInfoValidation = {
  body: Joi.object().keys({
    foodId: Joi.string().custom(objectId),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const getSubCategoryByIdValidation = {
  params: Joi.object().keys({
    category: Joi.string().custom(objectId),
  }),
};

const searchMenuValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    searchQuery: Joi.string().required(),
  }),
};

const kitchenOwnerFoodListValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const kitchenOwnerFoodDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    owner: Joi.string().custom(objectId).required(),
  }),
};

const kitchenOwnerAddonValidation = {
  params: Joi.object().keys({
    owner: Joi.string().custom(objectId).required(),
  }),
};

const kitchenUpdateStockValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    owner: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    addons: Joi.string().allow(null, ''),
    variations: Joi.array().allow(),
    stockType: Joi.string().allow('unlimited', 'limited', 'daily').required(),
    stockNumber: Joi.number().allow(-1, 0).required(),
  }),
};

const exportReportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    search: Joi.string().allow(null, ''),
    restaurant: Joi.string().allow(null, ''),
    kind: Joi.string().allow(null, '').valid('none', 'veg', 'nonveg', 'vegans'),
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
  }),
};

module.exports = {
  createFood,
  idValidation,
  myFoodValidation,
  getSubCategoryByIdValidation,
  foodInfoValidation,
  cityValidation,
  singleFoodInfoValidation,
  searchMenuValidation,
  kitchenOwnerFoodListValidation,
  kitchenOwnerFoodDetailValidation,
  kitchenOwnerAddonValidation,
  kitchenUpdateStockValidation,
  exportReportValidation,
  allValidation,
  exportValidation,
  cityMasterValidation,
};

