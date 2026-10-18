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

const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const supportChatConversionSchema = mongoose.Schema(
  {
    roomId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SupportChatRoom',
      required: true,
    },
    senderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    messageType: {
      type: String,
      required: true,
    },
    // --- Enterprise bot-first extensions (backward compatible) ---
    senderRole: {
      type: String,
      enum: ['user', 'agent', 'bot', 'system'],
      default: 'user',
    },
    visibility: {
      type: String,
      enum: ['public', 'internal'],
      default: 'public',
    },
    attachments: [
      {
        url: { type: String, required: true },
        mime: { type: String, required: false },
        size: { type: Number, required: false },
      },
    ],
    replyTo: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SupportChatConversion',
      required: false,
    },
    randomId: {
      type: String,
      required: false,
      index: true,
    },
    readStatus: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
supportChatConversionSchema.plugin(toJSON);
supportChatConversionSchema.plugin(paginate);

/**
 * @typedef SupportChatConversion
 */
const SupportChatConversion = mongoose.model('SupportChatConversion', supportChatConversionSchema);

module.exports = SupportChatConversion;

