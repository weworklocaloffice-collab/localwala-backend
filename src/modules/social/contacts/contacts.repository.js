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

const UserContactMatch = require('../models/user.contact.match.model');

const findMatchedIds = async (userId, status = 'ACTIVE') => {
  const rows = await UserContactMatch.find({ userId, status }).select('matchedUserId').lean();
  return rows.map((r) => String(r.matchedUserId));
};

const upsertMatches = async (userId, matchedUserIds) => {
  if (!matchedUserIds.length) return 0;
  const ops = matchedUserIds.map((matchedUserId) => ({
    updateOne: {
      filter: { userId, matchedUserId },
      update: { $set: { userId, matchedUserId, source: 'PHONE_CONTACT', status: 'ACTIVE' } },
      upsert: true,
    },
  }));
  const result = await UserContactMatch.bulkWrite(ops, { ordered: false });
  return result.upsertedCount + result.modifiedCount + result.matchedCount;
};

module.exports = {
  findMatchedIds,
  upsertMatches,
};
