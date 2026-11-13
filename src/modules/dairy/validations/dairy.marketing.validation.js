const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

const pageQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const packageBody = {
  name: Joi.string().trim().min(2).max(80).required(),
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]{2,40}$/).required(),
  placement: Joi.string().valid('dairy_home_banner', 'featured_partner', 'featured_product').required(),
  targetingLevel: Joi.string().valid('locality', 'zone', 'city').required(),
  durationHours: Joi.number().integer().valid(1, 3, 6, 12, 24, 168, 720).required(),
  price: Joi.number().min(0.01).precision(2).required(),
  maxConcurrent: Joi.number().integer().min(1).max(20).default(1),
  status: Joi.boolean().default(true),
};

const packageId = Joi.object({ package: Joi.string().custom(objectId).required() });
const campaignId = Joi.object({ campaign: Joi.string().custom(objectId).required() });

module.exports = {
  packageCreateValidation: { body: Joi.object(packageBody) },
  packageUpdateValidation: {
    params: packageId,
    body: Joi.object(packageBody).fork(['name', 'code', 'placement', 'targetingLevel', 'durationHours', 'price'], (s) => s.optional()).min(1),
  },
  packageListValidation: {
    query: pageQuery.keys({
      status: Joi.string().valid('true', 'false'),
      placement: Joi.string().valid('dairy_home_banner', 'featured_partner', 'featured_product'),
    }),
  },
  campaignCreateValidation: {
    body: Joi.object({
      package: Joi.string().custom(objectId).required(),
      caption: Joi.string().trim().min(2).max(100).required(),
      startsAt: Joi.date().iso().required(),
      localities: Joi.array().items(Joi.string().custom(objectId)).min(1).max(50).unique().required(),
      zone: Joi.string().custom(objectId).allow('', null),
      product: Joi.string().custom(objectId).allow('', null),
    }),
  },
  campaignListValidation: {
    query: pageQuery.keys({
      status: Joi.string().valid('pending_review', 'rejected', 'approved_unpaid', 'scheduled', 'live', 'paused', 'completed', 'cancelled'),
      paymentStatus: Joi.string().valid('unpaid', 'initiated', 'paid', 'refunded'),
    }),
  },
  campaignPayValidation: {
    params: campaignId,
    body: Joi.object({ payment: Joi.string().custom(objectId).allow('', null) }),
  },
  campaignReviewValidation: {
    params: campaignId,
    body: Joi.object({
      decision: Joi.string().valid('approve', 'reject').required(),
      note: Joi.string().trim().max(500).allow('', null),
    }),
  },
  featuredValidation: {
    query: Joi.object({
      address: Joi.string().custom(objectId).required(),
      placement: Joi.string().valid('dairy_home_banner', 'featured_partner', 'featured_product'),
    }),
  },
  eventValidation: {
    params: campaignId,
    body: Joi.object({
      address: Joi.string().custom(objectId).required(),
      type: Joi.string().valid('impression', 'click').required(),
    }),
  },
};
