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

const _ = require('lodash');
const { AppPage } = require('../models');

const createPage = async (param) => {
  const result = await AppPage.create(param);
  return result;
};

const getPageBySlug = async (slugURL) => {
  const result = await AppPage.findOne({ slug: slugURL });
  return result;
};

const getPageContent = async (slugURL) => {
  const result = await AppPage.findOne(
    { slug: slugURL },
    { description: 1, _id: 0, translations: 1 }
  );
  return result;
};

const getContent = async (slugURL) => {
  const result = await AppPage.findOne(
    { slug: slugURL },
    { description: 1, _id: 0, translations: 1 }
  );
  if (result !== null && result.description !== null) {
    const decodedTranslations = (result.translations || []).map((t) => ({
      ...t,
      value: _.unescape(t.value || ''),
    }));
    return {
      success: true,
      content: _.unescape(result.description),
      translations: decodedTranslations,
    };
  }
  return {
    success: true,
    content: '<h1>Hello World!</h1>',
    translations: [],
  };
};

const updatePage = async (slug, param) => {
  const result = await getPageBySlug(slug);

  Object.assign(result, param);
  await result.save();
  return result;
};

module.exports = {
  createPage,
  getPageBySlug,
  updatePage,
  getPageContent,
  getContent,
};

