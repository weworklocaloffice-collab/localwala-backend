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

const saveFeedback = {
  body: Joi.object().keys({
    userName: Joi.string().required(),
    userCountryCode: Joi.string().required().required(),
    userContact: Joi.string().required(),
    userEmail: Joi.string().required().email().required(),
    shortDescription: Joi.string().required(),
  }),
};

const deleteFeedbackValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateFeedbackValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    email: Joi.string().required().email().required(),
    text: Joi.string().required(),
  }),
};

const allValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    status: Joi.boolean().required(),
    search: Joi.string().allow(null, ''),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.boolean().required(),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  saveFeedback,
  deleteFeedbackValidation,
  updateFeedbackValidation,
  allValidation,
  exportValidation,
};

