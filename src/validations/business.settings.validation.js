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
    companyName: Joi.string().required(),
    email: Joi.string().required().email(),
    mobile: Joi.string().required(),
    country: Joi.string().required(),
    address: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    timezone: Joi.object().required(),
    timeFormat: Joi.string().required(),
    defaultCountryCode: Joi.object().required(),
    currency: Joi.object().required(),
    currencySide: Joi.string().required(),
    decimalPoint: Joi.number().required(),
    cookiesText: Joi.string().required(),
    commission: Joi.number().required(),
    commissionDelivery: Joi.number().required(),
    haveFreeDeliveryInTotal: Joi.boolean().allow(),
    freeDelivery: Joi.number().allow(),
    haveFreeDeliveryInDistance: Joi.boolean().allow(),
    freeDeliveryInDistance: Joi.number().allow(),
    deliveryChargeMethod: Joi.string().required().allow('distance', 'fixed'),
    deliveryChargeAmount: Joi.number().required(),
    vegNonVegOption: Joi.boolean().allow(),
    commissionBasedSystem: Joi.boolean().allow(),
    subscriptionBasedSystem: Joi.boolean().allow(),
    includeTaxOnFood: Joi.boolean().allow(),
    foodTaxName: Joi.string().allow('', null),
    foodTaxAmount: Joi.number().allow('', null),
    foodTaxType: Joi.string().allow('per', 'fixed'),
    receiveNotificationAdmin: Joi.boolean().allow(),
    additionalServiceCharge: Joi.boolean().allow('', null),
    additionalServiceName: Joi.string().allow('', null),
    additionalServiceAmount: Joi.number().allow('', null),
    partialPayment: Joi.boolean().allow(),
    partialAmountPayment: Joi.string().allow('', null),
    guestCheckout: Joi.boolean().allow(),
    logo: Joi.string().required(),
    favicon: Joi.string().required(),
    maintenance: Joi.boolean().allow(),
    findMode: Joi.string().allow('km', 'mile'),
    deliveryArea: Joi.number().required(),
    socialLinks: Joi.object().allow(),
    refundRequest: Joi.boolean().allow(),
    websiteUrl: Joi.string().required(),
    otpType: Joi.string().allow('num', 'numstr', 'str'),
    canResendOtp: Joi.boolean().allow(),
    otpLength: Joi.number().allow(4, 6, 8),
    foodLicenseImage: Joi.string().allow('', null),
    foodLicenseName: Joi.string().allow('', null),
    foodLicenseWebsite: Joi.string().allow('', null),
    foodLicense: Joi.string().allow('', null),
    complianceForm: Joi.allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    businessId: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createSettings,
  idValidation,
};

