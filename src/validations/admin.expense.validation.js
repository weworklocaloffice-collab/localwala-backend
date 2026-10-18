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

const saveExpenseValidation = {
  body: Joi.object().keys({
    expenseType: Joi.string()
      .required()
      .valid(
        'it_support_service',
        'ads',
        'employee_expenses',
        'outsource',
        'payment_gateway_charge',
        'other'
      ),
    amount: Joi.number().required(),
  }),
};

const exportValidation = {
  params: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.string()
      .required()
      .allow(
        'all',
        'coupon',
        'delivery_charge',
        'referral',
        'wallet_bonus',
        'loyalty_points',
        'dining_booking_coupon',
        'customer_wallet_credit',
        'it_support_service',
        'ads',
        'employee_expenses',
        'outsource',
        'payment_gateway_charge',
        'other'
      ),
  }),
};

module.exports = {
  saveExpenseValidation,
  exportValidation,
};

