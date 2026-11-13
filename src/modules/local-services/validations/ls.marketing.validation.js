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
 * modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const placement = Joi.string().valid('home', 'search', 'category');
const durationHours = Joi.number().valid(1, 3, 6, 12, 24, 168, 720);

const pageQuery = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
};

const packageListQuery = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    status: Joi.boolean(),
    placement,
    activeOnly: Joi.boolean(),
  }),
};

const packageBody = {
  body: Joi.object()
    .keys({
      code: Joi.string().trim().uppercase().max(32).required(),
      name: Joi.string().trim().max(80).required(),
      placement: placement.required(),
      targetingLevel: Joi.string().valid('locality', 'pincode', 'city').required(),
      durationHours: durationHours.required(),
      price: Joi.number().min(0).precision(2).required(),
      maxConcurrent: Joi.number().integer().min(1).max(20),
      status: Joi.boolean(),
    })
    .unknown(false),
};

const updatePackageBody = {
  params: Joi.object().keys({ packageId: objectId.required() }),
  body: Joi.object()
    .keys({
      code: Joi.string().trim().uppercase().max(32),
      name: Joi.string().trim().max(80),
      placement,
      targetingLevel: Joi.string().valid('locality', 'pincode', 'city'),
      durationHours,
      price: Joi.number().min(0).precision(2),
      maxConcurrent: Joi.number().integer().min(1).max(20),
      status: Joi.boolean(),
    })
    .min(1)
    .unknown(false),
};

const campaignCreateBody = {
  body: Joi.object()
    .keys({
      package: objectId.required(),
      caption: Joi.string().trim().max(100).required(),
      startsAt: Joi.date().iso().required(),
      localities: Joi.array().items(Joi.string().trim().max(80)).max(50),
      pincodes: Joi.array().items(Joi.string().trim().pattern(/^[1-9][0-9]{5}$/)).max(50),
      city: Joi.string().trim().max(80),
      categoryKey: Joi.string().trim().lowercase().max(64),
      service: objectId.allow(null),
    })
    .or('localities', 'pincodes', 'city')
    .unknown(false),
};

const campaignListQuery = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    status: Joi.string().valid(
      'pending_review',
      'rejected',
      'approved_unpaid',
      'scheduled',
      'live',
      'paused',
      'completed',
      'cancelled'
    ),
    paymentStatus: Joi.string().valid('unpaid', 'initiated', 'paid', 'refunded'),
  }),
};

const campaignIdParam = {
  params: Joi.object().keys({ campaign: objectId.required() }),
};

const campaignPayBody = {
  params: Joi.object().keys({ campaign: objectId.required() }),
  body: Joi.object()
    .keys({
      paymentConfigId: objectId,
      paymentRef: Joi.string().trim().max(120),
    })
    .unknown(false),
};

const campaignReviewBody = {
  params: Joi.object().keys({ campaign: objectId.required() }),
  body: Joi.object()
    .keys({
      decision: Joi.string().valid('approve', 'reject').required(),
      note: Joi.string().trim().max(500).allow(''),
    })
    .unknown(false),
};

const campaignStatusBody = {
  params: Joi.object().keys({ campaign: objectId.required() }),
  body: Joi.object()
    .keys({ action: Joi.string().valid('pause', 'resume', 'cancel').required() })
    .unknown(false),
};

const featuredQuery = {
  query: Joi.object()
    .keys({
      locality: Joi.string().trim().max(80),
      pincode: Joi.string().trim().pattern(/^[1-9][0-9]{5}$/),
      city: Joi.string().trim().max(80),
      placement,
      categoryKey: Joi.string().trim().lowercase().max(64),
      limit: Joi.number().integer().min(1).max(100),
    })
    .or('locality', 'pincode', 'city'),
};

const eventBody = {
  params: Joi.object().keys({ campaign: objectId.required() }),
  body: Joi.object()
    .keys({
      type: Joi.string().valid('impression', 'click').required(),
      locality: Joi.string().trim().max(80),
      pincode: Joi.string().trim().pattern(/^[1-9][0-9]{5}$/),
      city: Joi.string().trim().max(80),
    })
    .or('locality', 'pincode', 'city')
    .unknown(false),
};

module.exports = {
  pageQuery,
  packageListQuery,
  packageBody,
  updatePackageBody,
  campaignCreateBody,
  campaignListQuery,
  campaignIdParam,
  campaignPayBody,
  campaignReviewBody,
  campaignStatusBody,
  featuredQuery,
  eventBody,
};
