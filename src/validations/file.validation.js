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

// cuisine
const Joi = require('joi');
const { objectId } = require('./custom.validation');

const pathValidation = {
  params: Joi.object().keys({
    path: Joi.string().custom(objectId),
  }),
};

const userMediaDropValidation = {
  body: Joi.object().keys({
    path: Joi.string().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  pathValidation,
  userMediaDropValidation,
};

