const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

const attachment = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).max(2048).required(),
  name: Joi.string().trim().max(160).allow(''),
  mimeType: Joi.string().trim().max(120).allow(''),
});
const page = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('open', 'in_progress', 'waiting_customer', 'resolved', 'closed'),
};
const create = {
  body: Joi.object({
    order: Joi.string().custom(objectId).allow('', null),
    category: Joi.string().valid('order', 'delivery', 'payment', 'subscription', 'product_quality', 'inventory', 'account', 'other').required(),
    subject: Joi.string().trim().min(4).max(160).required(),
    priority: Joi.string().valid('low', 'normal', 'high', 'urgent').default('normal'),
    message: Joi.string().trim().min(8).max(5000).required(),
    attachments: Joi.array().max(5).items(attachment).default([]),
  }),
};
const reply = {
  params: Joi.object({ ticket: Joi.string().custom(objectId).required() }),
  body: Joi.object({
    message: Joi.string().trim().min(1).max(5000).required(),
    attachments: Joi.array().max(5).items(attachment).default([]),
  }),
};
const detail = { params: Joi.object({ ticket: Joi.string().custom(objectId).required() }) };
const adminList = {
  query: Joi.object({
    ...page,
    priority: Joi.string().valid('low', 'normal', 'high', 'urgent'),
    requesterType: Joi.string().valid('customer', 'partner'),
    category: Joi.string().valid('order', 'delivery', 'payment', 'subscription', 'product_quality', 'inventory', 'account', 'other'),
    search: Joi.string().trim().max(100).allow(''),
  }),
};
const adminUpdate = {
  params: Joi.object({ ticket: Joi.string().custom(objectId).required() }),
  body: Joi.object({
    status: Joi.string().valid('open', 'in_progress', 'waiting_customer', 'resolved', 'closed'),
    priority: Joi.string().valid('low', 'normal', 'high', 'urgent'),
  }).min(1),
};
const adminReply = {
  params: Joi.object({ ticket: Joi.string().custom(objectId).required() }),
  body: Joi.object({ message: Joi.string().trim().min(1).max(5000).required() }),
};
const outletSelect = { body: Joi.object({ business: Joi.string().custom(objectId).required() }) };

module.exports = { create, reply, detail, adminList, adminUpdate, adminReply, outletSelect };
