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
 * Outlet scoping.
 *
 * `:id` is the business, matching the other `/partner` routes. It is still a
 * client-supplied value — `verify.dairy.api.contract.js` tracks that exposure
 * until partner scoping is settled — so nothing here should be treated as a
 * security boundary on its own.
 */
const complianceScopeValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const setLicenceValidation = {
  ...complianceScopeValidation,
  body: Joi.object().keys({
    licenceNumber: Joi.string().required().trim(),
    issuedAt: Joi.date().required(),
    expiresAt: Joi.date().required(),
    category: Joi.string()
      .valid('petrol', 'state_licence', 'central_licence', 'registration')
      .default('petrol'),
    documentUrl: Joi.string().allow('', null),
  }),
};

const hygieneCheckValidation = {
  ...complianceScopeValidation,
  body: Joi.object().keys({
    checkType: Joi.string().required().trim(),
    result: Joi.string().valid('pass', 'fail', 'conditional').required(),
    checkedAt: Joi.date().allow('', null),
    nextDueAt: Joi.date().allow('', null),
    checkedBy: Joi.string().custom(objectId).allow('', null),
    notes: Joi.string().allow('', null),
    proofUrls: Joi.array().items(Joi.string()).max(10).default([]),
  }),
};

const addDocumentValidation = {
  ...complianceScopeValidation,
  body: Joi.object().keys({
    type: Joi.string().required().trim(),
    reference: Joi.string().allow('', null),
    issuedAt: Joi.date().allow('', null),
    expiresAt: Joi.date().allow('', null),
    fileUrl: Joi.string().allow('', null),
  }),
};

const expiringValidation = {
  query: Joi.object().keys({
    days: Joi.number().integer().min(1).max(365),
  }),
};

module.exports = {
  complianceScopeValidation,
  setLicenceValidation,
  hygieneCheckValidation,
  addDocumentValidation,
  expiringValidation,
};
