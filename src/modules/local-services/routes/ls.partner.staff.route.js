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
const appAuth = require('../../../middlewares/appAuth');
const controller = require('../controllers/ls.staff.controller');

const router = express.Router();

router.route('/staff').post(appAuth('localservices_partner_read'), controller.createStaff).get(appAuth('localservices_partner_read'), controller.listStaff);
router.route('/availability').post(appAuth('localservices_partner_read'), controller.upsertAvailability);
router.route('/coverage').post(appAuth('localservices_partner_read'), controller.upsertCoverage);

module.exports = router;
