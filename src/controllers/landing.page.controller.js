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

const catchAsync = require('../utils/catchAsync');
const { landingPageService } = require('../services');

const getContent = catchAsync(async (req, res) => {
  const result = await landingPageService.getContent();
  res.send(result);
});

const saveHero = catchAsync(async (req, res) => {
  const result = await landingPageService.saveHeroContent(req.body);
  res.send(result);
});

const saveService = catchAsync(async (req, res) => {
  const result = await landingPageService.saveServiceContent(req.body);
  res.send(result);
});

const saveFaqs = catchAsync(async (req, res) => {
  const result = await landingPageService.saveFaqsContent(req.body);
  res.send(result);
});

const saveReview = catchAsync(async (req, res) => {
  const result = await landingPageService.saveReviewContent(req.body);
  res.send(result);
});

const saveScanQr = catchAsync(async (req, res) => {
  const result = await landingPageService.saveScanQrContent(req.body);
  res.send(result);
});

const saveAppFeatures = catchAsync(async (req, res) => {
  const result = await landingPageService.saveAppFeaturesContent(req.body);
  res.send(result);
});

const saveFeatures = catchAsync(async (req, res) => {
  const result = await landingPageService.saveProjectFeaturesContent(req.body);
  res.send(result);
});

module.exports = {
  getContent,
  saveHero,
  saveService,
  saveFaqs,
  saveReview,
  saveScanQr,
  saveAppFeatures,
  saveFeatures,
};

