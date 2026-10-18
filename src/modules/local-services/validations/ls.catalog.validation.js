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
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const categoryBody = {
  body: Joi.object()
    .keys({
      key: Joi.string().lowercase().pattern(/^[a-z0-9_]+$/).required(),
      name: Joi.string().max(200).required(),
      description: Joi.string().max(2000).allow('', null),
      icon: Joi.string().allow('', null),
      sortOrder: Joi.number().integer().min(0),
      parent: objectId.allow(null),
      allowedBookingModes: Joi.array().items(Joi.string().valid('INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING')),
      status: Joi.string().valid('draft', 'active', 'inactive'),
    })
    .unknown(false),
};

const facetBody = {
  body: Joi.object()
    .keys({
      key: Joi.string().lowercase().pattern(/^[a-z0-9_]+$/).required(),
      label: Joi.string().max(200).required(),
      dataType: Joi.string()
        .valid('TEXT', 'NUMBER', 'BOOLEAN', 'ENUM', 'MULTI_ENUM', 'RANGE', 'DATE', 'DATE_RANGE', 'LOCATION', 'DURATION')
        .required(),
      appliesToCategories: Joi.array().items(Joi.string()),
      options: Joi.array().items(Joi.string().max(100)),
      required: Joi.boolean(),
      searchable: Joi.boolean(),
      status: Joi.string().valid('active', 'inactive'),
    })
    .unknown(false),
};

const serviceBody = {
  body: Joi.object()
    .keys({
      key: Joi.string().lowercase().pattern(/^[a-z0-9_]+$/).required(),
      name: Joi.string().max(200).required(),
      description: Joi.string().max(2000).allow('', null),
      category: objectId.required(),
      categoryKey: Joi.string().lowercase().max(64).allow(null, ''),
      bookingMode: Joi.string().valid('INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING').required(),
      pricingMode: Joi.string().valid('FIXED', 'VARIANT', 'HOURLY', 'UNIT_BASED', 'DATE_BASED', 'QUOTE', 'INSPECTION_QUOTE').required(),
      baseDurationMinutes: Joi.number().min(0),
      minPrice: Joi.number().min(0),
      maxPrice: Joi.number().min(0),
      inspectionFee: Joi.number().min(0),
      inspectionFeeTreatment: Joi.string().valid('additional', 'credited'),
      allowedPaymentModes: Joi.array().items(Joi.string().valid('full_prepay', 'deposit', 'pay_after', 'cod', 'wallet', 'quote_schedule')),
      status: Joi.string().valid('draft', 'active', 'inactive'),
    })
    .unknown(false),
};

const variantBody = {
  body: Joi.object()
    .keys({
      service: objectId.required(),
      name: Joi.string().max(200).required(),
      sku: Joi.string().uppercase().max(64).allow('', null),
      durationMinutes: Joi.number().min(0),
      basePrice: Joi.number().min(0).required(),
      status: Joi.string().valid('active', 'inactive'),
    })
    .unknown(false),
};

const idParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const templateBody = {
  body: Joi.object()
    .keys({
      key: Joi.string().lowercase().pattern(/^[a-z0-9_]+$/).required(),
      name: Joi.string().max(200).required(),
      bookingMode: Joi.string().valid('INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING').required(),
      pricingMode: Joi.string().valid('FIXED', 'VARIANT', 'HOURLY', 'UNIT_BASED', 'DATE_BASED', 'QUOTE', 'INSPECTION_QUOTE').required(),
      requiredFacets: Joi.array().items(Joi.string().max(64)),
      requiredDocuments: Joi.array().items(Joi.string().max(100)),
      inspectionRequired: Joi.boolean(),
      depositPercent: Joi.number().min(0).max(100),
      cancellationCutoffHours: Joi.number().min(0),
      status: Joi.string().valid('draft', 'active', 'inactive'),
    })
    .unknown(false),
};

const addonBody = {
  body: Joi.object()
    .keys({
      service: objectId.required(),
      name: Joi.string().max(200).required(),
      price: Joi.number().min(0).required(),
      unit: Joi.string().max(20),
      status: Joi.string().valid('active', 'inactive'),
    })
    .unknown(false),
};

const updateBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      name: Joi.string().max(200),
      label: Joi.string().max(200),
      description: Joi.string().max(2000).allow('', null),
      icon: Joi.string().allow('', null),
      image: Joi.string().allow('', null),
      sortOrder: Joi.number().integer().min(0),
      options: Joi.array().items(Joi.string().max(100)),
      required: Joi.boolean(),
      searchable: Joi.boolean(),
      filterable: Joi.boolean(),
      bookingMode: Joi.string().valid('INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING'),
      pricingMode: Joi.string().valid('FIXED', 'VARIANT', 'HOURLY', 'UNIT_BASED', 'DATE_BASED', 'QUOTE', 'INSPECTION_QUOTE'),
      baseDurationMinutes: Joi.number().min(0),
      durationMinutes: Joi.number().min(0),
      basePrice: Joi.number().min(0),
      minPrice: Joi.number().min(0),
      maxPrice: Joi.number().min(0),
      inspectionFee: Joi.number().min(0),
      inspectionFeeTreatment: Joi.string().valid('additional', 'credited'),
      allowedPaymentModes: Joi.array().items(Joi.string().valid('full_prepay', 'deposit', 'pay_after', 'cod', 'wallet', 'quote_schedule')),
      includedWork: Joi.string().max(2000).allow('', null),
      allowedBookingModes: Joi.array().items(Joi.string().valid('INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING')),
      status: Joi.string().valid('draft', 'active', 'inactive'),
    })
    .min(1)
    .unknown(false),
};

module.exports = { categoryBody, facetBody, serviceBody, variantBody, templateBody, addonBody, idParam, updateBody };
