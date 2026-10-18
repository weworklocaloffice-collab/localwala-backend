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
const { toJSON } = require('./plugins');

const userNotificationSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    newsletters: {
      type: Boolean,
      default: false,
    },
    promoEmail: {
      type: Boolean,
      default: false,
    },
    promoNotification: {
      type: Boolean,
      default: false,
    },
    promoWhatsApp: {
      type: Boolean,
      default: false,
    },
    socialEmail: {
      type: Boolean,
      default: false,
    },
    socialNotification: {
      type: Boolean,
      default: false,
    },
    orderEmail: {
      type: Boolean,
      default: true,
    },
    orderNotification: {
      type: Boolean,
      default: false,
    },
    orderWhatsApp: {
      type: Boolean,
      default: false,
    },
    importantUpdate: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
userNotificationSchema.plugin(toJSON);
userNotificationSchema.index({ location: '2dsphere' });

/**
 * @typedef UserNotificationSetting
 */
const UserNotificationSetting = mongoose.model('UserNotificationSetting', userNotificationSchema);

module.exports = UserNotificationSetting;

