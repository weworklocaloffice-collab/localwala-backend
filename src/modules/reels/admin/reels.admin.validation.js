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
const verticals = ['FOOD', 'DAIRY', 'SERVICES', 'REAL_ESTATE'];
const targetTypes = ['RESTAURANT', 'PRODUCT', 'SERVICE', 'VENDOR', 'PROPERTY'];
const statuses = [
  'DRAFT',
  'PROCESSING',
  'READY',
  'SCHEDULED',
  'PUBLISHED',
  'PAUSED',
  'REJECTED',
  'EXPIRED',
];

const targetSchema = Joi.object().keys({
  type: Joi.string()
    .valid(...targetTypes)
    .required(),
  refId: objectId.required(),
});

const uploadUrlValidation = {
  body: Joi.object().keys({
    contentType: Joi.string().valid('video/mp4').required(),
    sizeBytes: Joi.number()
      .integer()
      .min(1)
      .max(200 * 1024 * 1024)
      .required(),
  }),
};

const uploadProxyValidation = {
  body: Joi.object().keys({
    reelId: Joi.string().hex().length(24).optional(),
    vertical: Joi.string().valid(...verticals).optional(),
    target: Joi.string().optional(),
    caption: Joi.string().trim().max(1000).allow('', null).optional(),
    hashtags: Joi.string().optional(),
    cta: Joi.string().optional(),
    cityId: objectId.optional(),
    localityId: objectId.optional(),
  }),
};

const finalizeValidation = {
  body: Joi.object().keys({
    reelId: objectId.required(),
    key: Joi.string().max(500).required(),
  }),
};

const createReelValidation = {
  body: Joi.object().keys({
    videoUrl: Joi.string().uri().allow('').optional(),
    caption: Joi.string().trim().max(1000).allow('', null).optional(),
    hashtags: Joi.array().items(Joi.string().trim().max(50)).max(20).optional(),
    vertical: Joi.string()
      .valid(...verticals)
      .required(),
    target: targetSchema.required(),
    cta: Joi.object()
      .keys({ label: Joi.string().trim().max(30).required() })
      .optional(),
    // The admin panel urlencodes empty selects as '' — accept it and let the
    // service drop it, otherwise a draft with no location can never save.
    cityId: objectId.allow(null, '').optional(),
    localityId: objectId.allow(null, '').optional(),
  }),
};

const lookupValidation = {
  query: Joi.object().keys({
    targetType: Joi.string().valid('RESTAURANT', 'PRODUCT').required(),
    cityId: objectId.optional(),
    restaurantId: objectId.optional(),
  }),
};

const listReelsValidation = {
  query: Joi.object().keys({
    status: Joi.string()
      .valid(...statuses)
      .optional(),
    vertical: Joi.string()
      .valid(...verticals)
      .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const reelIdValidation = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

const updateReelValidation = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
  body: Joi.object()
    .keys({
      caption: Joi.string().trim().max(1000).allow('', null).optional(),
      hashtags: Joi.array().items(Joi.string().trim().max(50)).max(20).optional(),
      vertical: Joi.string()
        .valid(...verticals)
        .optional(),
      target: targetSchema.optional(),
      cta: Joi.object()
        .keys({ label: Joi.string().trim().max(30).required() })
        .optional(),
      cityId: objectId.allow(null, '').optional(),
      localityId: objectId.allow(null, '').optional(),
      thumbnailUrl: Joi.string().uri().optional(),
    })
    .min(1),
};

const publishValidation = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
  body: Joi.object().keys({
    publishAt: Joi.date().iso().greater('now').optional(),
  }),
};

const listReportsValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const reviewReportValidation = {
  params: Joi.object().keys({
    reportId: objectId.required(),
  }),
  body: Joi.object().keys({
    decision: Joi.string().valid('REVIEWING', 'DISMISS', 'HIDE_REEL', 'REMOVE_REEL').required(),
  }),
};

module.exports = {
  uploadUrlValidation,
  uploadProxyValidation,
  finalizeValidation,
  createReelValidation,
  lookupValidation,
  listReelsValidation,
  reelIdValidation,
  updateReelValidation,
  publishValidation,
  listReportsValidation,
  reviewReportValidation,
};
