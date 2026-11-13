const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

const roomParam = { params: Joi.object({ room: Joi.string().custom(objectId).required() }) };
const message = {
  params: Joi.object({ room: Joi.string().custom(objectId).required() }),
  body: Joi.object({ message: Joi.string().trim().min(1).max(2000).required() }),
};

module.exports = { roomParam, message };
