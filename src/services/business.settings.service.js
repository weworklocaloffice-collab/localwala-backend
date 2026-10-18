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
const { BusinessSettings } = require('../models');
const ApiError = require('../utils/ApiError');

const createSettings = async (param) => {
  if ((await BusinessSettings.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const settingData = new BusinessSettings({
    companyName: param.companyName,
    email: param.email,
    mobile: param.mobile,
    country: param.country,
    address: param.address,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    timezone: param.timezone,
    timeFormat: param.timeFormat,
    defaultCountryCode: param.defaultCountryCode,
    currency: param.currency,
    currencySide: param.currencySide,
    decimalPoint: param.decimalPoint,
    cookiesText: param.cookiesText,
    commission: param.commission,
    commissionDelivery: param.commissionDelivery,
    haveFreeDeliveryInTotal: param.haveFreeDeliveryInTotal,
    freeDelivery:
      param && param.freeDelivery && param.freeDelivery !== null && param.freeDelivery !== ''
        ? param.freeDelivery
        : 0,
    haveFreeDeliveryInDistance: param.haveFreeDeliveryInDistance,
    freeDeliveryInDistance:
      param &&
      param.freeDeliveryInDistance &&
      param.freeDeliveryInDistance !== null &&
      param.freeDeliveryInDistance !== ''
        ? param.freeDeliveryInDistance
        : 0,
    deliveryChargeMethod:
      param &&
      param.deliveryChargeMethod &&
      param.deliveryChargeMethod !== null &&
      param.deliveryChargeMethod !== ''
        ? param.deliveryChargeMethod
        : 'distance',
    deliveryChargeAmount:
      param &&
      param.deliveryChargeAmount &&
      param.deliveryChargeAmount !== null &&
      param.deliveryChargeAmount !== ''
        ? param.deliveryChargeAmount
        : 0,
    vegNonVegOption: param.vegNonVegOption,
    commissionBasedSystem: param.commissionBasedSystem,
    subscriptionBasedSystem: param.subscriptionBasedSystem,
    includeTaxOnFood: param.includeTaxOnFood,
    foodTaxName: param.foodTaxName,
    foodTaxAmount:
      param && param.foodTaxAmount && param.foodTaxAmount !== null && param.foodTaxAmount !== ''
        ? param.foodTaxAmount
        : 0,
    foodTaxType: param.foodTaxType,
    receiveNotificationAdmin: param.receiveNotificationAdmin,
    additionalServiceCharge: param.additionalServiceCharge,
    additionalServiceName: param.additionalServiceName,
    additionalServiceAmount:
      param &&
      param.additionalServiceAmount &&
      param.additionalServiceAmount !== null &&
      param.additionalServiceAmount !== ''
        ? param.additionalServiceAmount
        : 0,
    partialPayment: param.partialPayment,
    partialAmountPayment: param.partialAmountPayment,
    guestCheckout: param.guestCheckout,
    logo: param.logo,
    favicon: param.favicon,
    maintenance: param.maintenance,
    findMode: param.findMode,
    deliveryArea: param.deliveryArea,
    socialLinks: param.socialLinks,
    refundRequest: param.refundRequest,
    websiteUrl: param.websiteUrl,
    otpType: param.otpType,
    canResendOtp: param.canResendOtp,
    otpLength: param.otpLength,
    foodLicenseImage: param.foodLicenseImage,
    foodLicenseName: param.foodLicenseName,
    foodLicenseWebsite: param.foodLicenseWebsite,
    foodLicense: param.foodLicense,
    complianceForm: param.complianceForm,
    // Real Estate vertical block (plan §9.3). Only written when the caller
    // supplies it — an undefined here must not wipe an existing block.
    ...(param.realestate !== undefined ? { realestate: param.realestate } : {}),
  });
  await BusinessSettings.create(settingData);
  return { success: true };
};

const getSettings = async () => {
  const settings = await BusinessSettings.findOne();
  return settings;
};

const getSettingsId = async (id) => {
  return BusinessSettings.findById(id);
};

const updateSettings = async (businessId, param) => {
  const settings = await getSettingsId(businessId);
  if (!settings) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const settingsData = {
    companyName: param.companyName,
    email: param.email,
    mobile: param.mobile,
    country: param.country,
    address: param.address,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    timezone: param.timezone,
    timeFormat: param.timeFormat,
    defaultCountryCode: param.defaultCountryCode,
    currency: param.currency,
    currencySide: param.currencySide,
    decimalPoint: param.decimalPoint,
    cookiesText: param.cookiesText,
    commission: param.commission,
    commissionDelivery: param.commissionDelivery,
    haveFreeDeliveryInTotal: param.haveFreeDeliveryInTotal,
    freeDelivery:
      param && param.freeDelivery && param.freeDelivery !== null && param.freeDelivery !== ''
        ? param.freeDelivery
        : 0,
    haveFreeDeliveryInDistance: param.haveFreeDeliveryInDistance,
    freeDeliveryInDistance:
      param &&
      param.freeDeliveryInDistance &&
      param.freeDeliveryInDistance !== null &&
      param.freeDeliveryInDistance !== ''
        ? param.freeDeliveryInDistance
        : 0,
    deliveryChargeMethod:
      param &&
      param.deliveryChargeMethod &&
      param.deliveryChargeMethod !== null &&
      param.deliveryChargeMethod !== ''
        ? param.deliveryChargeMethod
        : 'distance',
    deliveryChargeAmount:
      param &&
      param.deliveryChargeAmount &&
      param.deliveryChargeAmount !== null &&
      param.deliveryChargeAmount !== ''
        ? param.deliveryChargeAmount
        : 0,
    vegNonVegOption: param.vegNonVegOption,
    commissionBasedSystem: param.commissionBasedSystem,
    subscriptionBasedSystem: param.subscriptionBasedSystem,
    includeTaxOnFood: param.includeTaxOnFood,
    foodTaxName: param.foodTaxName,
    foodTaxAmount:
      param && param.foodTaxAmount && param.foodTaxAmount !== null && param.foodTaxAmount !== ''
        ? param.foodTaxAmount
        : 0,
    foodTaxType: param.foodTaxType,
    receiveNotificationAdmin: param.receiveNotificationAdmin,
    additionalServiceCharge: param.additionalServiceCharge,
    additionalServiceName: param.additionalServiceName,
    additionalServiceAmount:
      param &&
      param.additionalServiceAmount &&
      param.additionalServiceAmount !== null &&
      param.additionalServiceAmount !== ''
        ? param.additionalServiceAmount
        : 0,
    partialPayment: param.partialPayment,
    partialAmountPayment: param.partialAmountPayment,
    guestCheckout: param.guestCheckout,
    logo: param.logo,
    favicon: param.favicon,
    maintenance: param.maintenance,
    findMode: param.findMode,
    deliveryArea: param.deliveryArea,
    socialLinks: param.socialLinks,
    refundRequest: param.refundRequest,
    websiteUrl: param.websiteUrl,
    otpType: param.otpType,
    canResendOtp: param.canResendOtp,
    otpLength: param.otpLength,
    foodLicenseImage: param.foodLicenseImage,
    foodLicenseName: param.foodLicenseName,
    foodLicenseWebsite: param.foodLicenseWebsite,
    foodLicense: param.foodLicense,
    complianceForm: param.complianceForm,
    // Real Estate vertical block (plan §9.3). Same guard as create: never
    // wipe an existing block when the caller sends no `realestate` key.
    ...(param.realestate !== undefined ? { realestate: param.realestate } : {}),
  };

  Object.assign(settings, settingsData);
  await settings.save();
  return { success: true };
};

const getVendorBusinessSetting = async () => {
  const business = await BusinessSettings.findOne(
    {},
    {
      maintenance: 1,
      currencySide: 1,
      decimalPoint: 1,
      currency: 1,
      companyName: 1,
      logo: 1,
      email: 1,
      mobile: 1,
      defaultCountryCode: 1,
      websiteUrl: 1,
      _id: 0,
    }
  );
  return business;
};

const getPublicBusinessSettings = async () => {
  const settings = await BusinessSettings.findOne(
    {},
    {
      address: 1,
      cookiesText: 1,
      country: 1,
      email: 1,
      favicon: 1,
      guestCheckout: 1,
      maintenance: 1,
      currencySide: 1,
      mobile: 1,
      socialLinks: 1,
      timeFormat: 1,
      timezone: 1,
      decimalPoint: 1,
      currency: 1,
      companyName: 1,
      defaultCountryCode: 1,
      websiteUrl: 1,
      logo: 1,
      _id: 0,
    }
  );
  return settings;
};

const getOtpConfig = async () => {
  const config = await BusinessSettings.findOne(
    {},
    {
      otpType: 1,
      canResendOtp: 1,
      otpLength: 1,
      _id: 0,
    }
  );
  return config;
};

const getBusinessSettingForSelfRegistration = async () => {
  const config = await BusinessSettings.findOne(
    {},
    {
      commissionBasedSystem: 1,
      subscriptionBasedSystem: 1,
      _id: 0,
    }
  );
  return config;
};

module.exports = {
  createSettings,
  getSettings,
  updateSettings,
  getVendorBusinessSetting,
  getPublicBusinessSettings,
  getOtpConfig,
  getBusinessSettingForSelfRegistration,
};

