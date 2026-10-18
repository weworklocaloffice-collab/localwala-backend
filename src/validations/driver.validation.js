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

const createDriver = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    image: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null),
    restaurant: Joi.string().custom(objectId).allow(null),
    vehicle: Joi.string().custom(objectId),
    latitude,
    longitude,
    locationType: Joi.string().required(),
    type: Joi.string().required().valid('freelancer', 'salary'),
    identity: Joi.string().required(),
    identityNumber: Joi.string().required(),
    identityProof: Joi.string().required(),
    drivingLicense: Joi.string().required(),
    age: Joi.number().required(),
    dob: Joi.date().required(),
    activeStatus: Joi.allow(),
  }),
};

const cityzenCreateDriver = {
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
    image: Joi.string().required(),
    locality: Joi.string().custom(objectId).allow(null),
    restaurant: Joi.string().custom(objectId).allow(null),
    vehicle: Joi.string().custom(objectId),
    latitude,
    longitude,
    locationType: Joi.string().required(),
    type: Joi.string().required().valid('freelancer', 'salary'),
    identity: Joi.string().required(),
    identityNumber: Joi.string().required(),
    identityProof: Joi.string().required(),
    drivingLicense: Joi.string().required(),
    age: Joi.number().required(),
    dob: Joi.date().required(),
    activeStatus: Joi.allow(),
  }),
};

const createVendorDriver = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    image: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null),
    restaurant: Joi.string().custom(objectId).allow(null),
    vehicle: Joi.string().custom(objectId),
    latitude,
    longitude,
    identity: Joi.string().required(),
    identityNumber: Joi.string().required(),
    identityProof: Joi.string().required(),
    drivingLicense: Joi.string().required(),
    age: Joi.number().required(),
    dob: Joi.date().required(),
    activeStatus: Joi.allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    driverId: Joi.string().custom(objectId),
  }),
};

const cityzenUpdateValidation = {
  params: Joi.object().keys({
    driverId: Joi.string().custom(objectId).required(),
    master: Joi.string().custom(objectId).required(),
  }),
};

const restaurantValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId),
  }),
};

const driverNearTrendingRestaurantValidation = {
  body: Joi.object().keys({
    latitude,
    longitude,
    driverId: Joi.string().custom(objectId).required(),
  }),
};

const goOfflineValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId),
    reasonId: Joi.string().custom(objectId),
  }),
};

const goOnlineValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId),
  }),
};

const nearActiveDriverValidation = {
  params: Joi.object().keys({
    vendorId: Joi.string().custom(objectId),
  }),
};

const updateMyLocationValidation = {
  body: Joi.object().keys({
    latitude,
    longitude,
    id: Joi.string().custom(objectId).required(),
  }),
};

const driverByCityValidation = {
  params: Joi.object().keys({
    city: Joi.string().custom(objectId).required(),
  }),
};

const deliverymanCashInHandValidation = {
  params: Joi.object().keys({
    deliveryman: Joi.string().custom(objectId).required(),
  }),
};

const collectCashValidation = {
  body: Joi.object().keys({
    deliveryman: Joi.string().custom(objectId).required(),
    method: Joi.string().required(),
    reference: Joi.string().required(),
  }),
};

const getDeliveryDepositeDetailValidation = {
  params: Joi.object().keys({
    deliveryman: Joi.string().custom(objectId).required(),
  }),
};

const deliverymanInsightValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
  }),
};

const orderListValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

const deliverymanInformationValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const fundExportValidation = {
  params: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    query: Joi.string().allow(null, ''),
  }),
};

const exportDeliverymanReportValidation = {
  query: Joi.object().keys({
    exportType: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
    kind: Joi.string().valid('all', 'driver', 'vendorDriver'),
    type: Joi.string().allow('all', 'salary', 'freelancer'),
    city: Joi.string().custom(objectId).allow(null, ''),
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

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
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

module.exports = {
  createDriver,
  createVendorDriver,
  idValidation,
  restaurantValidation,
  driverNearTrendingRestaurantValidation,
  goOfflineValidation,
  goOnlineValidation,
  nearActiveDriverValidation,
  updateMyLocationValidation,
  driverByCityValidation,
  deliverymanCashInHandValidation,
  collectCashValidation,
  getDeliveryDepositeDetailValidation,
  deliverymanInsightValidation,
  orderListValidation,
  deliverymanInformationValidation,
  cityzenUpdateValidation,
  cityzenCreateDriver,
  fundExportValidation,
  exportDeliverymanReportValidation,
  allValidation,
  exportValidation,
  cityMasterValidation,
};

