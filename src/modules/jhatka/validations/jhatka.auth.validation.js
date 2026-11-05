const Joi = require('joi');
const { objectId, password } = require('../../../validations/custom.validation');

const sendRegistrationOtpBody = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
    role: Joi.string().valid('jhatkaPartner').required(),
    locale: Joi.string().allow('', null),
  }),
};

const registerPartnerBody = {
  body: Joi.object().keys({
    id: Joi.string().required(),
    role: Joi.string().valid('jhatkaPartner').required(),
    firstName: Joi.string().trim().required(),
    lastName: Joi.string().trim().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
    email: Joi.string().email().required(),
    password: Joi.string().custom(password).required(),
    locale: Joi.string().allow('', null),
    remember: Joi.boolean(),
    userAgent: Joi.string().allow('', null),

    businessName: Joi.string().trim().required(),
    businessModel: Joi.string()
      .valid('direct', 'franchise', 'commission_partner')
      .default('direct'),
    addressLine1: Joi.string().trim().required(),
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).required(),
    fssaiLicence: Joi.string().trim().allow('', null),
    fssaiExpiry: Joi.date().allow('', null),
  }),
};

const switchRoleBody = {
  body: Joi.object().keys({
    role: Joi.string().valid('jhatkaPartner', 'jhatkaDriver').required(),
  }),
};

module.exports = {
  sendRegistrationOtpBody,
  registerPartnerBody,
  switchRoleBody,
};
