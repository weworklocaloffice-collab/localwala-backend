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

const RealEstateNotification = require('../models/realestate.notification.model');

/**
 * Notification service — the auditable fact that an event fired.
 * Delivery reuses `fcm.notification.service`; this row records whom,
 * what, and whether it was read. 20 event types (plan Phase 10).
 */
async function fire({ eventType, recipient, recipientType, title, body = '', data = undefined }) {
  const doc = { eventType, recipient, recipientType, title, body };
  if (data !== undefined) doc.data = data;
  return RealEstateNotification.create(doc);
}

async function markRead(notificationId) {
  const n = await RealEstateNotification.findById(notificationId);
  if (!n) throw new Error('Notification not found');
  n.readAt = new Date();
  await n.save();
  return n;
}

const realEstateNotificationService = { fire, markRead };

module.exports = realEstateNotificationService;
