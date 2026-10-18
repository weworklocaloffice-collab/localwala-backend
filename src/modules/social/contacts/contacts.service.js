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

const crypto = require('crypto');
const { status: httpStatus } = require('http-status');
const User = require('../../../models/user.model');
const PrivacyService = require('../privacy/privacy.service');
const contactsRepository = require('./contacts.repository');
const ApiError = require('../../../utils/ApiError');

// Must stay identical to the Flutter implementation (docs §5).
// '+91 98765 43210' -> '919876543210'.
const normalizePhone = (raw) => {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\D/g, '').replace(/^0+/, '');
};

const sha256Hex = (normalized) => crypto.createHash('sha256').update(normalized).digest('hex');

const serverHashForUser = (user) => {
  const digits = normalizePhone(`${user.countryCode || ''}${user.mobile || ''}`);
  if (!digits) return null;
  return sha256Hex(digits);
};

const displayNameOf = (user) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Localwala user';

// Phase-2 matching: one indexed $in query against users.phoneHash. The
// pre-save hook on the User schema and the backfill script
// (scripts/migrate.user.phonehash.js) keep the field populated going forward.
// The interface (hashes in, matched users out) is unchanged from Phase 1.
const syncContacts = async (userId, hashes) => {
  const uniqueHashes = [...new Set((hashes || []).map((h) => String(h).toLowerCase()))];
  if (!uniqueHashes.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'contacts must not be empty');
  }
  if (uniqueHashes.length > 2000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum 2000 contacts per sync');
  }

  const privacy = await PrivacyService.getOrCreate(userId);
  if (privacy.findFriendsEnabled === false) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Contact matching is disabled for this account');
  }

  // Exclude self so a user never matches themselves.
  const self = await User.findById(userId).select('phoneHash').lean();
  const wanted = uniqueHashes.filter((hash) => hash !== self?.phoneHash);

  const candidates = wanted.length
    ? await User.find({ status: true, phoneHash: { $in: wanted } })
        .select('_id firstName lastName image')
        .lean()
    : [];

  const matched = candidates.filter((candidate) => String(candidate._id) !== String(userId));

  const matchedIds = matched.map((u) => u._id);
  await contactsRepository.upsertMatches(userId, matchedIds);
  const lastSyncAt = await PrivacyService.touchLastSync(userId);

  return {
    matchedUsers: matched.map((u) => ({
      userId: String(u._id),
      displayName: displayNameOf(u),
      avatarUrl: u.image && u.image !== 'NA' ? u.image : null,
    })),
    matchedCount: matched.length,
    lastSyncAt,
  };
};

const getMatchedUserIds = (userId) => contactsRepository.findMatchedIds(userId, 'ACTIVE');

module.exports = {
  normalizePhone,
  sha256Hex,
  syncContacts,
  getMatchedUserIds,
};
