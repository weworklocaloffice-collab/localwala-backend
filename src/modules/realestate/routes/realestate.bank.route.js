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
const bankAuth = require('../middlewares/realestate.bank.auth');
const controller = require('../controllers/realestate.bank.controller');
const V = require('../validations/realestate.bank.validation');
const UserValidation = require('../../../validations/user.validation');

const router = express.Router();

/**
 * Bank routes. Mounted at `/v1/realestate/bank`.
 *
 * `bankAuth` on every route — resolves the bank from the token and
 * refuses non-banks with 403. No bank id in any path (plan §7.1).
 * The three bank-owned transitions (SANCTIONED / REJECTED /
 * DISBURSED) live ONLY here; the rights strings for them exist ONLY
 * in the `bank` role array (BR-10).
 */

router.get('/applications', bankAuth, controller.listApplications);
router.get('/applications/:id', bankAuth, controller.getApplication);
router.get('/offers', bankAuth, controller.listOffers);
router.post('/offers', bankAuth, validate(V.createOffer), controller.createOffer);
router.post('/applications/:id/status/:status', bankAuth, validate(V.setStatus), controller.setApplicationStatus);
router.get('/customers', bankAuth, controller.listCustomers);
router.get('/commissions', bankAuth, controller.listCommissions);
router.patch(
  '/update_password/:id',
  bankAuth,
  validate(UserValidation.updatePasswordValidation),
  controller.updatePassword
);
router.get('/documents', bankAuth, controller.listBankDocuments);
router.get('/me', bankAuth, controller.getProfile);

module.exports = router;
