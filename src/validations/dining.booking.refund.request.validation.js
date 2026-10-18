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
const { objectId } = require('./custom.validation');

const saveRefundRequestValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    booking: Joi.string().custom(objectId).required(),
    reason: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
    payment: Joi.string().custom(objectId).required(),
  }),
};

const adminListValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
    status: Joi.string().valid('all', 'initiated', 'refunded', 'partially_refunded', 'cancelled'),
  }),
};

const getRefundRequestInfoValidation = {
  params: Joi.object().keys({
    requestId: Joi.string().custom(objectId).required(),
  }),
};

const cancelRefundRequestValidation = {
  body: Joi.object().keys({
    requestId: Joi.string().custom(objectId).required(),
    cancelReason: Joi.string().required(),
  }),
};

const refundFromMerchantValidation = {
  body: Joi.object().keys({
    requestId: Joi.string().custom(objectId).required(),
  }),
};

const approveRefundRequestValidation = {
  body: Joi.object().keys({
    requestId: Joi.string().custom(objectId).required(),
    bookingId: Joi.string().custom(objectId).required(),
    refundTo: Joi.string().required().allow('wallet', 'payment'),
    refundType: Joi.string().required().allow('full', 'partial'),
    refundAmount: Joi.number().allow(null, '', 0),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.string()
      .required()
      .allow('all', 'initiated', 'refunded', 'partially_refunded', 'cancelled'),
    search: Joi.string().allow(null, ''),
  }),
};

const cityMasterValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
    status: Joi.string().valid('all', 'initiated', 'refunded', 'partially_refunded', 'cancelled'),
  }),
};

module.exports = {
  saveRefundRequestValidation,
  adminListValidation,
  getRefundRequestInfoValidation,
  cancelRefundRequestValidation,
  refundFromMerchantValidation,
  approveRefundRequestValidation,
  exportValidation,
  cityMasterValidation,
};

