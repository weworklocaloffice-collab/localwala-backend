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
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/ls.policy.controller');
const V = require('../validations/ls.policy.validation');

const router = express.Router();

// Admin-configurable booking policy (cancellation, rescheduling, quotes,
// deposits, tax). Mounted at /admin/policies.
const READ = 'localservices_catalog_read';
const WRITE = 'localservices_catalog_write';

router.route('/').post(webAuth(WRITE), validate(V.policyBody), controller.createPolicy).get(webAuth(READ), controller.listPolicies);

router.route('/:id').get(webAuth(READ), validate(V.idParam), controller.getPolicy);

router.route('/:id').patch(webAuth(WRITE), validate(V.updatePolicyBody), controller.updatePolicy);

// Activation creates the next VERSION; the live row is retired, not edited.
router.route('/:id/activate').post(webAuth(WRITE), validate(V.activatePolicyBody), controller.activatePolicy);

router.route('/:id/:status').post(webAuth(WRITE), validate(V.statusParam), controller.transitionPolicy);

module.exports = router;
