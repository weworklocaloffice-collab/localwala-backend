const express = require('express');
const validate = require('../../../middlewares/validate');
const controller = require('../controllers/ls.auth.controller');
const V = require('../validations/ls.auth.validation');

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
