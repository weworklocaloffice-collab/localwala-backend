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
const { password, objectId } = require('./custom.validation');

const itemFormElementSchema = Joi.object({
  name: Joi.string().required(),
  value: Joi.boolean().required(),
});

const formElementSchema = Joi.object({
  fieldName: Joi.string().required(),
  fieldType: Joi.string().required(),
  fieldValue: Joi.string().required(),
  fieldItems: Joi.array().items(itemFormElementSchema).min(0),
});

const createRequestValidation = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    name: Joi.string().required(),
    address: Joi.string().required(),
    shortDescription: Joi.string().required(),
    cuisine: Joi.string().required(),
    logo: Joi.string().required(),
    cover: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null, ''),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    locationType: Joi.string().required(),
    approxDeliveryTime: Joi.string().required(),
    dishPriceForTwo: Joi.number().required(),
    takeAway: Joi.boolean().allow(),
    translations: Joi.array().allow(),
    restaurantType: Joi.string().required(),
    restaurantFacility: Joi.string().required(),
    acceptScheduleDelivery: Joi.boolean().required(),
    acceptHomeDelivery: Joi.boolean().required(),
    minOrderAmount: Joi.number().required(),
    license: Joi.string().custom(objectId).allow(null, ''),
    licenseId: Joi.string().allow('', null),
    socialFacebook: Joi.string().allow('', null),
    socialInstagram: Joi.string().allow('', null),
    socialX: Joi.string().allow('', null),
    socialYoutube: Joi.string().allow('', null),
    socialLinkedIn: Joi.string().allow('', null),
    socialPinterest: Joi.string().allow('', null),
    businessType: Joi.string().required().valid('commission', 'subscription'),
    subscriptionId: Joi.string().allow('', null),
    paymentId: Joi.string().allow('', null),
    formElement: Joi.array().items(formElementSchema),
    locale: Joi.string().allow(null, ''),
    redirect: Joi.string().allow(null, ''),
  }),
};

const statusValidation = {
  params: Joi.object().keys({
    status: Joi.string().valid('all', 'subscription', 'commission').required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenStatusValidation = {
  params: Joi.object().keys({
    status: Joi.string().valid('all', 'subscription', 'commission').required(),
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const rejectValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    rejection: Joi.string().required(),
  }),
};

const approveValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    name: Joi.string().required(),
    address: Joi.string().required(),
    shortDescription: Joi.string().required(),
    cuisine: Joi.string().required(),
    logo: Joi.string().required(),
    cover: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    locationType: Joi.string().required(),
    type: Joi.string().required().valid('commission', 'subscription'),
    commission: Joi.number().allow(null),
    posOrderCommission: Joi.number().allow(null),
    tableOrderCommission: Joi.number().allow(null),
    subscription: Joi.string().custom(objectId).allow(null, ''),
    approxDeliveryTime: Joi.string().required(),
    dishPriceForTwo: Joi.number().required(),
    pos: Joi.boolean().required(),
    ownDriver: Joi.boolean().required(),
    promote: Joi.boolean().required(),
    customCategory: Joi.boolean().required(),
    multiOutlet: Joi.boolean().required(),
    preBooking: Joi.boolean().required(),
    tableOrder: Joi.boolean().required(),
    tiffinSubscription: Joi.boolean().required(),
    ownWaiter: Joi.boolean().required(),
    ownKitchen: Joi.boolean().required(),
    takeAway: Joi.boolean().allow(),
    orderLimit: Joi.number().required(),
    productLimit: Joi.number().required(),
    translations: Joi.array().allow(),
    slots: Joi.array().allow(),
    restaurantType: Joi.string().required(),
    restaurantFacility: Joi.string().required(),
    acceptScheduleDelivery: Joi.boolean().required(),
    acceptHomeDelivery: Joi.boolean().required(),
    minOrderAmount: Joi.number().required(),
    license: Joi.string().custom(objectId).allow(null, ''),
    licenseId: Joi.string().allow('', null),
    socialFacebook: Joi.string().allow('', null),
    socialInstagram: Joi.string().allow('', null),
    socialX: Joi.string().allow('', null),
    socialYoutube: Joi.string().allow('', null),
    socialLinkedIn: Joi.string().allow('', null),
    socialPinterest: Joi.string().allow('', null),
  }),
};

const cityzenApproveValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    master: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    name: Joi.string().required(),
    address: Joi.string().required(),
    shortDescription: Joi.string().required(),
    cuisine: Joi.string().required(),
    logo: Joi.string().required(),
    cover: Joi.string().required(),
    locality: Joi.string().custom(objectId).allow(null),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    locationType: Joi.string().required(),
    type: Joi.string().required().valid('commission', 'subscription'),
    commission: Joi.number().allow(null),
    posOrderCommission: Joi.number().allow(null),
    tableOrderCommission: Joi.number().allow(null),
    subscription: Joi.string().custom(objectId).allow(null, ''),
    approxDeliveryTime: Joi.string().required(),
    dishPriceForTwo: Joi.number().required(),
    pos: Joi.boolean().required(),
    ownDriver: Joi.boolean().required(),
    promote: Joi.boolean().required(),
    customCategory: Joi.boolean().required(),
    multiOutlet: Joi.boolean().required(),
    preBooking: Joi.boolean().required(),
    tableOrder: Joi.boolean().required(),
    tiffinSubscription: Joi.boolean().required(),
    ownWaiter: Joi.boolean().required(),
    ownKitchen: Joi.boolean().required(),
    takeAway: Joi.boolean().allow(),
    orderLimit: Joi.number().required(),
    productLimit: Joi.number().required(),
    translations: Joi.array().allow(),
    slots: Joi.array().allow(),
    restaurantType: Joi.string().required(),
    restaurantFacility: Joi.string().required(),
    acceptScheduleDelivery: Joi.boolean().required(),
    acceptHomeDelivery: Joi.boolean().required(),
    minOrderAmount: Joi.number().required(),
    license: Joi.string().custom(objectId).allow(null, ''),
    licenseId: Joi.string().allow('', null),
    socialFacebook: Joi.string().allow('', null),
    socialInstagram: Joi.string().allow('', null),
    socialX: Joi.string().allow('', null),
    socialYoutube: Joi.string().allow('', null),
    socialLinkedIn: Joi.string().allow('', null),
    socialPinterest: Joi.string().allow('', null),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.string().valid('all', 'subscription', 'commission').required(),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  createRequestValidation,
  statusValidation,
  idValidation,
  rejectValidation,
  approveValidation,
  cityzenStatusValidation,
  cityzenApproveValidation,
  exportValidation,
};

