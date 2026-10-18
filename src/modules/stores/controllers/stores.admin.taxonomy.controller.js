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
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const taxonomyService = require('../services/stores.admin.taxonomy.service');

/**
 * Admin CRUD over the stores taxonomy.
 *
 * Thin by convention: destructure, call ONE service, send. The archive-not-delete
 * refusals live in the service, because they are a business rule (BR-25) rather than a
 * transport concern.
 */

// -- categories ---------------------------------------------------------------

const listCategories = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'search', 'status']);
  const result = await taxonomyService.listCategories(filter);
  res.status(httpStatus.OK).send(result);
});

const createCategory = catchAsync(async (req, res) => {
  const category = await taxonomyService.createCategory(req.body);
  res.status(httpStatus.CREATED).send(category);
});

const updateCategory = catchAsync(async (req, res) => {
  const category = await taxonomyService.updateCategory(req.params.category, req.body);
  res.status(httpStatus.OK).send(category);
});

const removeCategory = catchAsync(async (req, res) => {
  const category = await taxonomyService.removeCategory(req.params.category);
  res.status(httpStatus.OK).send(category);
});

// -- subcategories ------------------------------------------------------------

const listSubcategories = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'search', 'category', 'status']);
  const result = await taxonomyService.listSubcategories(filter);
  res.status(httpStatus.OK).send(result);
});

const createSubcategory = catchAsync(async (req, res) => {
  const subcategory = await taxonomyService.createSubcategory(req.body);
  res.status(httpStatus.CREATED).send(subcategory);
});

const updateSubcategory = catchAsync(async (req, res) => {
  const subcategory = await taxonomyService.updateSubcategory(req.params.subcategory, req.body);
  res.status(httpStatus.OK).send(subcategory);
});

const removeSubcategory = catchAsync(async (req, res) => {
  const subcategory = await taxonomyService.removeSubcategory(req.params.subcategory);
  res.status(httpStatus.OK).send(subcategory);
});

// -- brands -------------------------------------------------------------------

const listBrands = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'search', 'status']);
  const result = await taxonomyService.listBrands(filter);
  res.status(httpStatus.OK).send(result);
});

const createBrand = catchAsync(async (req, res) => {
  const brand = await taxonomyService.createBrand(req.body);
  res.status(httpStatus.CREATED).send(brand);
});

const updateBrand = catchAsync(async (req, res) => {
  const brand = await taxonomyService.updateBrand(req.params.brand, req.body);
  res.status(httpStatus.OK).send(brand);
});

const removeBrand = catchAsync(async (req, res) => {
  const brand = await taxonomyService.removeBrand(req.params.brand);
  res.status(httpStatus.OK).send(brand);
});

// -- attribute templates ------------------------------------------------------

const listAttributeTemplates = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['page', 'limit', 'search']);
  const result = await taxonomyService.listAttributeTemplates(filter);
  res.status(httpStatus.OK).send(result);
});

const createAttributeTemplate = catchAsync(async (req, res) => {
  const template = await taxonomyService.createAttributeTemplate(req.body);
  res.status(httpStatus.CREATED).send(template);
});

const updateAttributeTemplate = catchAsync(async (req, res) => {
  const template = await taxonomyService.updateAttributeTemplate(req.params.template, req.body);
  res.status(httpStatus.OK).send(template);
});

const removeAttributeTemplate = catchAsync(async (req, res) => {
  const template = await taxonomyService.removeAttributeTemplate(req.params.template);
  res.status(httpStatus.OK).send(template);
});

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  removeCategory,
  listSubcategories,
  createSubcategory,
  updateSubcategory,
  removeSubcategory,
  listBrands,
  createBrand,
  updateBrand,
  removeBrand,
  listAttributeTemplates,
  createAttributeTemplate,
  updateAttributeTemplate,
  removeAttributeTemplate,
};