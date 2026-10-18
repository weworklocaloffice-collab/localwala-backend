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

const createCategory = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    image: Joi.string().required(),
    restaurant: Joi.string().custom(objectId).required(),
    translations: Joi.allow(),
    status: Joi.boolean().allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    categoryId: Joi.string().custom(objectId),
  }),
};

const myCategoryValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createCategory,
  idValidation,
  myCategoryValidation,
};

