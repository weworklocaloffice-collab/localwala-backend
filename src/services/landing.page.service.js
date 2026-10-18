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

const { LandingPage } = require('../models');

const getContent = async () => {
  const result = await LandingPage.findOne({});
  return { result, success: true };
};

const saveHeroContent = async (param) => {
  const detail = await LandingPage.findOne();
  if (detail) {
    const obj = {
      heroContent: param,
    };
    Object.assign(detail, obj);
    await detail.save();
  } else {
    await LandingPage.create({ heroContent: param });
  }

  return { success: true };
};

const saveServiceContent = async (param) => {
  const detail = await LandingPage.findOne();
  if (detail) {
    const obj = {
      serviceContent: param,
    };
    Object.assign(detail, obj);
    await detail.save();
  } else {
    await LandingPage.create({ serviceContent: param });
  }

  return { success: true };
};

const saveFaqsContent = async (param) => {
  const detail = await LandingPage.findOne();
  if (detail) {
    const obj = {
      faqContent: param,
    };
    Object.assign(detail, obj);
    await detail.save();
  } else {
    await LandingPage.create({ faqContent: param });
  }

  return { success: true };
};

const saveReviewContent = async (param) => {
  const detail = await LandingPage.findOne();
  if (detail) {
    const obj = {
      reviewContent: param,
    };
    Object.assign(detail, obj);
    await detail.save();
  } else {
    await LandingPage.create({ reviewContent: param });
  }

  return { success: true };
};

const saveScanQrContent = async (param) => {
  const detail = await LandingPage.findOne();
  if (detail) {
    const obj = {
      scanQrContent: param,
    };
    Object.assign(detail, obj);
    await detail.save();
  } else {
    await LandingPage.create({ scanQrContent: param });
  }

  return { success: true };
};

const saveAppFeaturesContent = async (param) => {
  const detail = await LandingPage.findOne();
  if (detail) {
    const obj = {
      appFeatureContent: param,
    };
    Object.assign(detail, obj);
    await detail.save();
  } else {
    await LandingPage.create({ appFeatureContent: param });
  }

  return { success: true };
};

const saveProjectFeaturesContent = async (param) => {
  const detail = await LandingPage.findOne();
  if (detail) {
    const obj = {
      featureContent: param,
    };
    Object.assign(detail, obj);
    await detail.save();
  } else {
    await LandingPage.create({ featureContent: param });
  }

  return { success: true };
};

module.exports = {
  getContent,
  saveHeroContent,
  saveServiceContent,
  saveFaqsContent,
  saveReviewContent,
  saveScanQrContent,
  saveAppFeaturesContent,
  saveProjectFeaturesContent,
};

