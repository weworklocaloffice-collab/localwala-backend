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
const { objectId } = require('../../../validations/custom.validation');
const { BANNER_HEIGHT_MIN, BANNER_HEIGHT_MAX, COLLAPSED_HEIGHT_MIN, COLLAPSED_HEIGHT_MAX, MEDIA_SCALE_MIN, MEDIA_SCALE_MAX } = require('../models/header.banner.model');

/**
 * Every writable field, declared once.
 *
 * `middlewares/validate.js` compiles the schema against the whole request body
 * and this object has no `.unknown(true)`, so a field missing here is a hard
 * 400. Reusing one map across create and update is what stops the two drifting.
 */
const bannerFields = {
  campaignName: Joi.string().trim().required(),

  title: Joi.string().allow(null, ''),
  subtitle: Joi.string().allow(null, ''),
  // Array payloads arrive bracket flattened from the admin's urlencoded posts.
  translations: Joi.allow(),
  subtitleTranslations: Joi.allow(),

  media: Joi.string().valid('image', 'lottie', 'video'),
  mediaUrl: Joi.string().allow(null, ''),
  image: Joi.string().allow(null, ''),

  orientation: Joi.string().valid('horizontal', 'vertical'),
  aspectRatio: Joi.number().positive().allow(null, ''),
  heightMode: Joi.string().valid('responsive', 'fixed'),
  maxHeight: Joi.number().integer().min(BANNER_HEIGHT_MIN).max(BANNER_HEIGHT_MAX).allow(null, ''),

  ctaText: Joi.string().allow(null, ''),
  ctaAction: Joi.string().valid('', 'open_restaurant_list', 'restaurant_list', 'open_search', 'category', 'restaurant', 'food').allow(null, ''),
  ctaTarget: Joi.string().allow(null, ''),
  deepLink: Joi.string().allow(null, ''),
  enableOverlayText: Joi.boolean().allow(null, ''),
  showCta: Joi.boolean().allow(null, ''),

  ctaPreset: Joi.string().valid('default', 'compact', 'pill', 'outline', 'minimal').allow(null, ''),
  ctaStyle: Joi.string().valid('solid', 'outline', 'ghost').allow(null, ''),
  ctaBackgroundColor: Joi.string().allow(null, ''),
  ctaTextColor: Joi.string().allow(null, ''),
  ctaCornerRadius: Joi.number().integer().min(0).max(999).allow(null, ''),
  ctaFontSize: Joi.number().integer().min(10).max(24).allow(null, ''),
  ctaPaddingX: Joi.number().integer().min(0).max(40).allow(null, ''),
  ctaPaddingY: Joi.number().integer().min(0).max(40).allow(null, ''),
  ctaFullWidth: Joi.boolean().allow(null, ''),
  ctaShowArrow: Joi.boolean().allow(null, ''),

  ctaAnimation: Joi.string().valid(
    'none',
    'pulse', 'heartbeat', 'wiggle', 'shake', 'glow', 'shimmer', 'arrowSlide', 'borderRunner',
    'bounce', 'fadeIn', 'slideUp', 'zoomIn', 'flipIn',
    'pressDown',
    'rainbow', 'goldenShine'
  ).allow(null, ''),
  ctaAnimationDuration: Joi.number().integer().min(200).max(5000).allow(null, ''),
  ctaAnimationLoop: Joi.boolean().allow(null, ''),
  displayDuration: Joi.number().integer().min(0).allow(null, ''),

  appBarBackgroundMode: Joi.string().valid('auto', 'manual', 'gradient'),
  appBarBackgroundColor: Joi.string().allow(null, ''),
  appBarGradientFrom: Joi.string().allow(null, ''),
  appBarGradientTo: Joi.string().allow(null, ''),
  extractedColors: Joi.allow(),
  collapsedHeight: Joi.number().integer().min(COLLAPSED_HEIGHT_MIN).max(COLLAPSED_HEIGHT_MAX).allow(null, ''),
  showLocation: Joi.boolean().allow(null, ''),
  showLanguageSelector: Joi.boolean().allow(null, ''),
  showNotificationIcon: Joi.boolean().allow(null, ''),

  lottieAutoPlay: Joi.boolean().allow(null, ''),
  lottieLoop: Joi.boolean().allow(null, ''),
  lottieSpeed: Joi.number().min(0.1).max(4).allow(null, ''),
  lottieFit: Joi.string().valid('contain', 'fill', 'cover', 'fitWidth', 'fitHeight', 'none', 'scaleDown').allow(null, ''),
  lottieAlignment: Joi.string()
    .valid('topLeft', 'topCenter', 'topRight', 'centerLeft', 'center', 'centerRight', 'bottomLeft', 'bottomCenter', 'bottomRight')
    .allow(null, ''),

  mediaOffsetX: Joi.number().min(-0.5).max(0.5).allow(null, ''),
  mediaOffsetY: Joi.number().min(-0.5).max(0.5).allow(null, ''),
  overlayOffsetX: Joi.number().min(-0.5).max(0.5).allow(null, ''),
  overlayOffsetY: Joi.number().min(-0.5).max(0.5).allow(null, ''),
  ctaOffsetX: Joi.number().min(-0.5).max(0.5).allow(null, ''),
  ctaOffsetY: Joi.number().min(-0.5).max(0.5).allow(null, ''),
  mediaScale: Joi.number().min(MEDIA_SCALE_MIN).max(MEDIA_SCALE_MAX).allow(null, ''),

  scheduleType: Joi.string().valid('alwaysOn', 'dateRange'),
  startDate: Joi.date().allow(null, ''),
  endDate: Joi.date().allow(null, ''),
  startTime: Joi.string().allow(null, ''),
  endTime: Joi.string().allow(null, ''),
  timezone: Joi.string().allow(null, ''),
  repeat: Joi.string().allow(null, ''),

  city: Joi.string().custom(objectId).allow(null, ''),
  priority: Joi.number().integer().allow(null, ''),
  status: Joi.boolean().allow(null, ''),
  isActive: Joi.boolean().allow(null, ''),
};

