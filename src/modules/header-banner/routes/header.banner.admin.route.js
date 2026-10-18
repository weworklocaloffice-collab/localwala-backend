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
const webAuth = require('../../../middlewares/webAuth');
const validate = require('../../../middlewares/validate');
const controller = require('../controllers/header.banner.admin.controller');
const validation = require('../validators/header.banner.validation');
const uploadService = require('../services/header.banner.upload.service');

const router = express.Router();

// Multipart endpoint for banner media. Separate from `v1/file/web_upload_image` because
// Lottie payloads are JSON, and that shared route is image-only by policy.
router.post(
  '/upload',
  webAuth('header_banner_manage'),
  uploadService.uploadMiddleware,
  controller.upload
);

// Declared before `/:headerBannerId` so "asset" is not read as a banner id. Proxies a
// stored animation back to the admin preview, which cannot fetch the bucket directly
// because the storage host serves no CORS headers.
router.get(
  '/asset',
  webAuth('header_banner_manage'),
  validate(validation.assetValidation),
  controller.asset
);

// Autocomplete options for the CTA target pickers. Declared before `/:headerBannerId`
// so "lookups" is never read as a banner id, same reason as "asset" above.
router.get(
  '/lookups',
  webAuth('header_banner_manage'),
  validate(validation.lookupValidation),
  controller.lookups
);

// Draft routes are declared BEFORE `/:headerBannerId` so Express does not match
// "drafts" as a banner id.
router.get(
  '/drafts/:draftId',
  webAuth('header_banner_manage'),
  validate(validation.draftValidation),
  controller.getDraft
);

router.delete(
  '/drafts/:draftId',
  webAuth('header_banner_manage'),
  validate(validation.draftValidation),
  controller.discardDraft
);

router.patch(
  '/drafts/:draftId/publish',
  webAuth('header_banner_publish'),
  validate(validation.publishValidation),
  controller.publishDraft
);

router.post(
  '/drafts',
  webAuth('header_banner_manage'),
  validate(validation.saveDraftValidation),
  controller.saveDraft
);

router.get(
  '/publish-history',
  webAuth('header_banner_manage'),
  validate(validation.historyValidation),
  controller.history
);

router.get(
  '/',
  webAuth('header_banner_manage'),
  validate(validation.allValidation),
  controller.list
);

router.post(
  '/',
  webAuth('header_banner_manage'),
  validate(validation.createValidation),
  controller.create
);

router.get(
  '/:headerBannerId',
  webAuth('header_banner_manage'),
  validate(validation.detailValidation),
  controller.detail
);

router.patch(
  '/:headerBannerId',
  webAuth('header_banner_manage'),
  validate(validation.updateValidation),
  controller.update
);

router.patch(
  '/:headerBannerId/status',
  webAuth('header_banner_publish'),
  validate(validation.statusValidation),
  controller.updateStatus
);

router.delete(
  '/:headerBannerId',
  webAuth('header_banner_delete'),
  validate(validation.detailValidation),
  controller.drop
);

module.exports = router;