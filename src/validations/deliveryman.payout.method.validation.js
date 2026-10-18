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

const formElementSchema = Joi.object({
  fieldName: Joi.string().required(),
  fieldType: Joi.string().required(),
  fieldValue: Joi.string().required(),
});

const createPayoutMethodValidation = {
  body: Joi.object().keys({
    method: Joi.string().custom(objectId).required(),
    deliveryman: Joi.string().custom(objectId).required(),
    formElement: Joi.array().items(formElementSchema),
  }),
};

const deliverymanValidation = {
  params: Joi.object().keys({
    deliveryman: Joi.string().custom(objectId).required(),
  }),
};

const deletePayoutMethodValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    deliveryman: Joi.string().custom(objectId).required(),
  }),
};

const payoutMethodDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    deliveryman: Joi.string().custom(objectId).required(),
  }),
};

const updatePayoutMethodValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    deliveryman: Joi.string().custom(objectId).required(),
    formElement: Joi.array().items(formElementSchema),
  }),
};

const changeDefaultPayoutMethodValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    deliveryman: Joi.string().custom(objectId).required(),
    isDefault: Joi.boolean().required(),
  }),
};

module.exports = {
  createPayoutMethodValidation,
  deliverymanValidation,
  deletePayoutMethodValidation,
  payoutMethodDetailValidation,
  updatePayoutMethodValidation,
  changeDefaultPayoutMethodValidation,
};

