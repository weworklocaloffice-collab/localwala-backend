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
const superagent = require('superagent');
const otpGenerator = require('otp-generator');
const { SmsProviderConfig } = require('../models');
const ApiError = require('../utils/ApiError');
const businessSettingsService = require('./business.settings.service');
const otpVerificationService = require('./otp.verification.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const OtpWebVerification = require('../models/otp.web.verification.model');

const createConfig = async (param) => {
  if (param.isDefault === true || param.isDefault === 'true') {
    await SmsProviderConfig.updateMany({}, { $set: { isDefault: false } });
  }
  const details = await SmsProviderConfig.create(param);
  return { id: details.id, success: true };
};

const getSmsProviderBySlug = async (slugURL) => {
  const detail = await SmsProviderConfig.findOne(
    { slug: slugURL },
    {
      _id: 1,
      slug: 1,
      status: 1,
      credentials: 1,
      isDefault: 1,
      template: 1,
    }
  );
  if (detail && detail.id) {
    return detail;
  }
  return { success: false };
};

const getSmsProviderById = async (id) => {
  const info = await SmsProviderConfig.findById(id);
  return info;
};

const updateSmsProviderConfig = async (slug, param) => {
  if (param.isDefault === true || param.isDefault === 'true') {
    await SmsProviderConfig.updateMany({}, { $set: { isDefault: false } });
  }
  const smsProviderConfig = await getSmsProviderBySlug(slug);
  Object.assign(smsProviderConfig, param);
  await smsProviderConfig.save();
  return { success: true };
};

const sendTwilioDemoSMS = async (toNumber, locale) => {
  const smsProvider = await SmsProviderConfig.findOne({ slug: 'twilio' });
  if (!smsProvider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  const { credentials, template } = smsProvider;
  if (
    credentials.secret &&
    credentials.secret !== null &&
    credentials.secret !== '' &&
    credentials.token &&
    credentials.token !== null &&
    credentials.token !== '' &&
    credentials.from &&
    credentials.from !== null &&
    credentials.from !== ''
  ) {
    let smsTemplateName = 'Your verification code is: ##OTP##';
    if (template !== null && checkArrayNotEmpty(template)) {
      const translationIndex = template.filter((x) => x.code === locale);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        smsTemplateName = translationIndex[0].value;
      }
    }
    smsTemplateName = smsTemplateName.replace('##OTP##', `TEST-TWILIO`);
    const smsParam = {
      From: credentials.from,
      To: toNumber,
      Body: smsTemplateName,
    };
    try {
      const smsResponse = await superagent
        .post(`https://api.twilio.com/2010-04-01/Accounts/${credentials.secret}/Messages.json`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .auth(credentials.secret, credentials.token)
        .send(smsParam);
      if (smsResponse.status === 201 && smsResponse.body !== null) {
        return { success: true };
      }
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
    }
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
};

const findOneOrFirst = async (query) => {
  const foundDocument = await SmsProviderConfig.findOne(query);
  if (foundDocument) {
    return foundDocument;
  }
  const firstDocument = await SmsProviderConfig.findOne({});
  return firstDocument;
};

const sendOTPSMS = async (
  countryCode,
  mobile,
  toNumber,
  appLocale,
  from = 'app',
  redirectUrl = '',
  kind = 'login'
) => {
  const smsProvider = await findOneOrFirst({ isDefault: true });
  if (smsProvider && smsProvider.slug && smsProvider.slug !== null) {
    const { credentials, template } = smsProvider;
    const otpConfigs = await businessSettingsService.getOtpConfig();
    let generatedOTP = '';
    let otpType = 'num';
    let otpLengths = 6;
    let canResendOtps = false;
    if (
      otpConfigs &&
      otpConfigs !== null &&
      otpConfigs.otpType &&
      otpConfigs.otpType !== null &&
      otpConfigs.otpType !== ''
    ) {
      otpType = otpConfigs.otpType;
    }

    if (otpConfigs && otpConfigs !== null && otpConfigs.canResendOtp !== null) {
      canResendOtps = otpConfigs.canResendOtp;
    }

    if (
      otpConfigs &&
      otpConfigs !== null &&
      otpConfigs.otpLength &&
      otpConfigs.otpLength !== null &&
      otpConfigs.otpLength !== ''
    ) {
      otpLengths = otpConfigs.otpLength;
    }

    if (otpType === 'num') {
      generatedOTP = otpGenerator.generate(otpLengths, {
        digits: true,
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
    } else if (otpType === 'numstr') {
      generatedOTP = otpGenerator.generate(otpLengths, {
        digits: true,
        upperCaseAlphabets: true,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
    } else {
      generatedOTP = otpGenerator.generate(otpLengths, {
        digits: false,
        upperCaseAlphabets: true,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
    }
    if (smsProvider.slug === 'firebase') {
      if (from === 'app') {
        return {
          sent: false,
          target: 'web_modal',
          method: 'firebase',
          otpLength: otpLengths,
          canResendOtp: canResendOtps,
          id: 'firebase',
          provider: `${countryCode},${mobile},${toNumber}`,
        };
      }
      const webOtpData = new OtpWebVerification({
        provider: `${countryCode},${mobile},${toNumber}`,
        redirectUrl: `${redirectUrl}`,
        kind: `${kind}`,
        token: '',
        mode: 'firebase',
        locale: appLocale,
        status: false,
      });
      await OtpWebVerification.create(webOtpData);
      if (webOtpData) {
        return {
          id: webOtpData.id,
          sent: false,
          target: 'web_modal',
          method: 'firebase',
        };
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
    }
    if (smsProvider.slug === 'msg91') {
      if (from === 'app') {
        const otpData = await otpVerificationService.saveOTP({
          provider: `${countryCode},${mobile},${toNumber}`,
          otp: generatedOTP,
          mode: 'msg91',
          locale: appLocale,
        });
        if (otpData) {
          return {
            sent: false,
            target: 'web_modal',
            method: 'msg91',
            otpLength: otpLengths,
            canResendOtp: canResendOtps,
            id: otpData.id,
            provider: `${countryCode},${mobile},${toNumber}`,
          };
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
      }
      const webOtpData = new OtpWebVerification({
        provider: `${countryCode},${mobile},${toNumber}`,
        redirectUrl: `${redirectUrl}`,
        kind: `${kind}`,
        token: '',
        mode: 'msg91',
        locale: appLocale,
        status: false,
      });
      await OtpWebVerification.create(webOtpData);
      if (webOtpData) {
        return {
          id: webOtpData.id,
          sent: false,
          target: 'web_modal',
          method: 'msg91',
        };
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
    }
    if (smsProvider.slug === 'twilio') {
      if (
        credentials.secret &&
        credentials.secret !== null &&
        credentials.secret !== '' &&
        credentials.token &&
        credentials.token !== null &&
        credentials.token !== '' &&
        credentials.from &&
        credentials.from !== null &&
        credentials.from !== ''
      ) {
        let smsTemplateName = 'Your verification code is: ##OTP##';
        if (template !== null && checkArrayNotEmpty(template)) {
          const translationIndex = template.filter((x) => x.code === appLocale);
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            smsTemplateName = translationIndex[0].value;
          }
        }
        smsTemplateName = smsTemplateName.replace('##OTP##', `${generatedOTP}`);
        const smsParam = {
          From: credentials.from,
          Body: smsTemplateName,
          To: toNumber,
        };
        const smsResponse = await superagent
          .post(`https://api.twilio.com/2010-04-01/Accounts/${credentials.secret}/Messages.json`)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .auth(credentials.secret, credentials.token)
          .send(smsParam);

        if (smsResponse.status === 201 && smsResponse.body !== null) {
          const otpData = await otpVerificationService.saveOTP({
            provider: `${countryCode},${mobile},${toNumber}`,
            otp: generatedOTP,
            mode: 'twilio',
            locale: appLocale,
          });
          if (otpData) {
            return {
              sent: false,
              target: 'otp_screen',
              method: 'twilio',
              otpLength: otpLengths,
              canResendOtp: canResendOtps,
              id: otpData.id,
              provider: `${countryCode},${mobile},${toNumber}`,
            };
          }
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
    }
    if (smsProvider.slug === 'nexmo') {
      if (
        credentials.apiKey &&
        credentials.apiKey !== null &&
        credentials.apiKey !== '' &&
        credentials.apiSecret &&
        credentials.apiSecret !== null &&
        credentials.apiSecret !== '' &&
        credentials.from &&
        credentials.from !== null &&
        credentials.from !== ''
      ) {
        let smsTemplateName = 'Your verification code is: ##OTP##';
        if (template !== null && checkArrayNotEmpty(template)) {
          const translationIndex = template.filter((x) => x.code === appLocale);
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            smsTemplateName = translationIndex[0].value;
          }
        }
        smsTemplateName = smsTemplateName.replace('##OTP##', `${generatedOTP}`);
        const smsParam = {
          from: credentials.from,
          text: smsTemplateName,
          to: toNumber,
          api_key: credentials.apiKey,
          api_secret: credentials.apiSecret,
        };
        const smsResponse = await superagent
          .post(`https://rest.nexmo.com/sms/json`)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(smsParam);
        if (smsResponse.status === 200 && smsResponse.text !== null) {
          const otpData = await otpVerificationService.saveOTP({
            provider: `${countryCode},${mobile},${toNumber}`,
            otp: generatedOTP,
            mode: 'nexmo',
            locale: appLocale,
          });
          if (otpData) {
            return {
              sent: false,
              target: 'otp_screen',
              method: 'nexmo',
              otpLength: otpLengths,
              canResendOtp: canResendOtps,
              id: otpData.id,
              provider: `${countryCode},${mobile},${toNumber}`,
            };
          }
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
    }
    if (smsProvider.slug === 'sms_dot_to') {
      if (
        credentials.clientId &&
        credentials.clientId !== null &&
        credentials.clientId !== '' &&
        credentials.clientSecret &&
        credentials.clientSecret !== null &&
        credentials.clientSecret !== ''
      ) {
        const tokenParam = {
          client_id: credentials.clientId,
          secret: credentials.clientSecret,
          expires_in: 1,
        };
        const tokenResponse = await superagent
          .post('https://auth.sms.to/oauth/token')
          .set('Authorization', `Bearer <api_key>`)
          .set('Content-Type', 'application/json')
          .send(tokenParam);
        if (
          tokenResponse.status === 200 &&
          tokenResponse.body !== null &&
          tokenResponse.body.jwt &&
          tokenResponse.body.jwt !== null
        ) {
          let smsTemplateName = 'Your verification code is: ##OTP##';
          if (template !== null && checkArrayNotEmpty(template)) {
          const translationIndex = template.filter((x) => x.code === appLocale);
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex) && translationIndex[0].value) {
            smsTemplateName = translationIndex[0].value;
          }
          }
          smsTemplateName = smsTemplateName.replace('##OTP##', `${generatedOTP}`);
          const token = tokenResponse.body.jwt;
          const smsParam = {
            message: smsTemplateName,
            to: toNumber,
            bypass_optout: true,
            sender_id: 'SMSto',
            callback_url: 'https://example.com/callback/handler',
          };
          const smsResponse = await superagent
            .post('https://api.sms.to/sms/send')
            .set('Authorization', `Bearer ${token}`)
            .set('Content-Type', 'application/json')
            .send(smsParam);
          if (smsResponse.status === 200 && smsResponse.text !== null) {
            const otpData = await otpVerificationService.saveOTP({
              provider: `${countryCode},${mobile},${toNumber}`,
              otp: generatedOTP,
              mode: 'sms_dot_to',
              locale: appLocale,
            });
            if (otpData) {
              return {
                sent: false,
                target: 'otp_screen',
                method: 'sms_dot_to',
                otpLength: otpLengths,
                canResendOtp: canResendOtps,
                id: otpData.id,
                provider: `${countryCode},${mobile},${toNumber}`,
              };
            }
          }
          throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
    }
    if (smsProvider.slug === '2factor') {
      if (credentials.apiKey && credentials.apiKey !== null && credentials.apiKey !== '') {
        generatedOTP = otpGenerator.generate(4, {
          digits: true,
          upperCaseAlphabets: false,
          lowerCaseAlphabets: false,
          specialChars: false,
        });
        const { apiKey } = credentials;
        const url = `https://2factor.in/API/V1/${apiKey}/SMS/${toNumber}/${generatedOTP}/OTP1`;
        const smsResponse = await superagent.get(url);
        if (smsResponse.status === 200 && smsResponse.text !== null) {
          const otpData = await otpVerificationService.saveOTP({
            provider: `${countryCode},${mobile},${toNumber}`,
            otp: generatedOTP,
            mode: '2factor',
            locale: appLocale,
          });
          if (otpData) {
            return {
              sent: false,
              target: 'otp_screen',
              method: '2factor',
              otpLength: 4,
              canResendOtp: canResendOtps,
              id: otpData.id,
              provider: `${countryCode},${mobile},${toNumber}`,
            };
          }
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
    }
    if (smsProvider.slug === 'fast2sms') {
      if (
        credentials.apiKey &&
        credentials.apiKey !== null &&
        credentials.apiKey !== '' &&
        credentials.senderId &&
        credentials.senderId !== null &&
        credentials.senderId !== ''
      ) {
        const smsParam = {
          numbers: toNumber.replace(/\+/g, ''),
          sender_id: credentials.senderId,
        };
        if (credentials.route === 'dlt') {
          smsParam.route = 'dlt';
          smsParam.message = String(credentials.messageId || '');
          smsParam.variables_values = generatedOTP;
          if (credentials.entityId) {
            smsParam.entity_id = String(credentials.entityId);
          }
          if (credentials.templateId) {
            smsParam.template_id = String(credentials.templateId);
          }
        } else {
          smsParam.route = 'q';
          let smsTemplateName = 'Your verification code is: ##OTP##';
          if (template !== null && checkArrayNotEmpty(template)) {
            const translationIndex = template.filter((x) => x.code === appLocale);
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex) && translationIndex[0].value) {
              smsTemplateName = translationIndex[0].value;
            }
          }
          smsParam.message = smsTemplateName.replace('##OTP##', generatedOTP);
          smsParam.flash = 0;
        }
        let smsResponse;
        try {
          smsResponse = await superagent
            .post('https://www.fast2sms.com/dev/bulkV2')
            .set('Authorization', `${credentials.apiKey}`)
            .set('Content-Type', 'application/json')
            .send(smsParam);
        } catch (error) {
          const fast2SmsError = error.response && error.response.body ? (typeof error.response.body === 'string' ? error.response.body : (error.response.body.message || JSON.stringify(error.response.body))) : error.message;
          throw new ApiError(httpStatus.NOT_FOUND, fast2SmsError || 'Fast2SMS request failed');
        }
        if (smsResponse.status === 200 && smsResponse.body && smsResponse.body.return === true) {
          const otpData = await otpVerificationService.saveOTP({
            provider: `${countryCode},${mobile},${toNumber}`,
            otp: generatedOTP,
            mode: 'fast2sms',
            locale: appLocale,
          });
          if (otpData) {
            return {
              sent: false,
              target: 'otp_screen',
              method: 'fast2sms',
              otpLength: otpLengths,
              canResendOtp: canResendOtps,
              id: otpData.id,
              provider: `${countryCode},${mobile},${toNumber}`,
            };
          }
        }
        throw new ApiError(httpStatus.NOT_FOUND, smsResponse && smsResponse.body && typeof smsResponse.body === 'object' && smsResponse.body.message ? smsResponse.body.message : 'credentials not found');
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
    }
    throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
};

const resendOTPSMS = async (provider, otp, locale, gateway) => {
  const mobileNumber = provider.split(',');
  if (mobileNumber !== null && checkArrayNotEmpty(mobileNumber)) {
    const toNumber = mobileNumber[2];
    const smsProvider = await SmsProviderConfig.findOne({ slug: gateway });
    if (smsProvider && smsProvider.slug && smsProvider.slug !== null) {
      const { credentials, template } = smsProvider;
      if (smsProvider.slug === 'twilio') {
        if (
          credentials.secret &&
          credentials.secret !== null &&
          credentials.secret !== '' &&
          credentials.token &&
          credentials.token !== null &&
          credentials.token !== '' &&
          credentials.from &&
          credentials.from !== null &&
          credentials.from !== ''
        ) {
          let smsTemplateName = 'Your verification code is: ##OTP##';
          if (template !== null && checkArrayNotEmpty(template)) {
            const translationIndex = template.filter((x) => x.code === locale);
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              smsTemplateName = translationIndex[0].value;
            }
          }
          smsTemplateName = smsTemplateName.replace('##OTP##', `${otp}`);
          const smsParam = {
            From: credentials.from,
            Body: smsTemplateName,
            To: toNumber,
          };
          const smsResponse = await superagent
            .post(`https://api.twilio.com/2010-04-01/Accounts/${credentials.secret}/Messages.json`)
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .auth(credentials.secret, credentials.token)
            .send(smsParam);
          if (smsResponse.status === 201 && smsResponse.body !== null) {
            return { success: true };
          }
          throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
      if (smsProvider.slug === 'nexmo') {
        if (
          credentials.apiKey &&
          credentials.apiKey !== null &&
          credentials.apiKey !== '' &&
          credentials.apiSecret &&
          credentials.apiSecret !== null &&
          credentials.apiSecret !== '' &&
          credentials.from &&
          credentials.from !== null &&
          credentials.from !== ''
        ) {
          let smsTemplateName = 'Your verification code is: ##OTP##';
          if (template !== null && checkArrayNotEmpty(template)) {
            const translationIndex = template.filter((x) => x.code === locale);
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              smsTemplateName = translationIndex[0].value;
            }
          }
          smsTemplateName = smsTemplateName.replace('##OTP##', `${otp}`);
          const smsParam = {
            from: credentials.from,
            text: smsTemplateName,
            to: toNumber,
            api_key: credentials.apiKey,
            api_secret: credentials.apiSecret,
          };
          const smsResponse = await superagent
            .post(`https://rest.nexmo.com/sms/json`)
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .send(smsParam);
          if (smsResponse.status === 200 && smsResponse.text !== null) {
            return { success: true };
          }
          throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
        }
      }
      if (smsProvider.slug === 'sms_dot_to') {
        if (
          credentials.clientId &&
          credentials.clientId !== null &&
          credentials.clientId !== '' &&
          credentials.clientSecret &&
          credentials.clientSecret !== null &&
          credentials.clientSecret !== ''
        ) {
          const tokenParam = {
            client_id: credentials.clientId,
            secret: credentials.clientSecret,
            expires_in: 1,
          };
          const tokenResponse = await superagent
            .post('https://auth.sms.to/oauth/token')
            .set('Authorization', `Bearer <api_key>`)
            .set('Content-Type', 'application/json')
            .send(tokenParam);
          if (
            tokenResponse.status === 200 &&
            tokenResponse.body !== null &&
            tokenResponse.body.jwt &&
            tokenResponse.body.jwt !== null
          ) {
            let smsTemplateName = 'Your verification code is: ##OTP##';
          if (template !== null && checkArrayNotEmpty(template)) {
            const translationIndex = template.filter((x) => x.code === locale);
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex) && translationIndex[0].value) {
              smsTemplateName = translationIndex[0].value;
            }
          }
          smsTemplateName = smsTemplateName.replace('##OTP##', `${otp}`);
            const token = tokenResponse.body.jwt;
            const smsParam = {
              message: smsTemplateName,
              to: toNumber,
              bypass_optout: true,
              sender_id: 'SMSto',
              callback_url: 'https://example.com/callback/handler',
            };
            const smsResponse = await superagent
              .post('https://api.sms.to/sms/send')
              .set('Authorization', `Bearer ${token}`)
              .set('Content-Type', 'application/json')
              .send(smsParam);
            if (smsResponse.status === 200 && smsResponse.text !== null) {
              return { success: true };
            }
            throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
          }
          throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
      if (smsProvider.slug === '2factor') {
        if (credentials.apiKey && credentials.apiKey !== null && credentials.apiKey !== '') {
          const { apiKey } = credentials;
          const url = `https://2factor.in/API/V1/${apiKey}/SMS/${toNumber}/${otp}/OTP1`;
          const smsResponse = await superagent.get(url);
          if (smsResponse.status === 200 && smsResponse.text !== null) {
            return { success: true };
          }
          throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
      if (smsProvider.slug === 'fast2sms') {
        if (
          credentials.apiKey &&
          credentials.apiKey !== null &&
          credentials.apiKey !== '' &&
          credentials.senderId &&
          credentials.senderId !== null &&
          credentials.senderId !== ''
        ) {
          const smsParam = {
            numbers: toNumber.replace(/\+/g, ''),
            sender_id: credentials.senderId,
          };
          if (credentials.route === 'dlt') {
            smsParam.route = 'dlt';
            smsParam.message = String(credentials.messageId || '');
            smsParam.variables_values = otp;
            if (credentials.entityId) {
              smsParam.entity_id = String(credentials.entityId);
            }
            if (credentials.templateId) {
              smsParam.template_id = String(credentials.templateId);
            }
          } else {
            smsParam.route = 'q';
            let smsTemplateName = 'Your verification code is: ##OTP##';
            if (template !== null && checkArrayNotEmpty(template)) {
              const translationIndex = template.filter((x) => x.code === locale);
              if (translationIndex !== null && checkArrayNotEmpty(translationIndex) && translationIndex[0].value) {
                smsTemplateName = translationIndex[0].value;
              }
            }
            smsParam.message = smsTemplateName.replace('##OTP##', otp);
            smsParam.flash = 0;
          }
          let smsResponse;
          try {
            smsResponse = await superagent
              .post('https://www.fast2sms.com/dev/bulkV2')
              .set('Authorization', `${credentials.apiKey}`)
              .set('Content-Type', 'application/json')
              .send(smsParam);
          } catch (error) {
            const fast2SmsError = error.response && error.response.body ? (typeof error.response.body === 'string' ? error.response.body : (error.response.body.message || JSON.stringify(error.response.body))) : error.message;
            throw new ApiError(httpStatus.NOT_FOUND, fast2SmsError || 'Fast2SMS request failed');
          }
          if (smsResponse.status === 200 && smsResponse.body && smsResponse.body.return === true) {
            return { success: true };
          }
          throw new ApiError(httpStatus.NOT_FOUND, smsResponse && smsResponse.body && typeof smsResponse.body === 'object' && smsResponse.body.message ? smsResponse.body.message : 'credentials not found');
        }
        throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
    }
    throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
};

const sendNexmoDemoSMS = async (toNumber, locale) => {
  const smsProvider = await SmsProviderConfig.findOne({ slug: 'nexmo' });
  if (!smsProvider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  const { credentials, template } = smsProvider;
  if (
    credentials.apiKey &&
    credentials.apiKey !== null &&
    credentials.apiKey !== '' &&
    credentials.apiSecret &&
    credentials.apiSecret !== null &&
    credentials.apiSecret !== '' &&
    credentials.from &&
    credentials.from !== null &&
    credentials.from !== ''
  ) {
    let smsTemplateName = 'Your verification code is: ##OTP##';
    if (template !== null && checkArrayNotEmpty(template)) {
      const translationIndex = template.filter((x) => x.code === locale);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        smsTemplateName = translationIndex[0].value;
      }
    }
    smsTemplateName = smsTemplateName.replace('##OTP##', `TEST-NEXMO`);
    const smsParam = {
      from: credentials.from,
      text: smsTemplateName,
      to: toNumber,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
    };
    const smsResponse = await superagent
      .post(`https://rest.nexmo.com/sms/json`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(smsParam);
    if (smsResponse.status === 200 && smsResponse.text !== null) {
      return { success: true };
    }
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
};

const sendSMStoDemoSMS = async (toNumber, locale) => {
  const smsProvider = await SmsProviderConfig.findOne({ slug: 'sms_dot_to' });
  if (!smsProvider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  const { credentials, template } = smsProvider;
  if (
    credentials.clientId &&
    credentials.clientId !== null &&
    credentials.clientId !== '' &&
    credentials.clientSecret &&
    credentials.clientSecret !== null &&
    credentials.clientSecret !== ''
  ) {
    const tokenParam = {
      client_id: credentials.clientId,
      secret: credentials.clientSecret,
      expires_in: 1,
    };
    const tokenResponse = await superagent
      .post('https://auth.sms.to/oauth/token')
      .set('Authorization', `Bearer <api_key>`)
      .set('Content-Type', 'application/json')
      .send(tokenParam);
    if (
      tokenResponse.status === 200 &&
      tokenResponse.body !== null &&
      tokenResponse.body.jwt &&
      tokenResponse.body.jwt !== null
    ) {
      let smsTemplateName = 'Your verification code is: ##OTP##';
      if (template !== null && checkArrayNotEmpty(template)) {
        const translationIndex = template.filter((x) => x.code === locale);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex) && translationIndex[0].value) {
        smsTemplateName = translationIndex[0].value;
      }
      }
      smsTemplateName = smsTemplateName.replace('##OTP##', `TEST-SMS.to`);
      const token = tokenResponse.body.jwt;
      const smsParam = {
        message: smsTemplateName,
        to: toNumber,
        bypass_optout: true,
        sender_id: 'SMSto',
        callback_url: 'https://example.com/callback/handler',
      };
      const smsResponse = await superagent
        .post('https://api.sms.to/sms/send')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(smsParam);
      if (smsResponse.status === 200 && smsResponse.text !== null) {
        return { success: true };
      }
      throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
    }
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
};

const send2FactorDemoSMS = async (toNumber, locale) => {
  const smsProvider = await SmsProviderConfig.findOne({ slug: '2factor' });
  if (!smsProvider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  const { credentials } = smsProvider;
  if (credentials.apiKey && credentials.apiKey !== null && credentials.apiKey !== '') {
    const { apiKey } = credentials;
    const smsResponse = await superagent.get(
      `https://2factor.in/API/V1/${apiKey}/SMS/${toNumber}/1111/${locale}`
    );
    if (smsResponse.status === 200 && smsResponse.text !== null) {
      return { success: true };
    }
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
};

const sendFast2SMSDemoSMS = async (toNumber, locale) => {
  const smsProvider = await SmsProviderConfig.findOne({ slug: 'fast2sms' });
  if (!smsProvider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
  }
  const { credentials, template } = smsProvider;
  if (
    credentials.apiKey &&
    credentials.apiKey !== null &&
    credentials.apiKey !== '' &&
    credentials.senderId &&
    credentials.senderId !== null &&
    credentials.senderId !== ''
  ) {
    const smsParam = {
      numbers: toNumber.replace(/\+/g, ''),
      sender_id: credentials.senderId,
    };
    if (credentials.route && credentials.route === 'dlt') {
      smsParam.route = 'dlt';
      smsParam.message = credentials.messageId || '';
      smsParam.variables_values = 'TEST-FAST2SMS';
    } else {
      smsParam.route = 'q';
      smsParam.message = 'TEST-FAST2SMS';
      smsParam.flash = 0;
      if (template !== null && checkArrayNotEmpty(template)) {
        const translationIndex = template.filter((x) => x.code === locale);
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex) && translationIndex[0].value) {
          smsParam.message = translationIndex[0].value;
        }
      }
    }
    if (credentials.entityId) {
      smsParam.entity_id = String(credentials.entityId);
    }
    if (credentials.templateId) {
      smsParam.template_id = String(credentials.templateId);
    }
    let smsResponse;
    try {
      smsResponse = await superagent
        .post('https://www.fast2sms.com/dev/bulkV2')
        .set('Authorization', `${credentials.apiKey}`)
        .set('Content-Type', 'application/json')
        .send(smsParam);
    } catch (error) {
      const fast2SmsError = error.response && error.response.body ? (typeof error.response.body === 'string' ? error.response.body : (error.response.body.message || JSON.stringify(error.response.body))) : error.message;
      throw new ApiError(httpStatus.NOT_FOUND, fast2SmsError || 'Fast2SMS request failed');
    }
    if (smsResponse.status === 200 && smsResponse.body && smsResponse.body.return === true) {
      return { success: true };
    }
    throw new ApiError(httpStatus.NOT_FOUND, smsResponse && smsResponse.body && typeof smsResponse.body === 'object' && smsResponse.body.message ? smsResponse.body.message : 'credentials not found');
  }
  throw new ApiError(httpStatus.NOT_FOUND, 'credentials not found');
};

module.exports = {
  createConfig,
  getSmsProviderBySlug,
  updateSmsProviderConfig,
  getSmsProviderById,
  sendTwilioDemoSMS,
  sendOTPSMS,
  resendOTPSMS,
  sendNexmoDemoSMS,
  sendSMStoDemoSMS,
  send2FactorDemoSMS,
  sendFast2SMSDemoSMS,
};
