const express = require('express');
const validate = require('../../../middlewares/validate');
const controller = require('../controllers/jhatka.auth.controller');
const V = require('../validations/jhatka.auth.validation');

const router = express.Router();

/**
 * Self-registration for Jhatka partners. Public: an account does not exist yet,
 * so there is no token to scope. The handler creates the User, Business, pending
 * outlet and tenant assignment in one transaction.
 */
router.post(
  '/auth/register/send_otp',
  validate(V.sendRegistrationOtpBody),
  controller.sendRegistrationOtp
);

router.post(
  '/auth/register/partner',
  validate(V.registerPartnerBody),
  controller.registerPartner
);

module.exports = router;
