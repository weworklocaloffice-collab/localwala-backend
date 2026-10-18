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
 * Validation for the `jhatka_settings` tab in Business Setup.
 *
 * Ranges match the schema so a value that reaches the database has already
 * been agreed on by all three layers.
 */
const settingsBody = {
  weightTolerancePct: Joi.number().min(0).max(100).allow(),
  weightHardOverchargePct: Joi.number().min(0).max(100).allow(),
  weightHardShortfallPct: Joi.number().min(0).max(100).allow(),
  subscriptionCeilingPct: Joi.number().min(0).max(100).allow(),
  editCutoffHours: Joi.number().min(0).max(168).allow(),
  codTolerancePct: Joi.number().min(0).max(100).allow(),
  maxTransitMinutes: Joi.number().integer().min(1).max(1440).allow(),
};

const createSettings = {
  body: Joi.object().keys(settingsBody),
};

const updateSettings = {
  params: Joi.object().keys({
    settingId: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys(settingsBody),
};

module.exports = {
  createSettings,
  updateSettings,
};
