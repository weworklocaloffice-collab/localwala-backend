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

/**
 * localservice.notify.service — best-effort booking notifications.
 * Writes NotificationList; never throws (a notification must not fail a booking).
 */
async function notifyUser({ userId, title, content, payload } = {}, { NotifyModel } = {}) {
  try {
    const Notify = NotifyModel || require('../../../models/notification.list.model');
    if (!userId || !title || !content) return null;
    return await Notify.create({ user: userId, title, content, payload: payload || {} });
  } catch (e) {
    console.error('LocalServices notify failed:', e.message);
    return null;
  }
}

module.exports = { notifyUser };
