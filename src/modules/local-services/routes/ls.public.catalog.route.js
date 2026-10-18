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
const controller = require('../controllers/ls.catalog.controller');

const router = express.Router();

// Guest-accessible on purpose (browse before sign-in). Service hardcodes
// status:active — never expose drafts.
router.route('/categories').get(controller.publicCategories);
router.route('/services').get(controller.publicServices);
router.route('/availability').get(controller.searchAvailability);

module.exports = router;
