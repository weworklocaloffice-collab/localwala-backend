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

const providerBody = {
  body: Joi.object()
    .keys({
      businessName: Joi.string().max(200).required(),
      businessAddress: Joi.string().max(500).allow('', null),
      contactName: Joi.string().max(200).allow('', null),
      contactPhone: Joi.string().max(20).allow('', null),
      providerType: Joi.string().valid('independent', 'business', 'salon', 'hotel', 'rental', 'trainer', 'multi_location'),
      serviceKeys: Joi.array().items(Joi.string().max(64)),
    })
    .unknown(false),
};

const updateProviderBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      businessName: Joi.string().max(200),
      businessAddress: Joi.string().max(500).allow('', null),
      contactName: Joi.string().max(200).allow('', null),
      contactPhone: Joi.string().max(20).allow('', null),
      providerType: Joi.string().valid('independent', 'business', 'salon', 'hotel', 'rental', 'trainer', 'multi_location'),
      serviceKeys: Joi.array().items(Joi.string().max(64)),
    })
    .min(1)
    .unknown(false),
};

const offeringBody = {
  body: Joi.object()
    .keys({
      service: objectId.required(),
      variant: objectId.allow(null),
      price: Joi.number().min(0).max(10000000).required(),
      durationMinutes: Joi.number().min(0),
    })
    .unknown(false),
};

const updateOfferingBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      price: Joi.number().min(0).max(10000000),
      durationMinutes: Joi.number().min(0),
    })
    .min(1)
    .unknown(false),
};

const idParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const statusParam = {
  params: Joi.object().keys({ id: objectId.required(), status: Joi.string().required() }),
};

const documentBody = {
  body: Joi.object()
    .keys({
      kind: Joi.string().max(100).required(),
      fileUrl: Joi.string().max(1000).required(),
    })
    .unknown(false),
};

module.exports = { providerBody, updateProviderBody, offeringBody, updateOfferingBody, idParam, statusParam, documentBody };
