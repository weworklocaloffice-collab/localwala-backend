/**
 * LocalWala — Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
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
const realestateTenantMiddleware = require('../middlewares/realestate.tenant');
const controller = require('../controllers/realestate.auth.controller');
const V = require('../validations/realestate.auth.validation');

const router = express.Router();

router.post(
  '/register/send_otp',
  validate(V.sendRegistrationOtpBody),
  controller.sendRegistrationOtp
);

router.post(
  '/register/partner',
  validate(V.registerPartnerBody),
  controller.registerPartner
);

module.exports = router;
