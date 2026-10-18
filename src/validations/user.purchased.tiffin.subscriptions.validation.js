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

const variationItemSchema = Joi.object({
  variation: Joi.string(),
  selected: Joi.array().items(Joi.string()),
});

const foodValidationSchema = Joi.object({
  id: Joi.string().custom(objectId).required(),
  addon: Joi.string().allow(null, ''),
  variations: Joi.array().items(variationItemSchema),
});

const buyTiffinSubscriptionValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    subscriptionPackage: Joi.string().custom(objectId).required(),
    payment: Joi.string().custom(objectId).required(),
    food: Joi.array().items(foodValidationSchema).min(1).required(),
    slot: Joi.string().required(),
    cookingInstruction: Joi.string().allow(null, ''),
    deliveryInstruction: Joi.string().custom(objectId).allow(null, ''),
    deliveryAddress: Joi.string().custom(objectId).allow(null, ''),
    receiverName: Joi.string().required(),
    countryCode: Joi.number().required(),
    receiverContact: Joi.string().required(),
  }),
};

const purchasedSubscriptionListValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

const purchasedSubscriptionInfoValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    id: Joi.string().custom(objectId).required(),
  }),
};

const repayPendingSubscriptionTiffinPackageValidation = {
  body: Joi.object().keys({
    packageId: Joi.string().custom(objectId).required(),
    userId: Joi.string().custom(objectId).required(),
    payMethod: Joi.string().custom(objectId).required(),
    newPayMethod: Joi.string().custom(objectId).required(),
  }),
};

const purchasedSubscriptionListVendorValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    vendor: Joi.string().custom(objectId).required(),
    id: Joi.string().custom(objectId).required(),
  }),
};

const purchasedSubscriptionListAdminValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    id: Joi.string().custom(objectId).required(),
    search: Joi.string().allow(null, ''),
  }),
};

const purchaseDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const userCancelTiffinSubscriptionValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    cancellationId: Joi.string().custom(objectId).required(),
  }),
};

const userRequestOffDayOnSubscriptionValidation = {
  body: Joi.object().keys({
    purchaseId: Joi.string().custom(objectId).required(),
    offDayDate: Joi.date().required(),
  }),
};

const supportTeamPurchaseDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const exportCollection = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    id: Joi.string().custom(objectId).required(),
    search: Joi.string().allow(null, ''),
  }),
};

const downloadBookingReceiptValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    locale: Joi.string().required(),
  }),
};

module.exports = {
  buyTiffinSubscriptionValidation,
  purchasedSubscriptionListValidation,
  purchasedSubscriptionInfoValidation,
  repayPendingSubscriptionTiffinPackageValidation,
  purchasedSubscriptionListVendorValidation,
  purchasedSubscriptionListAdminValidation,
  purchaseDetailValidation,
  userCancelTiffinSubscriptionValidation,
  userRequestOffDayOnSubscriptionValidation,
  supportTeamPurchaseDetailValidation,
  exportCollection,
  downloadBookingReceiptValidation,
};

