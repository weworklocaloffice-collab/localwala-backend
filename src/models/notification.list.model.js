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

const notificationListSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false, // user id
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    payload: {
      type: Object,
      required: false,
    },
    username: {
      type: String,
      default: '',
    },
    restaurantName: {
      type: Object,
      default: null,
    },
    time: {
      type: String,
      default: '',
    },
    driverName: {
      type: String,
      default: '',
    },
    reason: {
      type: String,
      default: '',
    },
    amount: {
      type: String,
      default: '',
    },
    packageName: {
      type: Object,
      default: null,
    },
    kind: {
      type: String,
      default: '',
    },
    order: {
      type: String,
      default: '',
    },
    userHelper: {
      type: Boolean,
      default: false,
    },
    restaurantHelper: {
      type: Boolean,
      default: false,
    },
    timeHelper: {
      type: Boolean,
      default: false,
    },
    driverHelper: {
      type: Boolean,
      default: false,
    },
    reasonHelper: {
      type: Boolean,
      default: false,
    },
    amountHelper: {
      type: Boolean,
      default: false,
    },
    packageHelper: {
      type: Boolean,
      default: false,
    },
    kindHelper: {
      type: Boolean,
      default: false,
    },
    orderHelper: {
      type: Boolean,
      default: false,
    },
    translations: {
      type: Array,
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
notificationListSchema.plugin(toJSON);

/**
 * @typedef NotificationList
 */
const NotificationList = mongoose.model('NotificationList', notificationListSchema);

module.exports = NotificationList;

