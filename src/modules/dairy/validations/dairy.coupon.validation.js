const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

const page = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

module.exports = {
  quoteValidation: { body: Joi.object({ code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]{2,40}$/).required() }) },
  partnerListValidation: { query: Joi.object({ status: Joi.string().valid('pending_review', 'active', 'rejected', 'disabled', 'expired') }) },
  createValidation: {
    body: Joi.object({
      code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]{2,40}$/).required(),
      title: Joi.string().trim().min(2).max(100).required(),
      description: Joi.string().trim().max(500).allow('').default(''),
      discountType: Joi.string().valid('percentage', 'fixed').required(),
      discountValue: Joi.number().greater(0).precision(2).required(),
      minOrderAmount: Joi.number().min(0).precision(2).default(0),
      maxDiscountAmount: Joi.number().greater(0).precision(2).when('discountType', { is: 'percentage', then: Joi.required(), otherwise: Joi.optional() }),
      startsAt: Joi.date().iso().required(),
      endsAt: Joi.date().iso().greater(Joi.ref('startsAt')).required(),
      maxRedemptions: Joi.number().integer().min(1).allow(null).default(null),
    }),
  },
  disableValidation: {
    params: Joi.object({ coupon: Joi.string().custom(objectId).required() }),
  },
  partnerReportValidation: {
    params: Joi.object({ coupon: Joi.string().custom(objectId).required() }),
    query: Joi.object({
      from: Joi.date().iso(),
      to: Joi.date().iso().greater(Joi.ref('from')),
    }).with('from', 'to').with('to', 'from'),
  },
  adminListValidation: {
    query: Joi.object({ ...page, status: Joi.string().valid('pending_review', 'active', 'rejected', 'disabled', 'expired') }),
  },
  reviewValidation: {
    params: Joi.object({ coupon: Joi.string().custom(objectId).required() }),
    body: Joi.object({ decision: Joi.string().valid('approve', 'reject').required(), note: Joi.string().trim().max(500).allow('').default('') }),
  },
};
