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

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const createHold = {
  body: Joi.object().keys({
    property: objectId.required(),
    lead: objectId.allow(null).optional(),
  }),
};

const holdParams = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const convertToSale = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    saleValue: Joi.number().positive().required(),
    transactionType: Joi.string().valid('BUY', 'RENT').optional(),
  }),
};

// POST /holds/:id/pay — gateway selection is optional; the service
// falls back to the default online PaymentConfig.
const payHold = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    payment: objectId.optional(),
  }),
};

module.exports = {
  createHold,
  holdParams,
  convertToSale,
  payHold,
};
