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

const { OrderNotificationTranslation } = require('../models');

const saveOrderNotificationTranslation = async (notificationBody) => {
  const checkExist = await OrderNotificationTranslation.findOne({ slug: notificationBody.slug });
  if (checkExist) {
    const notificationData = {
      title: notificationBody.title,
      description: notificationBody.description,
      slug: notificationBody.slug,
      translations: notificationBody.translations,
    };
    Object.assign(checkExist, notificationData);
    await checkExist.save();
    return { success: true };
  }

  const notificationData = new OrderNotificationTranslation({
    title: notificationBody.title,
    description: notificationBody.description,
    slug: notificationBody.slug,
    translations: notificationBody.translations,
  });
  await OrderNotificationTranslation.create(notificationData);
  return { success: true };
};

const getBySlug = async (slugURL) => {
  const info = await OrderNotificationTranslation.findOne({ slug: slugURL });
  if (!info) {
    return { success: false };
  }
  return { info, success: true };
};

module.exports = {
  saveOrderNotificationTranslation,
  getBySlug,
};

