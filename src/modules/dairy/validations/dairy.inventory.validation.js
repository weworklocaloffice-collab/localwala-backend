const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

const lotParams = Joi.object({
  id: Joi.string().custom(objectId).required(),
  lot: Joi.string().custom(objectId).required(),
});

module.exports = {
  writeOffValidation: {
    params: lotParams,
    body: Joi.object({
      quantity: Joi.number().integer().min(1).required(),
      bucket: Joi.string().valid('available', 'held', 'expired').default('available'),
      reason: Joi.string().trim().min(3).max(300).required(),
      note: Joi.string().trim().max(500).allow('').default(''),
    }),
  },
  lotDispositionValidation: {
    params: lotParams,
    body: Joi.object({
      action: Joi.string().valid('hold', 'release', 'recall').required(),
      reason: Joi.string().trim().min(3).max(300).required(),
    }),
  },
  movementsValidation: {
    query: Joi.object({
      sku: Joi.string().custom(objectId),
      lot: Joi.string().custom(objectId),
      eventType: Joi.string().valid('opening_balance', 'received', 'reserved', 'released', 'expired', 'write_off', 'held', 'hold_released', 'recalled'),
      from: Joi.date().iso(),
      to: Joi.date().iso().greater(Joi.ref('from')),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(50),
    }).with('from', 'to').with('to', 'from'),
  },
  reportValidation: {
    query: Joi.object({
      from: Joi.date().iso(),
      to: Joi.date().iso().greater(Joi.ref('from')),
    }).with('from', 'to').with('to', 'from'),
  },
};
