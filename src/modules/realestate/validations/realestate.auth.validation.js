const Joi = require('joi');
const { password } = require('../../../validations/custom.validation');

const sendRegistrationOtpBody = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
    locale: Joi.string().allow('', null),
    role: Joi.string().allow('', null),
  }),
};

const registerPartnerBody = {
  body: Joi.object().keys({
    id: Joi.string().required(),
    firstName: Joi.string().trim().required(),
    lastName: Joi.string().trim().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
    email: Joi.string().email().required(),
    password: Joi.string().custom(password).required(),
    locale: Joi.string().allow('', null),
    remember: Joi.boolean(),
    userAgent: Joi.string().allow('', null),
    role: Joi.string().allow('', null),
  }),
};

module.exports = {
  sendRegistrationOtpBody,
  registerPartnerBody,
};
