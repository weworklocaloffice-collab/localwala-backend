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

const createOrUpdateAppWebSettings = {
  body: Joi.object().keys({
    showPopularFood: Joi.boolean().allow(),
    showMostReviewedFood: Joi.boolean().allow(),
    showTodaysTrendingFood: Joi.boolean().allow(),
    showPopularRestaurant: Joi.boolean().allow(),
    showNewRestaurant: Joi.boolean().allow(),
    showTiffinSubscriptionPackages: Joi.boolean().allow(),
    showPopularDiningRestaurant: Joi.boolean().allow(),
    showNewDiningRestaurant: Joi.boolean().allow(),

    reelsGuestLimit: Joi.number().integer().min(0).max(100).allow(null),

    userAndroidForceUpdateVersion: Joi.string().required(),
    userAndroidUpdateUrl: Joi.string().required(),
    useriOSForceUpdateVersion: Joi.string().required(),
    useriOSUpdateUrl: Joi.string().required(),

    vendorAndroidForceUpdateVersion: Joi.string().required(),
    vendorAndroidUpdateUrl: Joi.string().required(),
    vendoriOSForceUpdateVersion: Joi.string().required(),
    vendoriOSUpdateUrl: Joi.string().required(),

    deliveryManAndroidForceUpdateVersion: Joi.string().required(),
    deliveryManAndroidUpdateUrl: Joi.string().required(),
    deliveryManiOSForceUpdateVersion: Joi.string().required(),
    deliveryManiOSUpdateUrl: Joi.string().required(),

    waiterAndroidForceUpdateVersion: Joi.string().required(),
    waiterAndroidUpdateUrl: Joi.string().required(),
    waiteriOSForceUpdateVersion: Joi.string().required(),
    waiteriOSUpdateUrl: Joi.string().required(),

    kitchenAndroidForceUpdateVersion: Joi.string().required(),
    kitchenAndroidUpdateUrl: Joi.string().required(),
    kitcheniOSForceUpdateVersion: Joi.string().required(),
    kitcheniOSUpdateUrl: Joi.string().required(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createOrUpdateAppWebSettings,
  idValidation,
};

