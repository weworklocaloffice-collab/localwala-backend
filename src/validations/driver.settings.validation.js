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

const createSettings = {
  body: Joi.object().keys({
    driverLoginWith: Joi.string()
      .valid('email_password', 'phone_password', 'phone_otp', 'email_otp')
      .allow(),
    driverResetPasswordWith: Joi.string().valid('phone_otp', 'email_otp').allow(),
    selfRegistration: Joi.boolean().allow(),
    cashInHand: Joi.boolean().allow(),
    minCashInHand: Joi.number().allow(),
    maxCashInHand: Joi.number().allow(),
    getTip: Joi.boolean().allow(),
    showEarning: Joi.boolean().allow(),
    maxOrderLimit: Joi.number().allow(),
    pickupProof: Joi.boolean().allow(),
    deliveryProof: Joi.boolean().allow(),
    canInitiateChat: Joi.boolean().allow(),
    canInitiateCall: Joi.boolean().allow(),
    earningModel: Joi.string().required().allow('salaried', 'order'),
    salaryAmount: Joi.number().allow(),
    earningOnOrder: Joi.string().allow('fixed', 'distance'),
    distanceRadiusForFixed: Joi.number().allow(),
    earningFixedDistanceAmount: Joi.number().allow(),
    earningAmount: Joi.number().allow(),
    earningSurplusDistanceAmount: Joi.number().allow(),
    haveIncentive: Joi.boolean().allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    settingId: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createSettings,
  idValidation,
};

