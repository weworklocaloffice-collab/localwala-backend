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

const objectId = Joi.string().hex().length(24);

const feedValidation = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
    sortBy: Joi.string().default('createdAt:desc'),
  }),
};

const reelIdParam = {
  params: Joi.object().keys({
    reelId: objectId.required(),
  }),
};

const commentValidation = {
  params: Joi.object().keys({
    reelId: objectId.required(),
  }),
  body: Joi.object().keys({
    content: Joi.string().trim().min(1).max(500).required(),
  }),
};

const viewValidation = {
  params: Joi.object().keys({
    reelId: objectId.required(),
  }),
  body: Joi.object().keys({
    watchedMs: Joi.number().min(0).max(3600000).default(0),
    completed: Joi.boolean().default(false),
  }),
};

const reportValidation = {
  params: Joi.object().keys({
    reelId: objectId.required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string()
      .valid('SPAM', 'INAPPROPRIATE', 'MISLEADING', 'COPYRIGHT', 'OTHER')
      .required(),
    details: Joi.string().trim().max(500).allow('', null),
  }),
};

module.exports = {
  feedValidation,
  reelIdParam,
  commentValidation,
  viewValidation,
  reportValidation,
};
