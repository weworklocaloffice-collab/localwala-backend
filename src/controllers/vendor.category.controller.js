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
const { vendorCategoryService, categoryService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await vendorCategoryService.createCategory(req.body);
  res.send(result);
});

const getMyCategory = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const mainOptions = { limit: req.query.mainLimit, page: req.query.mainPage };
  const vendorCategory = await vendorCategoryService.getAllVendorCategoryByRestaurant(
    req.params.restaurant,
    options
  );
  const mainCategory = await categoryService.getAllActiveMainCategories(mainOptions);
  res.send({ vendorCategory, mainCategory });
});

const update = catchAsync(async (req, res) => {
  const result = await vendorCategoryService.updateCategoryById(req.params.categoryId, req.body);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await vendorCategoryService.deleteCategoryById(req.params.categoryId);
  res.send({ success: true });
});

const getMyAllCategory = catchAsync(async (req, res) => {
  const result = await vendorCategoryService.getAllList(req.params.restaurant);
  res.send(result);
});

module.exports = {
  create,
  getMyCategory,
  update,
  drop,
  getMyAllCategory,
};

