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

const itemFormElementSchema = Joi.object({
  name: Joi.string().required(),
});

const formElementSchema = Joi.object({
  uuid: Joi.string().required(),
  isRequired: Joi.boolean().required(),
  type: Joi.string().valid('text', 'number', 'file', 'choose', 'date', 'email', 'phone').required(),
  title: Joi.string().required(),
  placeholder: Joi.string().allow('', null),
  items: Joi.array().items(itemFormElementSchema).min(0),
});

const saveRestaurantJoiningFormValidation = {
  body: Joi.object().keys({
    formField: Joi.array().items(formElementSchema),
  }),
};

module.exports = {
  saveRestaurantJoiningFormValidation,
};

