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

const joinCampaignValidation = {
  body: Joi.object().keys({
    food: Joi.string().custom(objectId),
    campaign: Joi.string().custom(objectId),
    restaurant: Joi.string().custom(objectId),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    campaignId: Joi.string().custom(objectId),
  }),
};

module.exports = {
  joinCampaignValidation,
  idValidation,
};

