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

const Joi = require('joi');

const createOrUpdateTemplate = {
  body: Joi.object().keys({
    slug: Joi.string().required(),
    icon: Joi.string().required(),
    title: Joi.string().required(),
    content: Joi.string().required(),
    footerContent: Joi.string().required(),
    btnLbl: Joi.string().allow('', null),
    btnUrl: Joi.string().allow('', null),
    bannerImage: Joi.string().allow('', null),
    bannerUrl: Joi.string().allow('', null),
    websiteURL: Joi.string().required(),
    copyRightContent: Joi.string().required(),
    htmlContent: Joi.string().required(),
    // Page Links //
    aboutPage: Joi.boolean().required(),
    privacyPage: Joi.boolean().required(),
    termsPage: Joi.boolean().required(),
    refundPage: Joi.boolean().required(),
    shippingPage: Joi.boolean().required(),
    cancellationPage: Joi.boolean().required(),
    cookiesPage: Joi.boolean().required(),
    helpPage: Joi.boolean().required(),
    faqsPage: Joi.boolean().required(),
    // Page Links //

    // Social Links //
    fbLink: Joi.boolean().required(),
    instaLink: Joi.boolean().required(),
    xLink: Joi.boolean().required(),
    ytLink: Joi.boolean().required(),
    llLink: Joi.boolean().required(),
    piLink: Joi.boolean().required(),
    gpLink: Joi.boolean().required(),
    asLink: Joi.boolean().required(),
    vmLink: Joi.boolean().required(),
    // Social Links //
    translations: Joi.array().allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    slug: Joi.string(),
  }),
};

module.exports = {
  createOrUpdateTemplate,
  idValidation,
};

