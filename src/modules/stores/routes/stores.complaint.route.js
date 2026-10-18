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
const complaintController = require('../controllers/stores.complaint.controller');

const router = express.Router();

// Customer complaint routes (requires appAuth)
router.post(
  '/complaints',
  appAuth('stores_complaint_write'),
  validate(V.complaintCreateValidation),
  complaintController.createComplaint
);

router.get(
  '/complaints',
  appAuth('stores_complaint_read'),
  validate(V.complaintListValidation),
  complaintController.listCustomerComplaints
);

router.get(
  '/complaints/:complaint',
  appAuth('stores_complaint_read'),
  complaintController.getComplaint
);

// Partner complaint routes (requires storeAuth)
router.get(
  '/partner/complaints',
  storeAuth('stores_complaint_read'),
  validate(V.complaintListValidation),
  complaintController.listComplaints
);

router.get(
  '/partner/complaints/:complaint',
  storeAuth('stores_complaint_read'),
  complaintController.getComplaint
);

router.patch(
  '/partner/complaints/:complaint/:status',
  storeAuth('stores_complaint_write'),
  validate(V.complaintTransitionValidation),
  complaintController.transitionComplaint
);

router.get(
  '/partner/complaints/open',
  storeAuth('stores_complaint_read'),
  complaintController.getOpenComplaints
);

router.get(
  '/partner/complaints/outlet/:outlet',
  storeAuth('stores_complaint_read'),
  complaintController.getByOutlet
);

module.exports = router;