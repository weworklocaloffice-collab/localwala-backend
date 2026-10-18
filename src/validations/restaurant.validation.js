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
const { password, objectId, latitude, longitude } = require('./custom.validation');

const createVendor = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    userId: Joi.string().custom(objectId),
    name: Joi.string().required(),
    address: Joi.string().required(),
    shortDescription: Joi.string().required(),
    cuisine: Joi.string().required(),
    logo: Joi.string().required(),
    cover: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null),
    latitude,
    longitude,
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
    isOutlet: Joi.boolean().allow(),
    outletManagerId: Joi.string().custom(objectId).allow(null, ''),
    orderLimit: Joi.number().required(),
    productLimit: Joi.number().required(),
    translations: Joi.array().allow(),
    slots: Joi.array().allow(),
    restaurantType: Joi.string().required(),
    restaurantFacility: Joi.string().required(),
    temporaryClosed: Joi.boolean().required(),
    acceptScheduleDelivery: Joi.boolean().required(),
    acceptHomeDelivery: Joi.boolean().required(),
    minOrderAmount: Joi.number().required(),
    // Optional delivery radius in metres. Shrink-only: the service caps it at
    // the city default, so signup can narrow coverage but never widen it.
    deliveryRadiusMeters: Joi.number().integer().min(100).max(50000).allow(null, ''),
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

const allValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenCreateVendor = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    userId: Joi.string().custom(objectId),
    name: Joi.string().required(),
    address: Joi.string().required(),
    shortDescription: Joi.string().required(),
    cuisine: Joi.string().required(),
    logo: Joi.string().required(),
    cover: Joi.string().required(),
    locality: Joi.string().custom(objectId).allow(null),
    latitude,
    longitude,
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
    isOutlet: Joi.boolean().allow(),
    outletManagerId: Joi.string().custom(objectId).allow(null, ''),
    orderLimit: Joi.number().required(),
    productLimit: Joi.number().required(),
    translations: Joi.array().allow(),
    slots: Joi.array().allow(),
    restaurantType: Joi.string().required(),
    restaurantFacility: Joi.string().required(),
    temporaryClosed: Joi.boolean().required(),
    acceptScheduleDelivery: Joi.boolean().required(),
    acceptHomeDelivery: Joi.boolean().required(),
    minOrderAmount: Joi.number().required(),
    // Optional delivery radius in metres. Shrink-only: the service caps it at
    // the city default, so signup can narrow coverage but never widen it.
    deliveryRadiusMeters: Joi.number().integer().min(100).max(50000).allow(null, ''),
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

const createOutlet = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    managerId: Joi.string().custom(objectId).required(),
    name: Joi.string().required(),
    shortDescription: Joi.string().required(),
    address: Joi.string().required(),
    cuisine: Joi.string().required(),
    logo: Joi.string().required(),
    cover: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null, ''),
    latitude,
    longitude,
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
  }),
};

const idValidation = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).required(),
  }),
};

const cityzenUpdateValidation = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).required(),
    master: Joi.string().custom(objectId).required(),
  }),
};

const cityIdValidation = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId).required(),
  }),
};

const slotUpdateValidation = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).required(),
  }),
};

const restaurantByCityIdLimitedDetailsValidation = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId).required(),
  }),
};

const getVendorDiningInformation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const restaurantExtraInformation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateDiningInformation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    categories: Joi.string().required(),
    menu: Joi.array().allow(),
    photos: Joi.array().allow(),
  }),
};

const updateMenuAndPhotoInformation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    menu: Joi.array().allow(),
    photos: Joi.array().allow(),
  }),
};

const getRestaurantInfoForDirectReviewValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const globalRestaurantSearchForReviewValidation = {
  body: Joi.object().keys({
    searchQuery: Joi.string().required(),
  }),
};

const getRestaurantDetailForUpdateAppValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateRestaurantDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    name: Joi.string().required(),
    shortDescription: Joi.string().required(),
    address: Joi.string().required(),
    cuisine: Joi.string().required(),
    logo: Joi.string().required(),
    cover: Joi.string().required(),
    deliveryTime: Joi.string().required(),
    dishPriceForTwo: Joi.number().required(),
    takeaway: Joi.boolean().allow(),
    translations: Joi.array().allow(),
    type: Joi.string().required(),
    facility: Joi.string().required(),
    scheduleOrder: Joi.boolean().required(),
    homeDelivery: Joi.boolean().required(),
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

const getOutletDetailForAppValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
  }),
};

const temporaryClosedValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const vendorWalletValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorCashInHandValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorCollectedCashInHandValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const collectCashValidation = {
  body: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    method: Joi.string().required(),
    reference: Joi.string().required(),
  }),
};

const posDataValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const posInitialFoodValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const posFoodSearchValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    searchQuery: Joi.string().required(),
  }),
};

const posFoodListWebValidation = {
  body: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    kind: Joi.string().required().valid('all', 'main', 'custom'),
    category: Joi.string().custom(objectId).required().allow(null, ''),
  }),
};

const vendorSubscriptionValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const renewSubscriptionValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    payment: Joi.string().custom(objectId).required(),
    subscriber: Joi.string().custom(objectId).required(),
    packageId: Joi.string().custom(objectId).required(),
  }),
};

const vendorInformationValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const cityMapDialogValidation = {
  params: Joi.object().keys({
    city: Joi.string().custom(objectId).required(),
  }),
};

const coverageCheckValidation = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    latitude,
    longitude,
    locality: Joi.string().custom(objectId).allow(null, ''),
  }),
};

const filterValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    kind: Joi.string().valid('categories', 'cuisine', 'facilities', 'types').required(),
  }),
};

const filterQueryValidation = {
  body: Joi.object().keys({
    city: Joi.string().custom(objectId).allow(null, ''),
    cuisine: Joi.string().custom(objectId).allow(null, ''),
    category: Joi.string().custom(objectId).allow(null, ''),
    facility: Joi.string().custom(objectId).allow(null, ''),
    type: Joi.string().custom(objectId).allow(null, ''),
  }),
};

const cityzenFilterQueryValidation = {
  body: Joi.object().keys({
    cuisine: Joi.string().custom(objectId).allow(null, ''),
    category: Joi.string().custom(objectId).allow(null, ''),
    facility: Joi.string().custom(objectId).allow(null, ''),
    type: Joi.string().custom(objectId).allow(null, ''),
    master: Joi.string().custom(objectId).required(),
  }),
};

const supportTeamRestaurantValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
  }),
};

const exportFilterValidation = {
  params: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    id: Joi.string().custom(objectId).required(),
    kind: Joi.string().valid('categories', 'cuisine', 'facilities', 'types').required(),
  }),
};

const exportFilterQueryValidation = {
  query: Joi.object().keys({
    exportType: Joi.string().required().valid('excel', 'csv', 'raw'),
    city: Joi.string().custom(objectId).allow(null, ''),
    cuisine: Joi.string().custom(objectId).allow(null, ''),
    category: Joi.string().custom(objectId).allow(null, ''),
    facility: Joi.string().custom(objectId).allow(null, ''),
    type: Joi.string().custom(objectId).allow(null, ''),
  }),
};

const exportReportValidation = {
  query: Joi.object().keys({
    exportType: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    search: Joi.string().allow(null, ''),
    city: Joi.string().custom(objectId).allow(null, ''),
    type: Joi.string().allow(null, '').valid('commission', 'subscription', 'derived'),
    category: Joi.string().custom(objectId).allow(null, ''),
  }),
};

const cityMasterValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const userTableQrMenuValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
    table: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  createVendor,
  createOutlet,
  idValidation,
  cityIdValidation,
  slotUpdateValidation,
  restaurantByCityIdLimitedDetailsValidation,
  getVendorDiningInformation,
  updateDiningInformation,
  getRestaurantInfoForDirectReviewValidation,
  globalRestaurantSearchForReviewValidation,
  restaurantExtraInformation,
  updateMenuAndPhotoInformation,
  getRestaurantDetailForUpdateAppValidation,
  updateRestaurantDetailValidation,
  getOutletDetailForAppValidation,
  temporaryClosedValidation,
  vendorWalletValidation,
  vendorCashInHandValidation,
  collectCashValidation,
  vendorCollectedCashInHandValidation,
  posDataValidation,
  posInitialFoodValidation,
  posFoodSearchValidation,
  posFoodListWebValidation,
  vendorSubscriptionValidation,
  renewSubscriptionValidation,
  vendorInformationValidation,
  cityMapDialogValidation,
  coverageCheckValidation,
  filterValidation,
  filterQueryValidation,
  supportTeamRestaurantValidation,
  cityzenFilterQueryValidation,
  cityzenUpdateValidation,
  cityzenCreateVendor,
  exportValidation,
  allValidation,
  exportFilterValidation,
  exportFilterQueryValidation,
  exportReportValidation,
  cityMasterValidation,
  userTableQrMenuValidation,
};

