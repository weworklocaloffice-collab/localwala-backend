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

const createOrderSettings = {
  body: Joi.object().keys({
    deliveryVerification: Joi.boolean().allow(),
    homeDelivery: Joi.boolean().allow(),
    takeaway: Joi.boolean().allow(),
    repeatOrderOption: Joi.boolean().allow(),
    subscriptionOrder: Joi.boolean().allow(),
    includeChargesForSubscription: Joi.boolean().allow(),
    restaurantCanCancelTiffinSubscriptionPackage: Joi.boolean().allow(),
    userCanCancelTiffinSubscriptionPackage: Joi.boolean().allow(),
    scheduleDelivery: Joi.boolean().allow(),
    restaurantCanCancelOrder: Joi.boolean().allow(),
    driverCanCancelOrder: Joi.boolean().allow(),
    orderConfirmationModel: Joi.string().allow(),
    ratingStyle: Joi.string().allow('emoji', 'star'),
    timeIntervalForScheduleDelivery: Joi.object().allow(),
    instantOrder: Joi.boolean().allow(),
    customerOrderDate: Joi.boolean().allow(),
    customerCanOrderWithinDays: Joi.number().allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    settingId: Joi.string().custom(objectId),
  }),
};

const settingValidation = {
  body: Joi.object().keys({
    userId: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
    deliveryAddressId: Joi.string().custom(objectId).allow('', null),
    userLatitude: Joi.number().required(),
    userLongitude: Joi.number().required(),
    trackingId: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  createOrderSettings,
  idValidation,
  settingValidation,
};

