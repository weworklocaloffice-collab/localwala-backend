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
const { storeAuth } = require('../middlewares/stores.tenant');
const V = require('../validations/stores.validation');
const remittanceController = require('../controllers/stores.remittance.controller');

const router = express.Router();

// Partner remittance routes
router.get(
  '/partner/remittances',
  storeAuth('stores_remittance_read'),
  validate(V.remittanceListValidation),
  remittanceController.listRemittances
);

router.get(
  '/partner/remittances/pending',
  storeAuth('stores_remittance_read'),
  remittanceController.getPending
);

router.post(
  '/partner/remittances/:remittance/submit',
  storeAuth('stores_remittance_manage'),
  validate(V.remittanceSubmitValidation),
  remittanceController.submitRemittance
);

router.post(
  '/partner/remittances/:remittance/reconcile',
  storeAuth('stores_remittance_manage'),
  validate(V.remittanceReconcileValidation),
  remittanceController.reconcileRemittance
);

module.exports = router;