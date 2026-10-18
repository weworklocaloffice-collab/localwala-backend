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

const createOrUpdateConfig = {
  body: Joi.object().keys({
    smtpHost: Joi.string().required(),
    smtpPort: Joi.number().required(),
    smtpUsername: Joi.string().required(),
    smtpPassword: Joi.string().required(),
    smtpFromEmail: Joi.string().required(),
    smtpFromName: Joi.string().required(),
    smtpDriver: Joi.string().required(),
    smtpEncryption: Joi.string().required(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    configId: Joi.string().custom(objectId),
  }),
};

const demoValidation = {
  params: Joi.object().keys({
    email: Joi.string().required(),
  }),
};

const demoTestValidation = {
  params: Joi.object().keys({
    email: Joi.string().required(),
    locale: Joi.string().required(),
  }),
};

const mediaUrlValidation = Joi.object({
  appstore: Joi.string().allow('', null),
  facebook: Joi.string().allow('', null),
  instagram: Joi.string().allow('', null),
  linkedin: Joi.string().allow('', null),
  pinterest: Joi.string().allow('', null),
  playstore: Joi.string().allow('', null),
  twitter: Joi.string().allow('', null),
  vimeo: Joi.string().allow('', null),
  youtube: Joi.string().allow('', null),
  accountBlocked: Joi.string().allow('', null),
  approved: Joi.string().allow('', null),
  gratitude: Joi.string().allow('', null),
  orderSummary: Joi.string().allow('', null),
  refundRequest: Joi.string().allow('', null),
  rejected: Joi.string().allow('', null),
  restaurantAccountBlocked: Joi.string().allow('', null),
  subscriptionExpireSoon: Joi.string().allow('', null),
  supportChatExport: Joi.string().allow('', null),
  userVerification: Joi.string().allow('', null),
});

const emailMediaUrlValidation = {
  body: Joi.object().keys({
    mediaUrls: mediaUrlValidation,
  }),
};

module.exports = {
  createOrUpdateConfig,
  idValidation,
  demoValidation,
  demoTestValidation,
  emailMediaUrlValidation,
};

