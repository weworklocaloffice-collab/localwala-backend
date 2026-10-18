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

const checkChatRoomValidation = {
  body: Joi.object().keys({
    senderId: Joi.string().custom(objectId).required(),
    receiverId: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const sendChatMessageValidation = {
  body: Joi.object().keys({
    room: Joi.string().custom(objectId).required(),
    sender: Joi.string().custom(objectId).required(),
    // 2000 matches the socket path's cap. A message is rendered into an
    // HtmlWidget and an Angular template, so an unbounded body is both a spam
    // vector and a rendering hazard.
    msg: Joi.string().trim().min(1).max(2000).required(),
    msgType: Joi.string().required().allow('text', 'img'),
  }),
};

const chatListValidation = {
  params: Joi.object().keys({
    user: Joi.string().custom(objectId),
  }),
};

const getChatConversionValidation = {
  body: Joi.object().keys({
    roomId: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const supportChatValidation = {
  body: Joi.object().keys({
    roomId: Joi.string().custom(objectId).required(),
    supportTeam: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const supportChatRoomValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    type: Joi.string()
      .valid(
        'orders',
        'dining',
        'tiffin_subscription',
        'complaints',
        'reports',
        'restaurant_complaints'
      )
      .required(),
    typeId: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const resolveSupportChatValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    team: Joi.string().custom(objectId).required(),
  }),
};

const exportSupportChatValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const supportTeamChatValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    agent: Joi.string().custom(objectId),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    status: Joi.string().valid('open', 'in_progress', 'resolved'),
  }),
};

const adminChatMessagesValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const cityzenChatMessagesValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

// --- Enterprise: bot-first -> human handover -------------------------------
const botStartValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    type: Joi.string()
      .valid('orders', 'dining', 'tiffin_subscription', 'complaints', 'reports', 'restaurant_complaints')
      .required(),
    typeId: Joi.string().custom(objectId).required(),
    locale: Joi.string().max(10),
  }),
};

const botMessageValidation = {
  body: Joi.object().keys({
    roomId: Joi.string().custom(objectId).required(),
    message: Joi.string().trim().min(1).max(2000).required(),
    locale: Joi.string().max(10),
  }),
};

const roomIdParamValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const handoverValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().trim().max(250),
  }),
};

const transferValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    toAgent: Joi.string().custom(objectId).required(),
    reason: Joi.string().trim().max(250),
  }),
};

const transferAnswerValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const cannedCreateValidation = {
  body: Joi.object().keys({
    title: Joi.string().trim().min(3).max(80).required(),
    body: Joi.string().trim().min(1).max(2000).required(),
    locale: Joi.string().valid('en', 'hi', 'ar', 'es'),
    audience: Joi.string().valid('agent', 'customer'),
  }),
};

const cannedUpdateValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      title: Joi.string().trim().min(3).max(80),
      body: Joi.string().trim().min(1).max(2000),
      isActive: Joi.boolean(),
      audience: Joi.string().valid('agent', 'customer'),
    })
    .min(1),
};

const pinSubjectValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    kind: Joi.string().valid('orders', 'dining', 'tiffin_subscription').required(),
    entityId: Joi.string().custom(objectId).required(),
  }),
};

const userIdParamValidation = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId).required(),
  }),
};

const webTokenValidation = {
  body: Joi.object().keys({
    agent: Joi.string().custom(objectId).required(),
    token: Joi.string().min(10).max(500).required(),
  }),
};

const presenceStatusValidation = {
  body: Joi.object().keys({
    agent: Joi.string().custom(objectId).required(),
    availability: Joi.string().valid('available', 'busy', 'offline').required(),
  }),
};

const queueUpdateValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      members: Joi.array().items(Joi.string().custom(objectId)).max(100),
      wipLimit: Joi.number().integer().min(1).max(20),
      isActive: Joi.boolean(),
    })
    .min(1),
};

const bulkActionValidation = {
  body: Joi.object().keys({
    ids: Joi.array().items(Joi.string().custom(objectId)).min(1).max(100).required(),
    action: Joi.string().valid('resolve', 'assign').required(),
    toAgent: Joi.string().custom(objectId),
    reason: Joi.string().trim().max(250).allow(''),
  }),
};

const broadcastValidation = {
  body: Joi.object().keys({
    message: Joi.string().trim().min(1).max(500).required(),
  }),
};

const agentLanguagesValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    languages: Joi.array().items(Joi.string().pattern(/^[a-z-]{2,8}$/)).max(8).required(),
  }),
};

const slaPolicyUpdateValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      firstResponseSec: Joi.number().integer().min(5).max(86400),
      resolutionSec: Joi.number().integer().min(60).max(604800),
    })
    .min(1),
};

const internalNoteValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    sender: Joi.string().custom(objectId).required(),
    note: Joi.string().trim().min(1).max(2000).required(),
  }),
};

const csatValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    score: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().trim().max(1000).allow(''),
  }),
};

// Reopen is owner-initiated, so the body carries the caller for the ownership
// check — the route param alone would let anyone reopen anyone's ticket.
const reopenValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  checkChatRoomValidation,
  sendChatMessageValidation,
  chatListValidation,
  getChatConversionValidation,
  supportChatValidation,
  supportChatRoomValidation,
  resolveSupportChatValidation,
  exportSupportChatValidation,
  supportTeamChatValidation,
  adminChatMessagesValidation,
  cityzenChatMessagesValidation,
  botStartValidation,
  botMessageValidation,
  roomIdParamValidation,
  handoverValidation,
  transferValidation,
  transferAnswerValidation,
  cannedCreateValidation,
  cannedUpdateValidation,
  pinSubjectValidation,
  userIdParamValidation,
  webTokenValidation,
  presenceStatusValidation,
  queueUpdateValidation,
  slaPolicyUpdateValidation,
  bulkActionValidation,
  broadcastValidation,
  agentLanguagesValidation,
  internalNoteValidation,
  csatValidation,
  reopenValidation,
};

