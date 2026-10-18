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

const vendorPlaceOrderValidation = {
  body: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required().allow(null, ''),
    paymentMode: Joi.string().required().valid('online', 'offline'),
    customerType: Joi.string().required().valid('guest', 'regular'),
    customerName: Joi.string().required().allow(null, 'none'),
    customerCountryCode: Joi.string().required(),
    customerMobileNumber: Joi.string().allow(null, ''),
    cartItemRaw: Joi.string().required(),
    discountType: Joi.string().required().valid('per', 'amount'),
    discountAmount: Joi.number().required().allow(0),
    foodServiceCharge: Joi.number().required().allow(0),
    serviceCharge: Joi.number().required().allow(0),
    packageCharge: Joi.number().required().allow(0),
    packageChargeTax: Joi.number().required().allow(0),
    extraCharge: Joi.number().required().allow(0),
  }),
};

const vendorPosOrderValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorPosOrderDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const adminPosOrderDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const cityzenPosOrderDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const vendorBusinessInsightValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorBusinessCustomDateInsightValidation = {
  body: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    startDate: Joi.string().required(),
    endDate: Joi.string().required(),
  }),
};

const orderInvoiceValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const vendorInvoiceValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const exportPOSOrderValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    restaurant: Joi.string().allow(null, ''),
    filterDates: Joi.string().allow(null, ''),
    search: Joi.string().allow(null, ''),
  }),
};

const adminOrderValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
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
  }),
};

module.exports = {
  vendorPlaceOrderValidation,
  vendorPosOrderValidation,
  vendorPosOrderDetailValidation,
  adminPosOrderDetailValidation,
  vendorBusinessInsightValidation,
  vendorBusinessCustomDateInsightValidation,
  orderInvoiceValidation,
  vendorInvoiceValidation,
  cityzenPosOrderDetailValidation,
  exportPOSOrderValidation,
  adminOrderValidation,
  exportValidation,
  cityMasterValidation,
};

