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
const webAuth = require('../../middlewares/webAuth');
const FileController = require('../../controllers/file.controller');

const router = express.Router();

router.post('/uploadImage', appAuth('uploadImage'), FileController.uploadImage);
router.post('/web_upload_image', webAuth('uploadImage'), FileController.uploadImage);

module.exports = router;

