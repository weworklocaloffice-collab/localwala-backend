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
const { objectId } = require('../../../validations/custom.validation');

const SCAN_EVENT_TYPES = ['pickup', 'issue', 'collect', 'return_to_store'];

const pickupScanValidation = {
  body: Joi.object().keys({
    clientRef: Joi.string().required(),
    run: Joi.string().custom(objectId).required(),
    canCodes: Joi.array().items(Joi.string()).min(1).max(50).required(),
    note: Joi.string().allow('', null),
  }),
};

const issueScanValidation = {
  body: Joi.object().keys({
    clientRef: Joi.string().required(),
    run: Joi.string().custom(objectId).required(),
    stop: Joi.string().custom(objectId).required(),
    order: Joi.string().custom(objectId).allow('', null),
    customer: Joi.string().custom(objectId).required(),
    canCodes: Joi.array().items(Joi.string()).min(1).max(20).required(),
    note: Joi.string().allow('', null),
  }),
};

const collectScanValidation = {
  body: Joi.object().keys({
    clientRef: Joi.string().required(),
    run: Joi.string().custom(objectId).required(),
    stop: Joi.string().custom(objectId).allow('', null),
    canCodes: Joi.array().items(Joi.string()).min(1).max(20).required(),
    note: Joi.string().allow('', null),
  }),
};

/**
 * The signed-in account's own deposit position.
 *
 * No `:id`: the customer comes from the token, so one customer cannot read
 * another's deposit summary by passing their id.
 */
const depositSummaryValidation = {};

const runBalanceValidation = {
  params: Joi.object().keys({
    run: Joi.string().custom(objectId).required(),
  }),
};

const reconcileValidation = {
  params: Joi.object().keys({
    run: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    cansReturned: Joi.number().integer().min(0).required(),
    reason: Joi.string().allow('', null),
  }),
};

const canListValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
    status: Joi.string().valid('in_store', 'with_agent', 'with_customer', 'lost', 'damaged'),
    condition: Joi.string().valid('good', 'damaged', 'lost'),
  }),
};

const writeOffValidation = {
  params: Joi.object().keys({
    can: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    eventType: Joi.string().valid('lost', 'damaged').required(),
    reason: Joi.string().required(),
    refundDeposit: Joi.boolean().default(false),
    run: Joi.string().custom(objectId).allow('', null),
  }),
};

const createCanValidation = {
  body: Joi.object().keys({
    canCode: Joi.string().required().uppercase().trim(),
    canType: Joi.string().valid('standard', 'mini', 'bulk').default('standard'),
    capacityL: Joi.number().min(0).default(1),
    depositAmount: Joi.number().min(0).default(0),
  }),
};

const importCansValidation = {
  body: Joi.object().keys({
    cans: Joi.array()
      .items(
        Joi.object().keys({
          canCode: Joi.string().required().uppercase().trim(),
          canType: Joi.string().valid('standard', 'mini', 'bulk').default('standard'),
          capacityL: Joi.number().min(0).default(1),
          depositAmount: Joi.number().min(0).default(0),
        })
      )
      .min(1)
      .required(),
  }),
};

module.exports = {
  SCAN_EVENT_TYPES,
  pickupScanValidation,
  issueScanValidation,
  collectScanValidation,
  depositSummaryValidation,
  runBalanceValidation,
  reconcileValidation,
  canListValidation,
  writeOffValidation,
  createCanValidation,
  importCansValidation,
};