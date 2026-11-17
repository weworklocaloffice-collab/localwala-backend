const Joi = require('joi');

const idParam = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .required();

const createProviderType = {
  body: Joi.object()
    .keys({
      key: Joi.string()
        .pattern(/^[a-z0-9_]+$/)
        .max(64)
        .required(),
      label: Joi.string().max(120).required(),
      active: Joi.boolean(),
      sortOrder: Joi.number().integer().min(0),
    })
    .unknown(false),
};

const updateProviderType = {
  params: Joi.object().keys({ id: idParam }),
  body: Joi.object()
    .keys({
      label: Joi.string().max(120),
      active: Joi.boolean(),
      sortOrder: Joi.number().integer().min(0),
    })
    .min(1)
    .unknown(false),
};

module.exports = { createProviderType, updateProviderType };
