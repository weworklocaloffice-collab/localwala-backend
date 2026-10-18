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

const createSubCategory = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    category: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
    status: Joi.boolean().allow(),
    translations: Joi.allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    subCategoryId: Joi.string().custom(objectId),
  }),
};

const mySubCategoryValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId),
  }),
};

const mySubCategoryByCateIdValidation = {
  params: Joi.object().keys({
    category: Joi.string().custom(objectId),
    restaurant: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createSubCategory,
  idValidation,
  mySubCategoryValidation,
  mySubCategoryByCateIdValidation,
};

