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

const providerParams = {
  id: Joi.string().custom(objectId).required(),
};

const providerBody = {
  business: Joi.string().custom(objectId).required(),
  code: Joi.string().required().trim(),
  name: Joi.string().required().trim(),
  contactName: Joi.string().allow('', null),
  mobile: Joi.number().required(),
  countryCode: Joi.string().default('+91'),
  address: Joi.string().allow('', null),
  coordinates: Joi.array().items(Joi.number()).length(2),
  milkType: Joi.string().valid('cow', 'buffalo', 'mixed').default('cow'),
  ratePerLitre: Joi.number().min(0).default(0),
  bankDetails: Joi.object().keys({
    accountName: Joi.string().allow('', null),
    accountNumber: Joi.string().allow('', null),
    ifsc: Joi.string().allow('', null),
    upiId: Joi.string().allow('', null),
  }),
  status: Joi.boolean().default(true),
};

const providerCreateValidation = { body: Joi.object().keys(providerBody) };

const providerUpdateValidation = {
  params: Joi.object().keys({ provider: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys(providerBody).fork('business', (s) => s.optional()).min(1),
};

const providerListValidation = {
  params: Joi.object().keys(providerParams),
  query: Joi.object().keys({
    search: Joi.string().allow(null, ''),
    status: Joi.string().valid('true', 'false'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

/**
 * Rejection reasons are scoped to the partner's own outlet, which the server
 * reads from the token — so this list takes no params. It previously borrowed
 * `providerListValidation`, which demands a provider `:id` that this route has
 * no use for.
 */
const rejectionReasonListValidation = {
  query: Joi.object().keys({
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

/**
 * Intake. Fat and SNF are required because they are the whole point of the
 * quality record — a collection without them cannot be graded or settled.
 */
const collectionCreateValidation = {
  body: Joi.object().keys({
    provider: Joi.string().custom(objectId).required(),
    quantityL: Joi.number().positive().required(),
    fat: Joi.number().min(0).max(20).required(),
    snf: Joi.number().min(0).max(20).required(),
    temperature: Joi.number().min(-10).max(100).allow('', null),
    ratePerLitre: Joi.number().min(0),
    collectedAt: Joi.date().allow('', null),
    deviceId: Joi.string().allow('', null),
  }),
};

const collectionParams = {
  collection: Joi.string().custom(objectId).required(),
};

const collectionListValidation = {
  query: Joi.object().keys({
    qualityStatus: Joi.string().valid('pending', 'accepted', 'rejected'),
    provider: Joi.string().custom(objectId),
    payableStatus: Joi.string().valid('pending', 'approved', 'paid', 'disputed'),
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const acceptCollectionValidation = {
  params: Joi.object().keys(collectionParams),
  body: Joi.object().keys({
    storageTank: Joi.string().allow('', null),
    note: Joi.string().allow('', null),
    recordedBy: Joi.string().custom(objectId).allow('', null),
  }),
};

const rejectCollectionValidation = {
  params: Joi.object().keys(collectionParams),
  body: Joi.object().keys({
    reason: Joi.string().custom(objectId).allow('', null),
    reasonCode: Joi.string().allow('', null),
    reasonName: Joi.string().allow('', null),
    note: Joi.string().allow('', null),
    automatic: Joi.boolean().default(false),
    recordedBy: Joi.string().custom(objectId).allow('', null),
  }),
};

const rejectionReasonValidation = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    code: Joi.string().allow('', null),
    description: Joi.string().allow('', null),
    system: Joi.boolean().default(false),
    sortOrder: Joi.number().default(0),
    status: Joi.boolean().default(true),
  }),
};

const batchParams = {
  batch: Joi.string().custom(objectId).required(),
};

const shrinkageValidation = {
  params: Joi.object().keys(batchParams),
  body: Joi.object().keys({
    quantityL: Joi.number().positive().required(),
    reason: Joi.string().allow('', null),
    note: Joi.string().allow('', null),
    recordedBy: Joi.string().custom(objectId).allow('', null),
  }),
};

const batchListValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid('source', 'blended', 'opened', 'consumed', 'expired', 'discarded'),
    provider: Joi.string().custom(objectId),
  }),
};

/**
 * A FEFO preview. Returns the plan without committing, so an operator can see
 * which batches an order would draw from before it is placed.
 */
const fefoPreviewValidation = {
  body: Joi.object().keys({
    quantityL: Joi.number().positive().required(),
  }),
};

const reportValidation = {
  query: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
    provider: Joi.string().custom(objectId),
    payableStatus: Joi.string().valid('pending', 'approved', 'paid', 'disputed'),
    status: Joi.string().allow('', null),
  }),
};

module.exports = {
  providerCreateValidation,
  providerUpdateValidation,
  providerListValidation,
  collectionCreateValidation,
  collectionListValidation,
  acceptCollectionValidation,
  rejectCollectionValidation,
  rejectionReasonListValidation,
  rejectionReasonValidation,
  shrinkageValidation,
  batchListValidation,
  fefoPreviewValidation,
  reportValidation,
};