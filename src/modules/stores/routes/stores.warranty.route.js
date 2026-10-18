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
const { appAuth, storeAuth } = require('../middlewares/stores.tenant');
const V = require('../validations/stores.validation');
const warrantyController = require('../controllers/stores.warranty.controller');

const router = express.Router();

// Customer warranty routes (requires appAuth)
router.post(
  '/warranty',
  appAuth('stores_warranty_write'),
  validate(V.warrantyCreateValidation),
  warrantyController.createWarrantyRequest
);

router.get(
  '/warranty',
  appAuth('stores_warranty_read'),
  validate(V.warrantyListValidation),
  warrantyController.listWarrantyRequests
);

router.get(
  '/warranty/:warranty',
  appAuth('stores_warranty_read'),
  warrantyController.getWarrantyRequest
);

router.patch(
  '/warranty/:warranty/:status',
  appAuth('stores_warranty_write'),
  validate(V.warrantyTransitionValidation),
  warrantyController.transitionWarranty
);

// Partner warranty routes (requires storeAuth)
router.get(
  '/partner/warranty',
  storeAuth('stores_warranty_read'),
  validate(V.warrantyListValidation),
  warrantyController.listWarrantyRequests
);

router.get(
  '/partner/warranty/:warranty',
  storeAuth('stores_warranty_read'),
  warrantyController.getWarrantyRequest
);

router.patch(
  '/partner/warranty/:warranty/:status',
  storeAuth('stores_warranty_write'),
  validate(V.warrantyTransitionValidation),
  warrantyController.transitionWarranty
);

router.get(
  '/partner/warranty/expiring',
  storeAuth('stores_warranty_read'),
  warrantyController.getExpiring
);

module.exports = router;