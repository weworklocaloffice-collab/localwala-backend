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

const { PushNotificationToken } = require('../models');

const savePushNotificationToken = async (param) => {
  const checkTokenData = await PushNotificationToken.findOne({ token: param.token });
  if (checkTokenData) {
    const notificationData = {
      user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
      token:
        param && param.token && param.token !== null && param.token !== '' ? param.token : null,
      deviceId:
        param && param.deviceId && param.deviceId !== null && param.deviceId !== ''
          ? param.deviceId
          : null,
      deviceType:
        param && param.deviceType && param.deviceType !== null && param.deviceType !== ''
          ? param.deviceType
          : null,
    };
    Object.assign(checkTokenData, notificationData);
    await checkTokenData.save();
    return { success: true };
  }
  const notificationData = new PushNotificationToken({
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    token: param && param.token && param.token !== null && param.token !== '' ? param.token : null,
    deviceId:
      param && param.deviceId && param.deviceId !== null && param.deviceId !== ''
        ? param.deviceId
        : null,
    deviceType:
      param && param.deviceType && param.deviceType !== null && param.deviceType !== ''
        ? param.deviceType
        : null,
  });
  await PushNotificationToken.create(notificationData);
  return { success: true };
};

const updatePushNotificationToken = async (param) => {
  const checkTokenData = await PushNotificationToken.findOne({ token: param.token });
  if (checkTokenData) {
    const notificationData = {
      user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
      token:
        param && param.token && param.token !== null && param.token !== '' ? param.token : null,
      deviceId:
        param && param.deviceId && param.deviceId !== null && param.deviceId !== ''
          ? param.deviceId
          : null,
      deviceType:
        param && param.deviceType && param.deviceType !== null && param.deviceType !== ''
          ? param.deviceType
          : null,
    };
    Object.assign(checkTokenData, notificationData);
    await checkTokenData.save();
    return { success: true };
  }
  return { success: false };
};

module.exports = {
  savePushNotificationToken,
  updatePushNotificationToken,
};

