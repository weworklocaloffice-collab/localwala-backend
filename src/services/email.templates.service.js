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
const { EmailTemplate, EmailConfig } = require('../models');
const ApiError = require('../utils/ApiError');

const createEmailTemplate = async (param) => {
  const result = await EmailTemplate.create(param);
  return result;
};

const updateEmailTemplate = async (slugURL, param) => {
  const emailTemplate = await EmailTemplate.findOne({ slug: slugURL });
  if (!emailTemplate) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not found');
  }
  Object.assign(emailTemplate, param);
  await emailTemplate.save();
  return emailTemplate;
};

const adminEmailContent = async (slugURL) => {
  const template = await EmailTemplate.findOne({ slug: slugURL });
  const media = await EmailConfig.findOne({}, { mediaUrls: 1 });
  return { template, media };
};

module.exports = {
  createEmailTemplate,
  updateEmailTemplate,
  adminEmailContent,
};

