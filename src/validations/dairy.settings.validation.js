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

/**
 * Validation for the `dairy_settings` tab in Business Setup.
 *
 * Mirrors the other verticals' shape, with a narrower surface because the model is.
 * The 1-365 range matches both the schema and the service's clamp, so a value that
 * reaches the database has already been agreed on by all three layers.
 */
const createSettings = {
  body: Joi.object().keys({
    fefoWarningDays: Joi.number().integer().min(1).max(365).allow(),
    subscriptionSkipCutoffHours: Joi.number().integer().min(0).max(48).allow(),
    selfRegistration: Joi.boolean().allow(),
  }),
};

const updateSettings = {
  params: Joi.object().keys({
    settingId: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys({
    fefoWarningDays: Joi.number().integer().min(1).max(365).allow(),
    subscriptionSkipCutoffHours: Joi.number().integer().min(0).max(48).allow(),
    selfRegistration: Joi.boolean().allow(),
  }),
};

module.exports = {
  createSettings,
  updateSettings,
};