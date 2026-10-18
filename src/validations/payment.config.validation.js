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

const createPaymentConfig = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    slug: Joi.string().required(),
    image: Joi.string().required(),
    environment: Joi.boolean().required(),
    credentials: Joi.object().required(),
    translations: Joi.allow(),
    paymentWay: Joi.string().allow('online', 'offline'),
    isDefault: Joi.boolean().required(),
    status: Joi.boolean().required(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    slug: Joi.string(),
  }),
};

const allPaymentValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    filter: Joi.boolean(),
    status: Joi.string().allow(null, '').valid('initiated', 'paid', 'cancelled'),
    kind: Joi.string()
      .allow(null, '')
      .valid(
        'order',
        'wallet',
        'tiffinsubscription',
        'booking',
        'restaurant_register',
        'renew_subscription'
      ),
    filterDates: Joi.string().allow(null, ''),
    search: Joi.string().allow(null, ''),
  }),
};

const exportPaymentValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    status: Joi.string().allow(null, '').valid('initiated', 'paid', 'cancelled'),
    kind: Joi.string()
      .allow(null, '')
      .valid(
        'order',
        'wallet',
        'tiffinsubscription',
        'booking',
        'restaurant_register',
        'renew_subscription'
      ),
    filterDates: Joi.string().allow(null, ''),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  createPaymentConfig,
  idValidation,
  allPaymentValidation,
  exportPaymentValidation,
};

