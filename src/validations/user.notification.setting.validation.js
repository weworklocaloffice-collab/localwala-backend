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

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateSettingValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    newsletters: Joi.boolean().required(),
    promoEmail: Joi.boolean().required(),
    promoNotification: Joi.boolean().required(),
    promoWhatsApp: Joi.boolean().required(),
    socialEmail: Joi.boolean().required(),
    socialNotification: Joi.boolean().required(),
    orderEmail: Joi.boolean().required(),
    orderNotification: Joi.boolean().required(),
    orderWhatsApp: Joi.boolean().required(),
    importantUpdate: Joi.boolean().required(),
  }),
};

module.exports = {
  idValidation,
  updateSettingValidation,
};

