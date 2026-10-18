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
const { appPagesService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await appPagesService.createPage(req.body);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await appPagesService.updatePage(req.params.slug, req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const result = await appPagesService.getPageBySlug(req.params.slug);
  res.send(result);
});

const getContent = catchAsync(async (req, res) => {
  const result = await appPagesService.getPageContent(req.params.slug);
  res.send(result);
});

const getPageContent = catchAsync(async (req, res) => {
  const result = await appPagesService.getContent(req.params.slug);
  res.send(result);
});

module.exports = {
  create,
  update,
  get,
  getContent,
  getPageContent,
};

