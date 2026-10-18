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

const User = require('../../../models/user.model');
const contactsService = require('../contacts/contacts.service');
const privacyService = require('../privacy/privacy.service');
const proofCache = require('./proof.cache');

const MAX_PEOPLE = 3;

const toPerson = (user) => ({
  userId: String(user._id),
  name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Localwala user',
  avatarUrl: user.image && user.image !== 'NA' ? user.image : null,
});

// Bulk path — pure relationship math. The liker map is INJECTED by the
// consuming module (reels supplies it from its own repository), so social
// never imports reels and the dependency stays one-way (docs §2). Exactly 1
// contacts query + 1 user lookup for N reels — never N+1.
const getBulkSocialProof = async (reelIds, viewerId, likersByReel) => {
  const ids = [...new Set(reelIds.map(String))];
  if (!ids.length) return {};
  if (!likersByReel) {
    throw new Error(
      'getBulkSocialProof requires likersByReel — the consuming module supplies liker data'
    );
  }

  const viewerPrivacy = await privacyService.getOrCreate(viewerId);
  if (viewerPrivacy.findFriendsEnabled === false) {
    return Object.fromEntries(ids.map((id) => [id, { people: [], total: 0 }]));
  }

  const contactIds = await contactsService.getMatchedUserIds(viewerId);

  const contactSet = new Set(contactIds.map(String));
  if (!contactSet.size) {
    return Object.fromEntries(ids.map((id) => [id, { people: [], total: 0 }]));
  }

  const visibleUserIds = new Set();
  for (const id of ids) {
    for (const likerId of likersByReel.get(id) || []) {
      if (contactSet.has(likerId)) visibleUserIds.add(likerId);
    }
  }

  const shareable = await privacyService.filterShareableIds([...visibleUserIds]);
  const users = shareable.size
    ? await User.find({ _id: { $in: [...shareable] } })
        .select('_id firstName lastName image')
        .lean()
    : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const result = {};
  for (const id of ids) {
    const likers = [...(likersByReel.get(id) || [])].filter(
      (likerId) => contactSet.has(likerId) && shareable.has(likerId) && byId.has(likerId)
    );
    result[id] = {
      people: likers.slice(0, MAX_PEOPLE).map((likerId) => toPerson(byId.get(likerId))),
      total: likers.length,
    };
  }
  return result;
};

const getReelSocialProof = async (reelId, viewerId, likersByReel) => {
  const key = `${viewerId}:${reelId}`;
  const cached = await proofCache.get(key);
  if (cached) return cached;
  const bulk = await getBulkSocialProof([reelId], viewerId, likersByReel);
  const value = bulk[String(reelId)] || { people: [], total: 0 };
  await proofCache.set(key, value);
  return value;
};

module.exports = {
  MAX_PEOPLE,
  getReelSocialProof,
  getBulkSocialProof,
};
