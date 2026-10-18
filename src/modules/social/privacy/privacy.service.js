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

const SocialPrivacy = require('../models/social.privacy.model');

const defaults = { findFriendsEnabled: true, showActivityToContacts: true, lastSyncAt: null };

const getOrCreate = async (userId) => {
  const row = await SocialPrivacy.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, ...defaults } },
    { new: true, upsert: true }
  ).lean();
  return row;
};

const updatePrivacy = async (userId, patch) => {
  const update = {};
  if (typeof patch.findFriendsEnabled === 'boolean')
    update.findFriendsEnabled = patch.findFriendsEnabled;
  if (typeof patch.showActivityToContacts === 'boolean') {
    update.showActivityToContacts = patch.showActivityToContacts;
  }
  const row = await SocialPrivacy.findOneAndUpdate(
    { userId },
    { $set: update, $setOnInsert: { userId } },
    { new: true, upsert: true }
  ).lean();
  return row;
};

const touchLastSync = async (userId) => {
  const row = await SocialPrivacy.findOneAndUpdate(
    { userId },
    { $set: { lastSyncAt: new Date() }, $setOnInsert: { userId } },
    { new: true, upsert: true }
  ).lean();
  return row.lastSyncAt;
};

// userIds -> Set of ids whose activity may be shown (showActivityToContacts !== false).
const filterShareableIds = async (userIds) => {
  if (!userIds.length) return new Set();
  const rows = await SocialPrivacy.find({ userId: { $in: userIds } })
    .select('userId showActivityToContacts')
    .lean();
  const optedOut = new Set(
    rows.filter((r) => r.showActivityToContacts === false).map((r) => String(r.userId))
  );
  return new Set(userIds.map(String).filter((id) => !optedOut.has(id)));
};

module.exports = {
  getOrCreate,
  updatePrivacy,
  touchLastSync,
  filterShareableIds,
};
