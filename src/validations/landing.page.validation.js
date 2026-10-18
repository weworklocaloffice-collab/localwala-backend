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

const statObjValidation = Joi.object({
  cover: Joi.string().required(),
  title: Joi.string().required(),
  subtitle: Joi.string().required(),
  translations: Joi.allow(),
});

const serviceItemValidation = Joi.object({
  serial: Joi.number().required(),
  title: Joi.string().required(),
  subtitle: Joi.string().required(),
  translations: Joi.allow(),
});

const faqsItemValidation = Joi.object({
  serial: Joi.number().required(),
  title: Joi.string().required(),
  subtitle: Joi.string().required(),
  translations: Joi.allow(),
});

const appFeaturesItemValidation = Joi.object({
  title: Joi.string().required(),
  subtitle: Joi.string().required(),
  image: Joi.string().required(),
  translations: Joi.allow(),
});

const reviewItemValidation = Joi.object({
  userName: Joi.string().required(),
  image: Joi.string().required(),
  message: Joi.string().required(),
  occupation: Joi.string().required(),
  star: Joi.number().required(),
  translations: Joi.allow(),
});

const heroValidation = {
  body: Joi.object().keys({
    highlight: Joi.string().required(),
    title: Joi.string().required(),
    subtitle: Joi.string().required(),
    header: Joi.string().required(),
    btn1_enable: Joi.boolean().required(),
    btn1_href: Joi.string().allow('', null),
    btn1_cover: Joi.string().allow('', null),
    btn2_enable: Joi.boolean().required(),
    btn2_href: Joi.string().allow('', null),
    btn2_cover: Joi.string().allow('', null),
    cover: Joi.string().required(),
    hash1_img: Joi.string().required(),
    hash1_txt: Joi.string().required(),
    hash2_img: Joi.string().required(),
    hash2_txt: Joi.string().required(),
    hash3_img: Joi.string().required(),
    hash3_txt: Joi.string().required(),
    translations: Joi.allow(),
    stats_one: statObjValidation,
    stats_two: statObjValidation,
    stats_three: statObjValidation,
    stats_four: statObjValidation,
  }),
};

const serviceValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    subtitle: Joi.string().required(),
    services: Joi.array().items(serviceItemValidation),
    translations: Joi.allow(),
  }),
};

const faqsValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    subtitle: Joi.string().required(),
    questions: Joi.array().items(faqsItemValidation),
    translations: Joi.allow(),
  }),
};

const reviewValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    subtitle: Joi.string().required(),
    reviews: Joi.array().items(reviewItemValidation),
    translations: Joi.allow(),
  }),
};

const scanQrValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    subtitle: Joi.string().required(),
    btn1_enable: Joi.boolean().required(),
    btn1_href: Joi.string().allow('', null),
    btn1_cover: Joi.string().allow('', null),
    btn2_enable: Joi.boolean().required(),
    btn2_href: Joi.string().allow('', null),
    btn2_cover: Joi.string().allow('', null),
    cover: Joi.string().required(),
    translations: Joi.allow(),
  }),
};

const appFeatureValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    subtitle: Joi.string().required(),
    cover: Joi.string().required(),
    features: Joi.array().items(appFeaturesItemValidation),
    translations: Joi.allow(),
  }),
};

const projectBulletItemValidation = Joi.object({
  lbl: Joi.string().required(),
  translations: Joi.allow(),
});

const projectFeatureItemValidation = Joi.object({
  btn_href: Joi.string().required(),
  btn_lbl: Joi.string().required(),
  detail_cover: Joi.string().required(),
  detail_subtitle: Joi.string().required(),
  detail_title: Joi.string().required(),
  icon: Joi.string().required(),
  subtitle: Joi.string().required(),
  title: Joi.string().required(),
  detail_list: Joi.array().items(projectBulletItemValidation),
  translations: Joi.allow(),
});

const projectFeatureValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    subtitle: Joi.string().required(),
    firstFeature: projectFeatureItemValidation,
    secondFeature: projectFeatureItemValidation,
    thirdFeature: projectFeatureItemValidation,
    fourthFeature: projectFeatureItemValidation,
    translations: Joi.allow(),
  }),
};

module.exports = {
  heroValidation,
  serviceValidation,
  faqsValidation,
  reviewValidation,
  scanQrValidation,
  appFeatureValidation,
  projectFeatureValidation,
};

