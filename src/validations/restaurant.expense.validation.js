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

const saveExpenseValidation = {
  body: Joi.object().keys({
    expenseType: Joi.string().required().valid('other'),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    amount: Joi.number().required(),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    exportType: Joi.string().required().valid('excel', 'csv', 'raw'),
    type: Joi.string().valid(
      'all',
      'order_product_discout',
      'pos_order_product_discount',
      'table_order_product_discount',
      'pos_order_extra_discount',
      'table_order_extra_discount',
      'coupon',
      'dining_coupon',
      'dining_booking_discount',
      'refund_order',
      'other'
    ),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  saveExpenseValidation,
  exportValidation,
};

