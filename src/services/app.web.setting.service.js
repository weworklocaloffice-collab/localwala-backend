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
const { AppWebSetting } = require('../models');
const ApiError = require('../utils/ApiError');

const createAppWebSetting = async (param) => {
  if ((await AppWebSetting.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const details = await AppWebSetting.create(param);
  return { id: details.id, success: true };
};

const getAppWebSetting = async () => {
  return AppWebSetting.findOne();
};

const updateAppWebSetting = async (slug, param) => {
  const appWebSetting = await getAppWebSetting(slug);

  Object.assign(appWebSetting, param);
  await appWebSetting.save();
  return { success: true };
};

const userAppVersionDetail = async () => {
  const detail = await AppWebSetting.findOne(
    {},
    {
      userAndroidForceUpdateVersion: 1,
      userAndroidUpdateUrl: 1,
      useriOSForceUpdateVersion: 1,
      useriOSUpdateUrl: 1,
    }
  );
  const versions = {
    androidVersion: '0.0.1',
    androidUrl: 'https://play.google.com/store/apps?hl=en_IN',
    iosVersion: '0.0.1',
    iosUrl: 'https://apps.apple.com/',
    success: false,
  };
  if (detail && detail !== null && detail.id !== '') {
    versions.androidVersion = detail.userAndroidForceUpdateVersion;
    versions.androidUrl = detail.userAndroidUpdateUrl;
    versions.iosVersion = detail.useriOSForceUpdateVersion;
    versions.iosUrl = detail.useriOSUpdateUrl;
    versions.success = true;
  }
  return versions;
};

const vendorAppVersionDetail = async () => {
  const detail = await AppWebSetting.findOne(
    {},
    {
      vendorAndroidForceUpdateVersion: 1,
      vendorAndroidUpdateUrl: 1,
      vendoriOSForceUpdateVersion: 1,
      vendoriOSUpdateUrl: 1,
    }
  );
  const versions = {
    androidVersion: '0.0.1',
    androidUrl: 'https://play.google.com/store/apps?hl=en_IN',
    iosVersion: '0.0.1',
    iosUrl: 'https://apps.apple.com/',
    success: false,
  };
  if (detail && detail !== null && detail.id !== '') {
    versions.androidVersion = detail.vendorAndroidForceUpdateVersion;
    versions.androidUrl = detail.vendorAndroidUpdateUrl;
    versions.iosVersion = detail.vendoriOSForceUpdateVersion;
    versions.iosUrl = detail.vendoriOSUpdateUrl;
    versions.success = true;
  }
  return versions;
};

const deliverymanAppVersionDetail = async () => {
  const detail = await AppWebSetting.findOne(
    {},
    {
      deliveryManAndroidForceUpdateVersion: 1,
      deliveryManAndroidUpdateUrl: 1,
      deliveryManiOSForceUpdateVersion: 1,
      deliveryManiOSUpdateUrl: 1,
    }
  );
  const versions = {
    androidVersion: '0.0.1',
    androidUrl: 'https://play.google.com/store/apps?hl=en_IN',
    iosVersion: '0.0.1',
    iosUrl: 'https://apps.apple.com/',
    success: false,
  };
  if (detail && detail !== null && detail.id !== '') {
    versions.androidVersion = detail.deliveryManAndroidForceUpdateVersion;
    versions.androidUrl = detail.deliveryManAndroidUpdateUrl;
    versions.iosVersion = detail.deliveryManiOSForceUpdateVersion;
    versions.iosUrl = detail.deliveryManiOSUpdateUrl;
    versions.success = true;
  }
  return versions;
};

const waiterAppVersionDetail = async () => {
  const detail = await AppWebSetting.findOne(
    {},
    {
      waiterAndroidForceUpdateVersion: 1,
      waiterAndroidUpdateUrl: 1,
      waiteriOSForceUpdateVersion: 1,
      waiteriOSUpdateUrl: 1,
    }
  );
  const versions = {
    androidVersion: '0.0.1',
    androidUrl: 'https://play.google.com/store/apps?hl=en_IN',
    iosVersion: '0.0.1',
    iosUrl: 'https://apps.apple.com/',
    success: false,
  };
  if (detail && detail !== null && detail.id !== '') {
    if (detail && detail !== null && detail.id !== '') {
      versions.androidVersion = detail.waiterAndroidForceUpdateVersion;
      versions.androidUrl = detail.waiterAndroidUpdateUrl;
      versions.iosVersion = detail.waiteriOSForceUpdateVersion;
      versions.iosUrl = detail.waiteriOSUpdateUrl;
      versions.success = true;
    }
  }
  return versions;
};

const kitchenAppVersionDetail = async () => {
  const detail = await AppWebSetting.findOne(
    {},
    {
      kitchenAndroidForceUpdateVersion: 1,
      kitchenAndroidUpdateUrl: 1,
      kitcheniOSForceUpdateVersion: 1,
      kitcheniOSUpdateUrl: 1,
    }
  );
  const versions = {
    androidVersion: '0.0.1',
    androidUrl: 'https://play.google.com/store/apps?hl=en_IN',
    iosVersion: '0.0.1',
    iosUrl: 'https://apps.apple.com/',
    success: false,
  };
  if (detail && detail !== null && detail.id !== '') {
    if (detail && detail !== null && detail.id !== '') {
      versions.androidVersion = detail.kitchenAndroidForceUpdateVersion;
      versions.androidUrl = detail.kitchenAndroidUpdateUrl;
      versions.iosVersion = detail.kitcheniOSForceUpdateVersion;
      versions.iosUrl = detail.kitcheniOSUpdateUrl;
      versions.success = true;
    }
  }
  return versions;
};

module.exports = {
  createAppWebSetting,
  getAppWebSetting,
  updateAppWebSetting,
  userAppVersionDetail,
  vendorAppVersionDetail,
  deliverymanAppVersionDetail,
  waiterAppVersionDetail,
  kitchenAppVersionDetail,
};

