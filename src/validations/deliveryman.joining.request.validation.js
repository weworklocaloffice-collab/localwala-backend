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
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null, ''),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    locationType: Joi.string().required(),
    vehicle: Joi.string().custom(objectId),
    cover: Joi.string().required(),
    age: Joi.number().required(),
    dob: Joi.date().required(),
    type: Joi.string().required().valid('freelancer', 'salary'),
    identity: Joi.string().required(),
    identityNumber: Joi.string().required(),
    identityProof: Joi.string().required(),
    drivingLicense: Joi.string().required(),
    formElement: Joi.array().items(formElementSchema),
    locale: Joi.string().allow(null, ''),
  }),
};

const statusValidation = {
  params: Joi.object().keys({
    status: Joi.string().valid('all', 'freelancer', 'salary').required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenValidation = {
  params: Joi.object().keys({
    status: Joi.string().valid('all', 'freelancer', 'salary').required(),
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
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    password: Joi.string().required().custom(password),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    image: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).allow(null),
    vehicle: Joi.string().custom(objectId),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    locationType: Joi.string().required(),
    type: Joi.string().required().valid('freelancer', 'salary'),
    identity: Joi.string().required(),
    identityNumber: Joi.string().required(),
    identityProof: Joi.string().required(),
    drivingLicense: Joi.string().required(),
    age: Joi.number().required(),
    dob: Joi.date().required(),
  }),
};

const cityzenApproveValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    master: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    password: Joi.string().required().custom(password),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    image: Joi.string().required(),
    locality: Joi.string().custom(objectId).allow(null),
    vehicle: Joi.string().custom(objectId),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    locationType: Joi.string().required(),
    type: Joi.string().required().valid('freelancer', 'salary'),
    identity: Joi.string().required(),
    identityNumber: Joi.string().required(),
    identityProof: Joi.string().required(),
    drivingLicense: Joi.string().required(),
    age: Joi.number().required(),
    dob: Joi.date().required(),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.string().valid('all', 'freelancer', 'salary').required(),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  createRequestValidation,
  statusValidation,
  idValidation,
  rejectValidation,
  approveValidation,
  cityzenValidation,
  cityzenApproveValidation,
  exportValidation,
};

