const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const tokenService = require('../../../services/token.service');
const otpVerificationService = require('../../../services/otp.verification.service');
const smsProviderConfigService = require('../../../services/sms.provider.config.service');
const onboardingService = require('../services/jhatka.onboarding.service');
const profileService = require('../services/jhatka.profile.service');

const sendRegistrationOtp = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;

  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    countryCode,
    mobileNumber,
    `+${countryCode}${mobileNumber}`,
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

  const created = await onboardingService.registerPartner({
    ...req.body,
    countryCode: parts[0],
    mobile: parts[1],
    locale,
  });

  const tokens = await tokenService.generateAuthTokens(
    created.user,
    req.connection.remoteAddress,
    userAgent
  );
  if (remember === false) {
    delete tokens.refresh;
  }

  const profile = await profileService.getLoginInfo(created.user.id);

  res.send({
    user: created.user,
    tokens,
    profile,
    verticals: ['jhatka'],
    business: pick(created.business, ['_id', 'name', 'businessModel', 'verified']),
    outlet: pick(created.outlet, ['_id', 'name', 'outletCode', 'status']),
  });
});

module.exports = {
  sendRegistrationOtp,
  registerPartner,
};
