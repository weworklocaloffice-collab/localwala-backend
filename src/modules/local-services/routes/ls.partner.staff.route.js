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
const validate = require('../../../middlewares/validate');
const appAuth = require('../../../middlewares/appAuth');
const controller = require('../controllers/ls.staff.controller');
const resourceController = require('../controllers/ls.resource.controller');
const V = require('../validations/ls.staff.validation');

const router = express.Router();

router.route('/staff').post(appAuth('localservices_partner_read'), validate(V.staffBody), controller.createStaff).get(appAuth('localservices_partner_read'), controller.listStaff);
router.route('/staff/:id').patch(appAuth('localservices_partner_read'), validate(V.updateStaffBody), controller.updateStaff);
router.route('/resources').post(appAuth('localservices_partner_read'), validate(V.resourceBody), resourceController.createResource).get(appAuth('localservices_partner_read'), resourceController.listResources);
router.route('/resources/:id').patch(appAuth('localservices_partner_read'), validate(V.updateResourceBody), resourceController.updateResource);
router.route('/availability').post(appAuth('localservices_partner_read'), controller.upsertAvailability);
router.route('/coverage').post(appAuth('localservices_partner_read'), controller.upsertCoverage).get(appAuth('localservices_partner_read'), controller.getCoverage);

module.exports = router;
