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

const express = require('express');
const appAuth = require('../../middlewares/appAuth');
const appAuthOptional = require('../../middlewares/appAuthOptional');
const validate = require('../../middlewares/validate');
const { reelsInteractLimiter, reelsCommentLimiter, reelsReportLimiter } = require('../../middlewares/rateLimiter');
const reelController = require('../../controllers/reel.controller');
const reelsValidation = require('../../modules/reels/validators/reels.validation');

const router = express.Router();

// Auth note: the previous file used appAuth('uploadReel'/'fetchReels'/…)
// which reads its argument as a REQUIRED RIGHT, not a role name —
// roleRights.get('user').includes('uploadReel') is never true, so every
// customer reels request answered 403 (same class of mistake documented for
// stores_browse in config/roles.js).
//
// Reading is now optional-auth: browsing the feed and its comments is a guest
// activity, capped by the admin-configured `reelsGuestLimit`, so a signed-out
// visitor can watch a few reels and is asked to sign in rather than shown an
// error. Writing (like/save/share/view/comment/report) still requires a token,
// because every one of those rows is keyed on the viewer.
router.get('/feed', appAuthOptional(), validate(reelsValidation.feedValidation), reelController.fetchReels);

router.post(
  '/:reelId/like',
  appAuth(),
  reelsInteractLimiter,
  validate(reelsValidation.reelIdParam),
  reelController.toggleLike
);

router.post(
  '/:reelId/save',
  appAuth(),
  reelsInteractLimiter,
  validate(reelsValidation.reelIdParam),
  reelController.toggleSave
);

router.post(
  '/:reelId/share',
  appAuth(),
  reelsInteractLimiter,
  validate(reelsValidation.reelIdParam),
  reelController.recordShare
);

router.post(
  '/:reelId/view',
  appAuth(),
  reelsInteractLimiter,
  validate(reelsValidation.viewValidation),
  reelController.recordView
);

router.post(
  '/:reelId/comment',
  appAuth(),
  reelsCommentLimiter,
  validate(reelsValidation.commentValidation),
  reelController.addComment
);

router.get(
  '/:reelId/comments',
  appAuthOptional(),
  validate(reelsValidation.reelIdParam),
  reelController.getComments
);

router.post(
  '/:reelId/report',
  appAuth(),
  reelsReportLimiter,
  validate(reelsValidation.reportValidation),
  reelController.reportReel
);

module.exports = router;
