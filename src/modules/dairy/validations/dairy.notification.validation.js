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
const { objectId } = require('../../../validations/custom.validation');

/**
 * Notifications.
 *
 * No `user` key anywhere. The reader is always the signed-in account, so
 * accepting one would only ever contradict the token.
 */

const listValidation = {
  query: Joi.object().keys({
    unreadOnly: Joi.boolean(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const markReadValidation = {
  body: Joi.object().keys({
    // Optional: absent means "everything unread". When present it still filters
    // within the caller's own notices.
    ids: Joi.array().items(Joi.string().custom(objectId)),
  }),
};

const dismissValidation = {
  params: Joi.object().keys({
    notification: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  listValidation,
  markReadValidation,
  dismissValidation,
};