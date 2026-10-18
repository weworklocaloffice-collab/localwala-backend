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
const featuredController = require('../controllers/stores.featured.controller');

const router = express.Router();

// Customer featured routes (requires appAuth)
router.get(
  '/featured',
  appAuth('stores_featured_read'),
  featuredController.getLive
);

// Partner featured routes (requires storeAuth)
router.post(
  '/partner/featured',
  storeAuth('stores_featured_write'),
  validate(V.featuredPlacementCreateValidation),
  featuredController.createFeatured
);

router.get(
  '/partner/featured',
  storeAuth('stores_featured_read'),
  validate(V.featuredPlacementListValidation),
  featuredController.listFeatured
);

router.get(
  '/partner/featured/:placement',
  storeAuth('stores_featured_read'),
  featuredController.getFeatured
);

router.patch(
  '/partner/featured/:placement',
  storeAuth('stores_featured_write'),
  validate(V.featuredPlacementUpdateValidation),
  featuredController.updateFeatured
);

router.post(
  '/partner/featured/:placement/approve',
  storeAuth('stores_featured_write'),
  validate(V.featuredPlacementTransitionValidation),
  featuredController.approveFeatured
);

router.post(
  '/partner/featured/:placement/reject',
  storeAuth('stores_featured_write'),
  validate(V.featuredPlacementTransitionValidation),
  featuredController.rejectFeatured
);

router.get(
  '/partner/featured/pending',
  storeAuth('stores_featured_read'),
  featuredController.getPending
);

module.exports = router;