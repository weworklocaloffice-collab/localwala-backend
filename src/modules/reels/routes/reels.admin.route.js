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
const { reelsAdminUploadLimiter } = require('../../../middlewares/rateLimiter');
const adminController = require('../admin/reels.admin.controller');
const validation = require('../admin/reels.admin.validation');
const multer = require('multer');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const router = express.Router();

const memoryStorage = multer.memoryStorage();
const reelUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new ApiError(httpStatus.BAD_REQUEST, 'Only video/mp4 uploads are allowed'));
    }
  },
});

router.post(
  '/upload-url',
  webAuth('reels_admin_manage'),
  reelsAdminUploadLimiter,
  validate(validation.uploadUrlValidation),
  adminController.uploadUrl
);
router.post(
  '/upload',
  webAuth('reels_admin_manage'),
  reelsAdminUploadLimiter,
  reelUpload.single('file'),
  validate(validation.uploadProxyValidation),
  adminController.uploadProxy
);
router.post(
  '/finalize',
  webAuth('reels_admin_manage'),
  reelsAdminUploadLimiter,
  validate(validation.finalizeValidation),
  adminController.finalize
);
// Declared BEFORE `/:id` — otherwise Express would match it as id="lookups".
router.get(
  '/lookups',
  webAuth('reels_admin_manage'),
  validate(validation.lookupValidation),
  adminController.lookup
);

router.post(
  '/',
  webAuth('reels_admin_manage'),
  validate(validation.createReelValidation),
  adminController.create
);
router.get(
  '/',
  webAuth('reels_admin_manage'),
  validate(validation.listReelsValidation),
  adminController.list
);
// Declared BEFORE `/:id`: Express matches in registration order, so a literal
// `/reports` after a `:id` route would be swallowed as id="reports".
router.get(
  '/reports',
  webAuth('reels_admin_manage'),
  validate(validation.listReportsValidation),
  adminController.listReports
);
router.post(
  '/reports/:reportId/review',
  webAuth('reels_admin_publish'),
  validate(validation.reviewReportValidation),
  adminController.reviewReport
);
router.get(
  '/:id',
  webAuth('reels_admin_manage'),
  validate(validation.reelIdValidation),
  adminController.detail
);
router.patch(
  '/:id',
  webAuth('reels_admin_manage'),
  validate(validation.updateReelValidation),
  adminController.update
);
router.delete(
  '/:id',
  webAuth('reels_admin_manage'),
  validate(validation.reelIdValidation),
  adminController.remove
);

router.post(
  '/:id/preview',
  webAuth('reels_admin_manage'),
  validate(validation.reelIdValidation),
  adminController.preview
);
router.post(
  '/:id/publish',
  webAuth('reels_admin_publish'),
  validate(validation.publishValidation),
  adminController.publish
);
router.post(
  '/:id/pause',
  webAuth('reels_admin_publish'),
  validate(validation.reelIdValidation),
  adminController.pause
);
router.post(
  '/:id/duplicate',
  webAuth('reels_admin_manage'),
  validate(validation.reelIdValidation),
  adminController.duplicate
);

router.get(
  '/:id/analytics',
  webAuth('reels_admin_analytics'),
  validate(validation.reelIdValidation),
  adminController.analytics
);

module.exports = router;
