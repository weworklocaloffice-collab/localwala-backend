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

const createOrUpdateSocialSignin = {
  body: Joi.object().keys({
    appleSignin: Joi.boolean().required(),
    googleSignin: Joi.boolean().required(),
    facebookSignin: Joi.boolean().required(),
    configCredsRaw: Joi.object({
      google_client_id: Joi.string().allow('', null),
      google_server_id: Joi.string().allow('', null),
    }).required(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  createOrUpdateSocialSignin,
  idValidation,
};

