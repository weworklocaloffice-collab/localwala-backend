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

const createSettings = {
  body: Joi.object().keys({
    waiterLoginWith: Joi.string()
      .valid('email_password', 'phone_password', 'phone_otp', 'email_otp')
      .allow(),
    waiterResetPasswordWith: Joi.string().valid('phone_otp', 'email_otp').allow(),
    getTip: Joi.boolean().allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    settingId: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createSettings,
  idValidation,
};