const createValidation = {
  body: Joi.object().keys(bannerFields),
};

const updateValidation = {
  params: Joi.object().keys({
    headerBannerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys(bannerFields),
};

const statusValidation = {
  params: Joi.object().keys({
    headerBannerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.boolean().required(),
  }),
};

const detailValidation = {
  params: Joi.object().keys({
    headerBannerId: Joi.string().custom(objectId).required(),
  }),
};

const draftValidation = {
  params: Joi.object().keys({
    draftId: Joi.string().custom(objectId).required(),
  }),
};

const saveDraftValidation = {
  body: Joi.object().keys({
    headerBanner: Joi.string().allow(null, ''),
    draftId: Joi.string().allow(null, ''),
    payload: Joi.allow().required(),
  }),
};

const publishValidation = {
  params: Joi.object().keys({
    draftId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys(bannerFields).unknown(true),
};

const allValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
    status: Joi.boolean().allow(null, ''),
    city: Joi.string().allow(null, ''),
  }),
};

const historyValidation = {
  query: Joi.object().keys({
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    headerBanner: Joi.string().allow(null, ''),
  }),
};

const assetValidation = {
  query: Joi.object().keys({
    // Relative storage key only. The service rejects anything outside the banner prefix.
    path: Joi.string().required(),
  }),
};

// Options behind the CTA target pickers. `kind` picks the list; the scope arguments are
// required per kind rather than by the schema, because the service is what knows that
// foods cannot be listed without a restaurant and categories need neither.
const lookupValidation = {
  query: Joi.object().keys({
    kind: Joi.string().valid('restaurant', 'food', 'category').required(),
    city: Joi.string().custom(objectId).allow(null, ''),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
  }),
};

module.exports = {
  bannerFields,
  createValidation,
  updateValidation,
  statusValidation,
  detailValidation,
  draftValidation,
  saveDraftValidation,
  publishValidation,
  allValidation,
  historyValidation,
  assetValidation,
  lookupValidation,
};