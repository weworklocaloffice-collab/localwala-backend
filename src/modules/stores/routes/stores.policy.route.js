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
const { storeAuth, appAuth } = require('../middlewares/stores.tenant');
const V = require('../validations/stores.validation');
const policyController = require('../controllers/stores.policy.controller');

const router = express.Router();

// Admin policy routes
router.post(
  '/policies',
  storeAuth('stores_policy_write'),
  validate(V.policyCreateValidation),
  policyController.createPolicy
);

router.get(
  '/policies',
  storeAuth('stores_policy_read'),
  validate(V.policyListValidation),
  policyController.listPolicies
);

router.get(
  '/policies/:policy',
  storeAuth('stores_policy_read'),
  policyController.getPolicy
);

router.patch(
  '/policies/:policy',
  storeAuth('stores_policy_write'),
  validate(V.policyUpdateValidation),
  policyController.updatePolicy
);

router.post(
  '/policies/:policy/archive',
  storeAuth('stores_policy_write'),
  policyController.archivePolicy
);

module.exports = router;