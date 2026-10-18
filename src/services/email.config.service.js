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

const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { status: httpStatus } = require('http-status');
const _ = require('lodash');
const Handlebars = require('handlebars');
const {
  EmailConfig,
  EmailTemplate,
  RefundRequestReason,
  User,
  TiffinSubscriptionRefundRequestReason,
  DiningBookingRefundRequestReason,
  Orders,
  BusinessSettings,
  SupportChatRoom,
  SupportChatConversion,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

function formatRoleName(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
}

const createEmailConfig = async (param) => {
  if ((await EmailConfig.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const details = await EmailConfig.create(param);
  return { id: details.id, success: true };
};

const getEmailConfig = async () => {
  return EmailConfig.findOne();
};

const updateEmailConfig = async (param) => {
  const emailConfig = await getEmailConfig();

  Object.assign(emailConfig, param);
  await emailConfig.save();
  return { success: true };
};

const sendDemoMail = async (toEmail) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  // const emailTemplate = Handlebars.compile(userVerificationHtml);
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: toEmail,
    subject: 'Demo Email',
    text: 'Demo Email',
    // html: emailTemplate({ otp: '123' }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendVerificationEmail = async (toEmail, otp, locale) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'user-verification' });
  let emailTitle = 'Email Verification';
  let emailContent =
    'Hi, Thank you for choosing FoodBite PVT LTD. Use the following OTP to complete your Sign-up procedures. OTP is valid for 5 minutes';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: toEmail,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: otp,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendUserLoginEmail = async (toEmail, otp, locale) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'user-verification' });
  let emailTitle = 'Email Verification';
  let emailContent =
    'Hi, Thank you for choosing FoodBite PVT LTD. Use the following OTP to complete your Sign-up procedures. OTP is valid for 5 minutes';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: toEmail,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: otp,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendRefundRequestToAdmin = async (orderId, reasonId, refundId) => {
  const reason = await RefundRequestReason.findById(reasonId);
  if (!reason) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
  }
  const query = {
    $or: [{ role: 'admin' }, { role: 'supportTeam' }],
  };
  const adminEmails = await User.find(query, { email: 1, _id: 0 });
  const emails = [];
  await adminEmails.forEach((doc) => {
    emails.push(doc.email);
  });
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  let reasonTitle = '';
  if (reason !== null && reason.name !== '') {
    reasonTitle = reason.name;
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const template = await EmailTemplate.findOne({ slug: 'user-refund-request' });
  const locale = 'en';
  let emailTitle = 'New Refund request';
  const currentYear = DateTime.now().year;
  let emailContent =
    'Please review the request at your earliest convenience. You can approve or deny the request and contact the customer for more information.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }

  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: emails,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: reasonTitle,
      EMAIL_REFUND_ID: refundId,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendTiffinSubscriptionRefundRequestToAdmin = async (purchaseId, reasonId, refundId) => {
  const reason = await TiffinSubscriptionRefundRequestReason.findById(reasonId);
  if (!reason) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
  }
  const query = {
    $or: [{ role: 'admin' }, { role: 'supportTeam' }],
  };
  const adminEmails = await User.find(query, { email: 1, _id: 0 });
  const emails = [];
  await adminEmails.forEach((doc) => {
    emails.push(doc.email);
  });
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  let reasonTitle = '';
  if (reason !== null && reason.name !== '') {
    reasonTitle = reason.name;
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const template = await EmailTemplate.findOne({ slug: 'user-tiffin-subscription-refund-request' });
  const locale = 'en';
  let emailTitle = 'New Tiffin Subscription Refund request';
  const currentYear = DateTime.now().year;
  let emailContent =
    'Please review the request at your earliest convenience. You can approve or deny the request and contact the customer for more information.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }

  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: emails,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: reasonTitle,
      EMAIL_REFUND_ID: refundId,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendDiningBookingRefundRequestToAdmin = async (bookingId, reasonId, refundId) => {
  const reason = await DiningBookingRefundRequestReason.findById(reasonId);
  if (!reason) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Something went wrong');
  }
  const query = {
    $or: [{ role: 'admin' }, { role: 'supportTeam' }],
  };
  const adminEmails = await User.find(query, { email: 1, _id: 0 });
  const emails = [];
  await adminEmails.forEach((doc) => {
    emails.push(doc.email);
  });
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  let reasonTitle = '';
  if (reason !== null && reason.name !== '') {
    reasonTitle = reason.name;
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const template = await EmailTemplate.findOne({ slug: 'user-dining-booking-refund-request' });
  const locale = 'en';
  let emailTitle = 'New Dining Booking Refund request';
  const currentYear = DateTime.now().year;
  let emailContent =
    'Please review the request at your earliest convenience. You can approve or deny the request and contact the customer for more information.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }

  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: emails,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: reasonTitle,
      EMAIL_REFUND_ID: refundId,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendThankYouReplayForFeedback = async (email, text) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'feedback-thank-you' });
  let emailTitle = 'Thank You for Your Valuable Suggestions!';
  let emailContent = 'Your feedback helps us improve and shape the future of our project.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === 'en');
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: email,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: text,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendThankYouReplayForReportEmergency = async (email, text) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'report-emergency-thank-you' });
  let emailTitle = 'Thank You for Reporting the Incident';
  let emailContent =
    'Your prompt action helps us ensure a safer and more secure environment. We will address your report as quickly as possible.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === 'en');
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: email,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: text,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendRestaurantRegisterRequestRejectionEmail = async (email, locale, reason) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'restaurant-register-request-rejected' });
  let emailTitle = 'Registration Rejected';
  let emailContent =
    'We regret to inform you that your registration request has been rejected. If you believe this was an error or need assistance, please contact our support team for further clarification.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: email,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: reason,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendRestaurantRegisterRequestApprovedEmail = async (email, locale) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'restaurant-register-request-approved' });
  let emailTitle = 'Registration Approved';
  let emailContent =
    'Congratulations! Your registration request has been approved. You can now access all features of our food delivery app, manage your profile, and start enjoying seamless food ordering and delivery. Welcome aboard!';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: email,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendDeliverymanRegisterRequestRejectionEmail = async (email, locale, reason) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'deliveryman-register-request-rejected' });
  let emailTitle = 'Registration Rejected';
  let emailContent =
    'We regret to inform you that your registration request has been rejected. If you believe this was an error or need assistance, please contact our support team for further clarification.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: email,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
      EMAIL_DYNAMIC_CONTENT: reason,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendDeliverymanRegisterRequestApprovedEmail = async (email, locale) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'deliveryman-register-request-approved' });
  let emailTitle = 'Registration Approved';
  let emailContent =
    'Congratulations! Your request to join our food delivery platform as a deliveryman has been approved. Get ready to start delivering delicious meals to our customers. Log in to your account for more details and begin your journey with us!';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: email,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendAccountBlockedEmail = async (email, locale) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'account-blocked-email' });
  let emailTitle = 'Important: Your Account Has Been Blocked';
  let emailContent =
    'Access to your account has been temporarily restricted. Please review the details below and take the necessary action.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
    if (template.translations !== null && template.translations.length > 0) {
      const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
      if (selectedLanguageCode && selectedLanguageCode.length > 0) {
        emailTitle = selectedLanguageCode[0].title;
        emailContent = _.unescape(selectedLanguageCode[0].content);
        emailFooter = selectedLanguageCode[0].footer;
        emailCopyRight = selectedLanguageCode[0].copyright;
      }
    }
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: email,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendExpiredPackageBlockedEmail = async (emails) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({
    slug: 'restaurant-package-expired-account-blocked-email',
  });
  let emailTitle = 'Your Subscription Has Expired – Account Access Blocked';
  let emailContent =
    'Your subscription package has expired, and your account access is temporarily restricted. Renew now to resume your services.';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: emails,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const sendSubscriptionExpiringSoonEmail = async (emails) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const mailCreds = {
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    auth: {
      user: mailConfig.smtpUsername,
      pass: mailConfig.smtpPassword,
    },
  };
  const currentYear = DateTime.now().year;
  const template = await EmailTemplate.findOne({ slug: 'restaurant-package-expire-soon-email' });
  let emailTitle = 'Renew Your Subscription Package Before It Expires!';
  let emailContent =
    'Your subscription is nearing its expiration date, and we don’t want you to lose access to the benefits you enjoy. Renew now to continue showcasing your restaurant, attracting customers, and staying ahead in the competition. Don’t let your subscription lapse—act today!';
  let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
  let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
  let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
  <p>{{EMAIL_MESSAGE}}</p>
  <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
  <p>{{EMAIL_FOOTER}}</p>
  <p>{{EMAIL_COPYRIGHT}}</p>`;
  if (template !== null && template.id !== null) {
    emailTitle = template.title;
    emailContent = _.unescape(template.content);
    emailFooter = template.footerContent;
    emailCopyRight = template.copyRightContent;
    emailHtmlContent = template.htmlContent;
  }
  const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
  const transport = nodemailer.createTransport(mailCreds);
  const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
  const mailOptions = {
    from: fromName,
    to: emails,
    subject: emailTitle,
    html: emailTemplate({
      EMAIL_TITLE: emailTitle,
      EMAIL_FOOTER: emailFooter,
      EMAIL_COPYRIGHT: emailCopyRight,
      EMAIL_MESSAGE: emailContent,
    }),
  };
  const response = await transport.sendMail(mailOptions);
  return response;
};

const priceFormat = (price, symbol, side) => {
  return side === 'left' ? `${symbol}${price}` : `${price}${symbol}`;
};

const trimText = (text, maxLength) => {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const orderSummaryEmail = async (id) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'restaurants.userId',
        foreignField: '_id',
        as: 'ownerInfo',
      },
    },
    {
      $unwind: {
        path: '$ownerInfo',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        orderTo: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        packageCharge: {
          $round: [{ $divide: ['$packageCharge', 100] }, 2],
        },
        packageChargeTax: {
          $round: [{ $divide: ['$packageChargeTax', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          email: { $ifNull: ['$users.email', ''] },
          locale: { $ifNull: ['$users.locale', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        restaurantOwner: {
          id: { $ifNull: ['$ownerInfo._id', ''] },
          email: { $ifNull: ['$ownerInfo.email', ''] },
          countryCode: { $ifNull: ['$ownerInfo.countryCode', 1] },
          mobile: { $ifNull: ['$ownerInfo.mobile', 'XXXXXXXXXX'] },
        },
      },
    },
  ];
  const info = await Orders.aggregate(orderQuery);
  const template = await EmailTemplate.findOne({ slug: 'order-summary' });
  const business = await BusinessSettings.findOne(
    {},
    { logo: 1, currency: 1, currencySide: 1, foodTaxName: 1, additionalServiceName: 1 }
  );
  return Promise.all([info, template, mailConfig, business]).then(async () => {
    if (info && checkArrayNotEmpty(info)) {
      const detail = info[0];
      const locale =
        detail && detail.userInfo && detail.userInfo.id && detail.userInfo.id !== ''
          ? detail.userInfo.locale
          : 'en';
      const orderId = detail && detail.orderNo && detail.orderNo !== '' ? detail.orderNo : 100001;
      const currentYear = DateTime.now().year;
      const receiverName =
        detail && detail.receiverName && detail.receiverName !== ''
          ? detail.receiverName
          : 'Receiver';
      const receiverContact =
        detail && detail.receiverContact && detail.receiverContact !== ''
          ? `+${detail.countryCode}${detail.receiverContact}`
          : '+1XXXXXXXXXX';
      let deliveryAddress = '';
      if (detail && detail.orderTo && detail.orderTo === 'homedelivery') {
        if (detail && detail.deliveryAddressRaw && detail.deliveryAddressRaw.user !== '') {
          const delivery = detail.deliveryAddressRaw;
          deliveryAddress = `${delivery.flatHouse}, ${delivery.locality}, ${delivery.landmark}`;
        } else {
          deliveryAddress = 'Home Delivery';
        }
      } else {
        deliveryAddress = 'Self Pickup';
      }
      const orderDate =
        detail && detail.createdAt && detail.createdAt !== ''
          ? DateTime.fromJSDate(detail.createdAt).toFormat('dd LLL, yyyy')
          : '15 Jul, 1997';
      let restauratName = '';
      let restaurantAddress = '';
      let restaurantEmail = '';
      let restaurantContact = '';
      if (detail && detail.restaurant && detail.restaurant.id && detail.restaurant.id !== '') {
        restauratName = detail.restaurant.name;
        restaurantAddress = detail.restaurant.address;
        if (
          detail.restaurant.translations !== null &&
          checkArrayNotEmpty(detail.restaurant.translations)
        ) {
          const selectedLanguageCode = detail.restaurant.translations.filter(
            (x) => x.code === locale
          );
          if (selectedLanguageCode && checkArrayNotEmpty(selectedLanguageCode)) {
            restauratName = selectedLanguageCode[0].title;
            restaurantAddress = selectedLanguageCode[0].address;
          }
        }
      } else {
        restauratName = 'Restaurant';
        restaurantAddress = 'Restaurant Address';
      }
      if (
        detail &&
        detail.restaurantOwner &&
        detail.restaurantOwner.id &&
        detail.restaurantOwner.id !== ''
      ) {
        const owner = detail.restaurantOwner;
        restaurantEmail = owner.email;
        restaurantContact = `+${owner.countryCode}${owner.mobile}`;
      } else {
        restaurantEmail = '';
        restaurantContact = '';
      }
      const currencySymbol =
        business && business.currency && business.currency.symbol && business.currency.symbol !== ''
          ? business.currency.symbol
          : `$`;
      const currencySide =
        business && business.currencySide && business.currencySide !== ''
          ? business.currencySide
          : 'left';
      const cartItems = [];
      if (detail && detail.cartItem && checkArrayNotEmpty(detail.cartItem)) {
        detail.cartItem.forEach((element) => {
          const optionNameList = [];
          if (element && element.addons && checkArrayNotEmpty(element.addons)) {
            element.addons.forEach((addonElement) => {
              optionNameList.push(addonElement.name);
            });
          }
          if (element && element.variations && checkArrayNotEmpty(element.variations)) {
            element.variations.forEach((variationElement) => {
              if (
                variationElement &&
                variationElement.options &&
                checkArrayNotEmpty(variationElement.options)
              ) {
                variationElement.options.forEach((optionElement) => {
                  optionNameList.push(optionElement.name);
                });
              }
            });
          }
          const optionNameString = optionNameList.join();
          const cleanOptionNameString = optionNameString.replace(/,\s*/g, '-');
          const obj = `
             <tr>
                <td>${element.quantity} X ${trimText(
                  element.name,
                  35
                )} <br> <span style="font-size: 8px;">${cleanOptionNameString}</span> </td>
                <td align="right">${priceFormat(element.singleProductPrice, currencySymbol, currencySide)}</td>
                <td align="right">${priceFormat(element.totalPrice, currencySymbol, currencySide)}</td>
            </tr>
          `;
          cartItems.push(obj);
        });
      }

      const priceList = [];
      if (detail && detail.realTotal && detail.realTotal > 0) {
        priceList.push(
          `Item Total: ${priceFormat(detail.realTotal, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.itemDiscount && detail.itemDiscount > 0) {
        priceList.push(
          `Item Discount: - ${priceFormat(detail.itemDiscount, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.itemTotal && detail.itemTotal > 0) {
        priceList.push(
          `Sub Total: ${priceFormat(detail.itemTotal, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.foodServiceCharge && detail.foodServiceCharge > 0) {
        const taxName =
          business && business.foodTaxName && business.foodTaxName !== ''
            ? business.foodTaxName
            : 'Food Tax';
        priceList.push(
          `${taxName}: + ${priceFormat(detail.foodServiceCharge, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.serviceCharge && detail.serviceCharge > 0) {
        const taxName =
          business && business.additionalServiceName && business.additionalServiceName !== ''
            ? business.additionalServiceName
            : 'Platform Fee';
        priceList.push(
          `${taxName}: + ${priceFormat(detail.serviceCharge, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.deliveryCharge && detail.deliveryCharge > 0) {
        priceList.push(
          `Delivery Fee: + ${priceFormat(detail.deliveryCharge, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.packageCharge && detail.packageCharge > 0) {
        priceList.push(
          `Package Charge: + ${priceFormat(detail.packageCharge, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.packageChargeTax && detail.packageChargeTax > 0) {
        priceList.push(
          `Package Tax Charge: + ${priceFormat(detail.packageChargeTax, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.couponDiscountCharge && detail.couponDiscountCharge > 0) {
        priceList.push(
          `Coupon Discount: - ${priceFormat(detail.couponDiscountCharge, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.walletAmount && detail.walletAmount > 0) {
        priceList.push(
          `Wallet Amount: - ${priceFormat(detail.walletAmount, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.deliveryTip && detail.deliveryTip > 0) {
        priceList.push(
          `Delivery Tip: + ${priceFormat(detail.deliveryTip, currencySymbol, currencySide)}<br>`
        );
      }
      if (detail && detail.extraCharge && detail.extraCharge > 0) {
        priceList.push(
          `Extra Charge: + ${priceFormat(detail.extraCharge, currencySymbol, currencySide)}<br>`
        );
      }
      const grandTotal = priceFormat(detail.grandTotal, currencySymbol, currencySide);
      let paymentName = '';
      if (detail && detail.paymentInfo && detail.paymentInfo.id && detail.paymentInfo.id !== '') {
        paymentName = detail.paymentInfo.name;
        if (
          detail.paymentInfo.translations !== null &&
          checkArrayNotEmpty(detail.paymentInfo.translations)
        ) {
          const selectedLanguageCode = detail.paymentInfo.translations.filter(
            (x) => x.code === locale
          );
          if (selectedLanguageCode && checkArrayNotEmpty(selectedLanguageCode)) {
            paymentName = selectedLanguageCode[0].value;
          }
        }
      } else {
        paymentName = 'Payment';
      }
      const paymentType =
        detail && detail.paymentInfo && detail.paymentInfo.id && detail.paymentInfo.id !== ''
          ? `${detail.paymentInfo.paymentWay === 'offline' ? `Unpaid ${paymentName}` : `Paid ${paymentName}`}`
          : 'Paid';
      const sendEmail =
        detail && detail.userInfo && detail.userInfo.email && detail.userInfo.email !== ''
          ? detail.userInfo.email
          : '';
      if (sendEmail !== '') {
        let emailTitle = 'Order Summary';
        let emailContent =
          'Thank you for ordering with FoodBite! We’ve received your order and are preparing it with love. Here’s a summary of your order:';
        let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
        let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
        let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
          <p>{{EMAIL_MESSAGE}}</p>
          <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
          <p>{{EMAIL_FOOTER}}</p>
          <p>{{EMAIL_COPYRIGHT}}</p>`;
        if (template !== null && template.id !== null) {
          emailTitle = template.title;
          emailContent = _.unescape(template.content);
          emailFooter = template.footerContent;
          emailCopyRight = template.copyRightContent;
          emailHtmlContent = template.htmlContent;
          if (template.translations !== null && template.translations.length > 0) {
            const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
            if (selectedLanguageCode && selectedLanguageCode.length > 0) {
              emailTitle = selectedLanguageCode[0].title;
              emailContent = _.unescape(selectedLanguageCode[0].content);
              emailFooter = selectedLanguageCode[0].footer;
              emailCopyRight = selectedLanguageCode[0].copyright;
            }
          }
        }
        const mailCreds = {
          host: mailConfig.smtpHost,
          port: mailConfig.smtpPort,
          auth: {
            user: mailConfig.smtpUsername,
            pass: mailConfig.smtpPassword,
          },
        };
        const cartString = cartItems.join();
        const cleanCartString = cartString.replace(/,\s*/g, '');
        const priceString = priceList.join();
        const cleanPriceString = priceString.replace(/,\s*/g, '');
        const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
        const transport = nodemailer.createTransport(mailCreds);
        const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
        const orderSummaryContent = `
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 800px; margin: auto; border-collapse: collapse;font-family: Tahoma, Geneva, sans-serif;">
            <tr>
              <td valign="top">
                <strong>Order: ${orderId}</strong><br>
                ${receiverName}<br>
                ${receiverContact}<br>
                ${deliveryAddress}
              </td>
              <td valign="top" style="text-align: right;">
                <strong>Order Date: ${orderDate}</strong><br>
                ${restauratName}<br>
                ${restaurantAddress}<br>
                ${restaurantContact}<br>
                ${restaurantEmail}<br>
              </td>
            </tr>
            <tr><td colspan="2" style="padding: 20px 0;">
              <table width="100%" border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse;">
                <thead style="background-color: #f3f3f3;">
                  <tr>
                    <th align="left">Item</th>
                    <th align="right">Price</th>
                    <th align="right">Total Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${cleanCartString}
                </tbody>
              </table>
            </td></tr>
            <tr>
              <td colspan="2" style="text-align: right; padding-top: 10px;">
                ${cleanPriceString}
                <br>
                <strong style="font-size: 16px;">Grand Total: ${grandTotal} (${paymentType})</strong>
              </td>
            </tr>
          </table>
          `;
        let compiledHtml = emailTemplate({
          EMAIL_TITLE: emailTitle,
          EMAIL_FOOTER: emailFooter,
          EMAIL_COPYRIGHT: emailCopyRight,
          EMAIL_MESSAGE: emailContent,
          EMAIL_DYNAMIC_CONTENT: orderId,
        });
        compiledHtml = compiledHtml.replace(
          /<div[^>]*id="emailDynamicDataContent"[^>]*>.*?<\/div>/s,
          `<div  id="emailDynamicDataContent">${orderSummaryContent}</div>`
        );
        const mailOptions = {
          from: fromName,
          to: sendEmail,
          subject: emailTitle,
          html: compiledHtml,
        };
        const response = await transport.sendMail(mailOptions);
        return response;
      }
    }
  });
};

const exportSupportChat = async (id) => {
  const mailConfig = await EmailConfig.findOne();
  if (!mailConfig) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Unable to connect to email server. Make sure you have configured the SMTP options'
    );
  }
  const template = await EmailTemplate.findOne({ slug: 'support-chat-export' });
  const detail = await SupportChatRoom.findById(id);
  if (!detail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { userId } = detail;
  const userDetail = await User.findById(userId, { email: 1, locale: 1 });
  const conversionQuery = [
    { $match: { roomId: new mongoose.Types.ObjectId(id) } },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'senderId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        senderId: 1,
        message: 1,
        messageType: 1,
        createdAt: 1,
        sender: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const chats = await SupportChatConversion.aggregate(conversionQuery);
  const chatMessages = [];

  return Promise.all([template, detail, userDetail, chatMessages, chats]).then(async () => {
    if (checkArrayNotEmpty(chats)) {
      chats.forEach((element) => {
        let sender = '';
        if (element.senderId.toString() === userId.toString()) {
          sender = 'You';
        } else {
          sender = `${element.sender.firstName} ${element.sender.lastName} (${formatRoleName(element.sender.role)})`;
        }
        const chatObj = {
          name: sender,
          msg: element.messageType === 'text' ? element.message : 'Attachment',
          time: DateTime.fromJSDate(element.createdAt).toFormat('yyyy-MM-dd hh:mm a'),
        };
        const chatHtmlObj = `
          <div style="border: 1px solid #ddd;padding: 15px;border-radius: 8px;margin-bottom: 20px;background-color: #f9f9f9;">
            <div style="font-weight: bold;margin-bottom: 5px;">${chatObj.name}</div>
            <div style="margin-bottom: 10px;">${chatObj.msg}</div>
            <div style="font-size: 12px;color: #777;">${chatObj.time}</div>
          </div>
        `;
        chatMessages.push(chatHtmlObj);
      });
      const sendEmail =
        userDetail && userDetail.email !== null && userDetail.email !== '' ? userDetail.email : '';
      const locale =
        userDetail && userDetail.locale && userDetail.locale && userDetail.locale !== ''
          ? userDetail.locale
          : 'en';
      if (sendEmail !== '') {
        const currentYear = DateTime.now().year;
        let emailTitle = 'Your Support Chat';
        let emailContent = 'We have received your support request regarding the issue';
        let emailFooter = 'Please contact us for any queries; we’re always happy to help.';
        let emailCopyRight = `© ${currentYear} FoodBite. All rights reserved.`;
        let emailHtmlContent = `<p>{{EMAIL_TITLE}}</p>
          <p>{{EMAIL_MESSAGE}}</p>
          <p>{{EMAIL_DYNAMIC_CONTENT}}</p>
          <p>{{EMAIL_FOOTER}}</p>
          <p>{{EMAIL_COPYRIGHT}}</p>`;
        if (template !== null && template.id !== null) {
          emailTitle = template.title;
          emailContent = _.unescape(template.content);
          emailFooter = template.footerContent;
          emailCopyRight = template.copyRightContent;
          emailHtmlContent = template.htmlContent;
          if (template.translations !== null && template.translations.length > 0) {
            const selectedLanguageCode = template.translations.filter((x) => x.code === locale);
            if (selectedLanguageCode && selectedLanguageCode.length > 0) {
              emailTitle = selectedLanguageCode[0].title;
              emailContent = _.unescape(selectedLanguageCode[0].content);
              emailFooter = selectedLanguageCode[0].footer;
              emailCopyRight = selectedLanguageCode[0].copyright;
            }
          }
        }
        const mailCreds = {
          host: mailConfig.smtpHost,
          port: mailConfig.smtpPort,
          auth: {
            user: mailConfig.smtpUsername,
            pass: mailConfig.smtpPassword,
          },
        };
        const chatString = chatMessages.join();
        const cleanChatString = chatString.replace(/,\s*/g, '');
        const emailTemplate = Handlebars.compile(_.unescape(emailHtmlContent));
        const transport = nodemailer.createTransport(mailCreds);
        const fromName = `${mailConfig.smtpFromName} <${mailConfig.smtpFromEmail}>`;
        let compiledHtml = emailTemplate({
          EMAIL_TITLE: emailTitle,
          EMAIL_FOOTER: emailFooter,
          EMAIL_COPYRIGHT: emailCopyRight,
          EMAIL_MESSAGE: emailContent,
          EMAIL_DYNAMIC_CONTENT: '',
        });
        compiledHtml = compiledHtml.replace(
          /<div[^>]*id="emailDynamicDataContent"[^>]*>.*?<\/div>/s,
          `<div  id="emailDynamicDataContent">${cleanChatString}</div>`
        );
        const mailOptions = {
          from: fromName,
          to: sendEmail,
          subject: emailTitle,
          html: compiledHtml,
        };
        await transport.sendMail(mailOptions);
        return {
          success: true,
        };
      }
      return {
        sucess: false,
      };
    }
    return {
      sucess: false,
    };
  });
};

const emailMediaConfig = async () => {
  const media = await EmailConfig.findOne({}, { mediaUrls: 1 });
  return media;
};

const saveEmailMediaConfig = async (param) => {
  const mediaUrl = await EmailConfig.findOne();
  if (mediaUrl) {
    Object.assign(mediaUrl, { mediaUrls: param });
    await mediaUrl.save();
  }
  return { success: true };
};

module.exports = {
  createEmailConfig,
  getEmailConfig,
  updateEmailConfig,
  sendDemoMail,
  sendVerificationEmail,
  sendRefundRequestToAdmin,
  sendUserLoginEmail,
  sendTiffinSubscriptionRefundRequestToAdmin,
  sendDiningBookingRefundRequestToAdmin,
  sendThankYouReplayForFeedback,
  sendThankYouReplayForReportEmergency,
  sendRestaurantRegisterRequestRejectionEmail,
  sendRestaurantRegisterRequestApprovedEmail,
  sendDeliverymanRegisterRequestRejectionEmail,
  sendDeliverymanRegisterRequestApprovedEmail,
  sendAccountBlockedEmail,
  sendExpiredPackageBlockedEmail,
  sendSubscriptionExpiringSoonEmail,
  orderSummaryEmail,
  exportSupportChat,
  emailMediaConfig,
  saveEmailMediaConfig,
};

