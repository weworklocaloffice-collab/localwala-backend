const express = require('express');
const validate = require('../../../middlewares/validate');
const controller = require('../controllers/realestate.auth.controller');
const V = require('../validations/realestate.auth.validation');

const router = express.Router();

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
