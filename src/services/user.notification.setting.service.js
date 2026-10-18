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

const { status: httpStatus } = require('http-status');
const mongoose = require('mongoose');
const { UserNotificationSetting } = require('../models');
const ApiError = require('../utils/ApiError');

const getNotificationSettings = async (id) => {
  const setting = await UserNotificationSetting.findOne({ user: new mongoose.Types.ObjectId(id) });
  if (!setting) {
    const notificationData = new UserNotificationSetting({
      user: id,
      newsletters: true,
      promoEmail: true,
      promoNotification: true,
      promoWhatsApp: true,
      socialEmail: true,
      socialNotification: true,
      orderEmail: true,
      orderNotification: true,
      orderWhatsApp: true,
      importantUpdate: true,
    });
    const savedSetting = await UserNotificationSetting.create(notificationData);
    return { setting: savedSetting, success: true };
  }
  return { setting, success: true };
};

const updateNotificationSetting = async (id, param) => {
  const setting = await UserNotificationSetting.findById(id);
  if (!setting) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(setting, {
    newsletters: param.newsletters,
    promoEmail: param.promoEmail,
    promoNotification: param.promoNotification,
    promoWhatsApp: param.promoWhatsApp,
    socialEmail: param.socialEmail,
    socialNotification: param.socialNotification,
    orderEmail: param.orderEmail,
    orderNotification: param.orderNotification,
    orderWhatsApp: param.orderWhatsApp,
    importantUpdate: param.importantUpdate,
  });
  await setting.save();
  return { success: true };
};

module.exports = {
  getNotificationSettings,
  updateNotificationSetting,
};

