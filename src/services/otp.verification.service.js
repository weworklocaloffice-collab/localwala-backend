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

const { status: httpStatus } = require('http-status');
const { OtpVerification, OtpWebVerification } = require('../models');
const ApiError = require('../utils/ApiError');

const saveOTP = async (otpBody) => {
  const otpContent = new OtpVerification({
    provider: otpBody.provider,
    otp: otpBody.otp,
    mode: otpBody.mode,
    locale: otpBody.locale,
    status: false,
  });
  return OtpVerification.create(otpContent);
};

const getOTPById = async (id) => {
  return OtpVerification.findById(id);
};

const deleteOTP = async (otpId) => {
  const otpContent = await getOTPById(otpId);
  if (!otpContent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await otpContent.deleteOne();
  return otpContent;
};

const verifyOTP = async (id, _provider, _otp) => {
  const otpData = await OtpVerification.findOne({ _id: id, otp: _otp, status: false });
  if (!otpData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wrong OTP');
  }
  Object.assign(otpData, { status: true });
  await otpData.save();
  return otpData;
};

const verifyFirebaseOTP = async (id) => {
  const otpData = await OtpVerification.findOne({ _id: id, status: false });
  if (otpData && otpData !== null && otpData.id && otpData.id !== null && otpData.id !== '') {
    Object.assign(otpData, { status: true });
    await otpData.save();
    return { success: true, data: otpData };
  }
  return { success: false, otp: '000000' };
};

const verifyOtpForAuthentication = async (id, _otp) => {
  const otpData = await OtpVerification.findOne({ _id: id, otp: _otp, status: true });
  if (!otpData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wrong OTP');
  }
  await otpData.deleteOne();
  return otpData;
};

const verifyWithPhoneOTP = async (id) => {
  const otpData = await OtpVerification.findOne({ _id: id, status: true });
  if (!otpData) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Verification failed');
  }
  await otpData.deleteOne();
  return otpData;
};

const checkOtpInfoById = async (id) => {
  const otpData = await OtpVerification.findOne({ _id: id, status: false });
  return otpData;
};

const resendOTPById = async (id) => {
  const otpContent = await getOTPById(id);
  if (!otpContent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return otpContent;
};

const checkWebOtpInfoById = async (id) => {
  const otpData = await OtpWebVerification.findOne({ _id: id, status: false });
  return otpData;
};

const verifyWebOtpSuccess = async (id, verifyToken) => {
  const otpData = await OtpWebVerification.findOne({ _id: id, status: false });
  if (otpData && otpData !== null && otpData.id && otpData.id !== null && otpData.id !== '') {
    Object.assign(otpData, { token: verifyToken, status: true });
    await otpData.save();
    return { success: true, otpData };
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'Verification failed');
};

const verifyWebVerification = async (id) => {
  const otpContent = await OtpWebVerification.findOne({ _id: id, status: true });
  if (!otpContent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return otpContent;
};

const deleteWebOtp = async (id) => {
  const otpContent = await OtpWebVerification.findOne({ _id: id, status: true });
  if (otpContent) {
    await otpContent.deleteOne();
  }
};

module.exports = {
  saveOTP,
  getOTPById,
  deleteOTP,
  verifyOTP,
  resendOTPById,
  verifyOtpForAuthentication,
  checkOtpInfoById,
  verifyFirebaseOTP,
  verifyWithPhoneOTP,
  checkWebOtpInfoById,
  verifyWebOtpSuccess,
  verifyWebVerification,
  deleteWebOtp,
};

