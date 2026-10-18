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

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Key by authenticated user when available — mobile clients share carrier-NAT
// IPs, so pure IP keying would throttle innocent users alongside abusers.
// These limiters therefore run AFTER appAuth()/webAuth() in route order.
// The IP fallback goes through ipKeyGenerator so IPv6 subnets group correctly.
const userAwareKey = (req) => {
  const id = req.user && (req.user._id || req.user.id);
  return id ? `user:${String(id)}` : `ip:${ipKeyGenerator(req.ip)}`;
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
});

// Contact sync costs a user-table scan per call in Phase 1 (docs §5), and the
// client already gates at 7 days — anything above this is a loop or abuse.
const contactsSyncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_SYNC_MAX) || 10,
  keyGenerator: userAwareKey,
});

// High-frequency taps: like/save/share/view. Generous — a scrolling session
// fires many views; this only stops scripts.
const reelsInteractLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_REELS_INTERACT_MAX) || 200,
  keyGenerator: userAwareKey,
});

// Comments create content and fan out to notifications — much stricter.
const reelsCommentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_REELS_COMMENT_MAX) || 30,
  keyGenerator: userAwareKey,
});

// Admin uploads cost S3 + transcode. Admins are trusted, so this only catches
// runaway clients — state flips (publish/pause) stay unthrottled.
const reelsAdminUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.RATE_REELS_ADMIN_UPLOAD_MAX) || 30,
  keyGenerator: userAwareKey,
});

// Public property search costs a 2dsphere query + sort per call and is
// guest-accessible (plan F-16). IP-keyed — there is no user to key on.
// Generous: this only stops scripts, not browsing sessions.
const realestateSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_REALESTATE_SEARCH_MAX) || 60,
});

// Support chat sends. One write per row in SupportChatConversion plus an FCM
// fan-out to every registered device, so an unbounded loop is expensive and
// floods the customer's phone. 30/minute is far above human typing speed — the
// socket path enforces the same ceiling — while still stopping a script.
const supportChatSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_SUPPORT_CHAT_MAX) || 30,
  keyGenerator: userAwareKey,
});

module.exports = {
  authLimiter,
  contactsSyncLimiter,
  reelsInteractLimiter,
  reelsCommentLimiter,
  reelsAdminUploadLimiter,
  realestateSearchLimiter,
  supportChatSendLimiter,
};
