/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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

/**
 * The vertical registry.
 *
 * Keyed by the vertical's `key` rather than its id, so the path reads as the thing
 * an operator knows: `PATCH /admin/verticals/dairy`. The key is lowercased by the
 * service, so `Dairy` and `dairy` are the same vertical.
 */

const keyParams = {
  key: Joi.string().trim().lowercase().required(),
};

const listValidation = {
  params: Joi.object().keys({}),
};

const setStatusValidation = {
  params: Joi.object().keys(keyParams),
  body: Joi.object().keys({
    // Required rather than defaulted: a switch that forgot its position should be
    // a validation error, not an accidental enable.
    status: Joi.boolean().required(),
    reason: Joi.string().allow('', null).trim(),
  }),
};

module.exports = {
  listValidation,
  setStatusValidation,
};