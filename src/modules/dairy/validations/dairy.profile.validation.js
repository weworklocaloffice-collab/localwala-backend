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
const { objectId } = require('../../../validations/custom.validation');

/**
 * Switching role acts on whoever is signed in.
 *
 * Deliberately takes no `:id`. The user is taken from the access token, and a
 * client-supplied id would let one signed-in user switch the role of another.
 */
const switchRoleValidation = {
  body: Joi.object().keys({
    role: Joi.string().valid('dairyPartner', 'dairyDriver').required(),
  }),
};

/**
 * Role resolution for the signed-in user.
 *
 * Also no `:id`: the token already says who is asking. The route once borrowed
 * `auth.profileValidation`, which requires an `:id` the path never declared —
 * making the endpoint impossible to call.
 */
const availableRolesValidation = {};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const allValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  switchRoleValidation,
  availableRolesValidation,
  idValidation,
  allValidation,
};