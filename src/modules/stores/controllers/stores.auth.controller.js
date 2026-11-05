const catchAsync = require('../../../utils/catchAsync');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const tokenService = require('../../../services/token.service');
const otpVerificationService = require('../../../services/otp.verification.service');
const smsProviderConfigService = require('../../../services/sms.provider.config.service');

const sendRegistrationOtp = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const toNumber = `+${String(countryCode).replace(/^\+/, '')}${mobileNumber}`;

  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    countryCode,
    mobileNumber,
    toNumber,
    locale,
    'app',
    '',
    'register'
  );
  res.send(smsProvider);
});

const registerPartner = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;

  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (!verification || verification.id !== id) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const parts = verification.provider.split(',');
  if (parts.length !== 3) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const { User } = require('../../../models');
  const existing = await User.findOne({
    countryCode: parts[0],
    mobile: parts[1],
  });
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'Phone already registered');
  }

  const user = await User.create({
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    countryCode: parts[0],
    mobile: parts[1],
    password: req.body.password,
    role: 'user',
    isMobileVerified: true,
    status: true,
    locale: locale || 'en',
  });

  const tokens = await tokenService.generateAuthTokens(
    user,
    req.connection.remoteAddress,
    userAgent
  );
  if (remember === false) {
    delete tokens.refresh;
  }

  res.send({
    user,
    tokens,
    profile: null,
    verticals: ['stores'],
  });
});

module.exports = {
  sendRegistrationOtp,
  registerPartner,
};
