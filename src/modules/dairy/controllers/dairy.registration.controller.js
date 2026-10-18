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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const tokenService = require('../../../services/token.service');
const otpVerificationService = require('../../../services/otp.verification.service');
const smsProviderConfigService = require('../../../services/sms.provider.config.service');
const dairyRegistrationService = require('../services/dairy.registration.service');
const dairyProfileService = require('../services/dairy.profile.service');
const ApiError = require('../../../utils/ApiError');
const { status: httpStatus } = require('http-status');

/**
 * Sends a registration OTP.
 *
 * Unlike login, this must succeed for a mobile that has no account yet — the
 * whole point of self-registration is that a new operator can sign up from the
 * app. It therefore only proves the number is reachable and does not require an
 * existing user.
 *
 * @returns {Object} OTP id
 */
const sendRegistrationOtp = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, role, locale } = req.body;

  if (role !== 'dairyPartner' && role !== 'dairyDriver') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Role not allowed');
  }

  // Signature: (countryCode, mobile, toNumber, appLocale, from, redirectUrl, kind)
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

/**
 * Partner self-registration.
 *
 * @returns {Object} tokens and profile
 */
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

  const created = await dairyRegistrationService.registerPartner({
    ...req.body,
    countryCode: parts[0],
    mobile: parts[1],
    locale,
  });

  const tokens = await tokenService.generateAuthTokens(created.user, '0.0.0.0', userAgent);
  if (remember === false) {
    delete tokens.refresh;
  }

  const profile = await dairyProfileService.getDairyLoginInfo(created.user.id);

  res.send({
    user: created.user,
    tokens,
    profile,
    business: pick(created.business, ['_id', 'name', 'businessModel', 'verified']),
    joiningRequest: pick(created.request, ['_id', 'status']),
  });
});

/**
 * Rider self-registration.
 *
 * @returns {Object} tokens and profile
 */
const registerDriver = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;

  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (!verification || verification.id !== id) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const parts = verification.provider.split(',');
  if (parts.length !== 3) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const created = await dairyRegistrationService.registerDriver({
    ...req.body,
    countryCode: parts[0],
    mobile: parts[1],
    locale,
  });

  const tokens = await tokenService.generateAuthTokens(created.user, '0.0.0.0', userAgent);
  if (remember === false) {
    delete tokens.refresh;
  }

  const profile = await dairyProfileService.getDairyLoginInfo(created.user.id);

  res.send({
    user: created.user,
    tokens,
    profile,
    driver: pick(created.driver, ['_id', 'business', 'payoutMode', 'vehicleType', 'canCapacity']),
  });
});

/**
 * Admin decision on a pending joining request.
 *
 * @returns {Object} updated request
 */
const listJoiningRequests = catchAsync(async (req, res) => {
  const result = await dairyRegistrationService.listJoiningRequests(req.query);
  res.send(result);
});

const reviewJoiningRequest = catchAsync(async (req, res) => {
  const { approve, reason } = req.body;
  const result = await dairyRegistrationService.reviewJoiningRequest(
    req.params.request,
    approve,
    req.params.id,
    reason
  );
  res.send(pick(result, ['_id', 'status', 'rejectionReason', 'verifiedAt']));
});

module.exports = {
  sendRegistrationOtp,
  registerPartner,
  registerDriver,
  listJoiningRequests,
  reviewJoiningRequest,
};