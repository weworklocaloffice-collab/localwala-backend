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
const pick = require('../utils/pick');
const { vendorSubCategoryService, subCategoryService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await vendorSubCategoryService.createSubCategory(req.body);
  res.send(result);
});

const getMyCategory = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const mainOptions = { limit: req.query.mainLimit, page: req.query.mainPage };

  const vendorCategory = await vendorSubCategoryService.getAllSubCategory(
    req.params.restaurant,
    options
  );
  const mainCategory = await subCategoryService.getAllActiveSubCategory(mainOptions);
  res.send({ vendorCategory, mainCategory });
});

const update = catchAsync(async (req, res) => {
  const result = await vendorSubCategoryService.updateSubCategoryById(
    req.params.subCategoryId,
    req.body
  );
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await vendorSubCategoryService.deleteSubCategoryById(req.params.subCategoryId);
  res.send({ success: true });
});

const getAllSubCategoryById = catchAsync(async (req, res) => {
  const result = await vendorSubCategoryService.getActiveByCategoryID(
    req.params.category,
    req.params.restaurant
  );
  res.send(result);
});

module.exports = {
  create,
  getMyCategory,
  update,
  drop,
  getAllSubCategoryById,
};

