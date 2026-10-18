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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const catalogService = require('../services/stores.catalog.service');

const listProducts = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['category', 'subcategory', 'brand', 'search', 'facetKeys', 'inStockOnly', 'organicOnly', 'page', 'limit', 'sort']);
  const result = await catalogService.listProducts({ ...filter, outlet: req.outletId, chain: req.chainId });
  res.status(httpStatus.OK).send(result);
});

const getProduct = catchAsync(async (req, res) => {
  const product = await catalogService.getProduct(req.params.product);
  res.status(httpStatus.OK).send({ product });
});

const createProduct = catchAsync(async (req, res) => {
  const product = await catalogService.createProduct({ ...req.body, chain: req.chainId, createdBy: req.user._id });
  res.status(httpStatus.CREATED).send({ product });
});

const updateProduct = catchAsync(async (req, res) => {
  const product = await catalogService.updateProduct(req.params.product, req.body);
  res.status(httpStatus.OK).send({ product });
});

const deleteProduct = catchAsync(async (req, res) => {
  const product = await catalogService.deleteProduct(req.params.product);
  res.status(httpStatus.OK).send({ product });
});

const generateVariants = catchAsync(async (req, res) => {
  const product = await catalogService.getProduct(req.params.product);
  const result = await catalogService.generateVariants({ product, ...req.body });
  res.status(httpStatus.OK).send(result);
});

const getProductForm = catchAsync(async (req, res) => {
  const form = await catalogService.getProductForm(req.query);
  res.status(httpStatus.OK).send(form);
});

/**
 * Admin product approval (BR-09 / productApprovalRequired chains).
 *
 * Delegates to the catalog service so the approval-state machine lives in
 * one place. The route validation already restricts `status` to
 * approved/rejected, so the service's guard is belt-and-braces.
 */
const approveProduct = catchAsync(async (req, res) => {
  const product = await catalogService.approveProduct(req.params.product, {
    status: req.body.status,
    by: req.user._id,
    note: req.body.note,
  });
  res.status(httpStatus.OK).send({ product });
});

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  generateVariants,
  getProductForm,
  approveProduct,
};