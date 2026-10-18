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

const getNotificationValidation = {
  params: Joi.object().keys({
    slug: Joi.string().required(),
  }),
};

const saveOrderNotificationTranslationValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    description: Joi.string().required(),
    slug: Joi.string().required(),
    translations: Joi.allow(),
  }),
};

module.exports = { getNotificationValidation, saveOrderNotificationTranslationValidation };

