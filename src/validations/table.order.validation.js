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

const vendorTableOrderValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorTableOrderDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const adminTableOrderDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const cityzenTableOrderDetailValidation = {
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

const vendorOrderInvoiceValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const exportTableOrderValidation = {
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
  vendorTableOrderValidation,
  vendorTableOrderDetailValidation,
  adminTableOrderDetailValidation,
  vendorBusinessInsightValidation,
  vendorBusinessCustomDateInsightValidation,
  orderInvoiceValidation,
  vendorOrderInvoiceValidation,
  cityzenTableOrderDetailValidation,
  exportTableOrderValidation,
  adminOrderValidation,
  exportValidation,
  cityMasterValidation,
};

