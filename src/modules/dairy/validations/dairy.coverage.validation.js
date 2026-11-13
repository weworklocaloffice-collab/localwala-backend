const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

const requestCreateValidation = {
  body: Joi.object().keys({
    localityIds: Joi.array().items(Joi.string().custom(objectId)).min(1).max(50).unique().required(),
    message: Joi.string().trim().max(500).allow('', null),
  }),
};
const requestListValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid('pending', 'approved', 'rejected', 'partially_approved'),
    city: Joi.string().custom(objectId),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
};
const requestReviewValidation = {
  params: Joi.object().keys({ request: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({
    localityId: Joi.string().custom(objectId),
    decision: Joi.string().valid('approved', 'rejected').required(),
    note: Joi.string().trim().max(500).allow('', null),
  }),
};

module.exports = {
  requestCreateValidation,
  requestListValidation,
  requestReviewValidation,
};
