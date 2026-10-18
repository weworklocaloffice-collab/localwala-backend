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

const UNITS = ['litre', 'ml', 'g', 'kg', 'piece'];

const allValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

// //// Delete ////

/**
 * Deletion carries nothing but the id, so it gets a params-only schema.
 *
 * It looks like the update schemas could be reused, but they cannot: those carry a
 * `body` with `.min(1)`, and a DELETE has no body. `express.urlencoded` leaves
 * `req.body` as `{}`, so a DELETE validated against an update schema is rejected
 * with `"key" is required` — the delete never reaches the controller. All three
 * taxonomy deletes share this one schema for the same reason: a second copy would
 * drift the moment the param shape changed.
 */
const idParam = Joi.object().keys({ id: Joi.string().custom(objectId).required() });

const deleteValidation = { params: idParam };

// //// Category ////

const categoryBody = {
  key: Joi.string().required().lowercase().trim(),
  name: Joi.string().required().trim(),
  description: Joi.string().allow('', null),
  image: Joi.string().allow('', null),
  icon: Joi.string().allow('', null),
  featured: Joi.boolean().default(false),
  sortOrder: Joi.number().default(0),
  status: Joi.boolean().default(true),
};

const categoryCreateValidation = { body: Joi.object().keys(categoryBody) };

const categoryUpdateValidation = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys(categoryBody).min(1),
};

const categoryListValidation = {
  query: allValidation.query.keys({ featured: Joi.string().valid('true', 'false') }),
};

// //// Sub-category ////

const subCategoryBody = {
  category: Joi.string().custom(objectId).required(),
  key: Joi.string().allow('', null).lowercase().trim(),
  name: Joi.string().required().trim(),
  description: Joi.string().allow('', null),
  image: Joi.string().allow('', null),
  sortOrder: Joi.number().default(0),
  status: Joi.boolean().default(true),
};

const subCategoryCreateValidation = { body: Joi.object().keys(subCategoryBody) };

const subCategoryUpdateValidation = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys(subCategoryBody).min(1),
};

const subCategoryListValidation = {
  query: allValidation.query.keys({ category: Joi.string().custom(objectId) }),
};

// //// Brand ////

const brandBody = {
  name: Joi.string().required().trim(),
  logo: Joi.string().allow('', null),
  description: Joi.string().allow('', null),
  country: Joi.string().allow('', null),
  manufacturer: Joi.string().custom(objectId).allow('', null),
  fssaiLicence: Joi.string().allow('', null),
  sortOrder: Joi.number().default(0),
  status: Joi.boolean().default(true),
};

const brandCreateValidation = { body: Joi.object().keys(brandBody) };

const brandUpdateValidation = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys(brandBody).min(1),
};

// //// Product ////

/**
 * `fatLevel` and `milkType` are the two independent dimensions hidden behind the
 * flat sub-category list (see `DairySubCategory`'s header note).
 */
const productBody = {
  business: Joi.string().custom(objectId).required(),
  category: Joi.string().custom(objectId).required(),
  subCategory: Joi.string().custom(objectId).allow('', null),
  brand: Joi.string().custom(objectId).allow('', null),
  name: Joi.string().required().trim(),
  shortDescription: Joi.string().allow('', null),
  description: Joi.string().allow('', null),
  images: Joi.array().items(Joi.string()),
  attributes: Joi.object().keys({
    fatLevel: Joi.string().allow('', null),
    milkType: Joi.string().allow('', null),
    variant: Joi.string().allow('', null),
  }),
  isVeg: Joi.boolean().default(true),
  sortOrder: Joi.number().default(0),
  status: Joi.boolean().default(true),
};

const productCreateValidation = { body: Joi.object().keys(productBody) };

const productUpdateValidation = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys(productBody).fork('business', (schema) => schema.optional()).min(1),
};

const productListValidation = {
  query: allValidation.query.keys({
    business: Joi.string().custom(objectId),
    category: Joi.string().custom(objectId),
    subCategory: Joi.string().custom(objectId),
    brand: Joi.string().custom(objectId),
    fatLevel: Joi.string(),
    milkType: Joi.string(),
    variant: Joi.string(),
  }),
};

const productDetailValidation = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  query: Joi.object().keys({ includeOutOfStock: Joi.boolean() }),
};

const searchValidation = {
  query: Joi.object().keys({
    business: Joi.string().custom(objectId),
    category: Joi.string().custom(objectId),
    subCategory: Joi.string().custom(objectId),
    brand: Joi.string().custom(objectId),
    fatLevel: Joi.string(),
    milkType: Joi.string(),
    search: Joi.string().allow(null, ''),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

// //// SKU ////

const skuBody = {
  product: Joi.string().custom(objectId).required(),
  business: Joi.string().custom(objectId).allow('', null),
  category: Joi.string().custom(objectId).allow('', null),
  subCategory: Joi.string().custom(objectId).allow('', null),
  brand: Joi.string().custom(objectId).allow('', null),
  name: Joi.string().required().trim(),
  packSize: Joi.object().keys({
    value: Joi.string().allow('', null),
    unit: Joi.string().valid(...UNITS).default('litre'),
    quantity: Joi.number().min(0).default(0),
  }),
  reusableContainer: Joi.boolean().default(false),
  rotationSize: Joi.number().integer().min(2).default(2),
  price: Joi.number().min(0).default(0),
  mrp: Joi.number().min(0).default(0),
  taxPercentage: Joi.number().min(0).default(0),
  availableQty: Joi.number().integer().min(0).default(0),
  inStock: Joi.boolean().default(true),
  shelfLifeHours: Joi.number().min(0).allow('', null),
  isVeg: Joi.boolean().default(true),
  status: Joi.boolean().default(true),
};

const skuCreateValidation = { body: Joi.object().keys(skuBody) };

const skuUpdateValidation = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object()
    .keys(skuBody)
    .fork('product', (schema) => schema.optional())
    .min(1),
};

/**
 * Stock moves as a delta, never an absolute figure — see the service note on why.
 */
const stockAdjustValidation = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({
    delta: Joi.number().integer().required(),
  }),
};

const skuListValidation = {
  query: allValidation.query.keys({
    business: Joi.string().custom(objectId),
    product: Joi.string().custom(objectId),
    inStock: Joi.string().valid('true', 'false'),
    reusableContainer: Joi.string().valid('true', 'false'),
  }),
};

const treeValidation = {
  query: Joi.object().keys({ business: Joi.string().custom(objectId) }),
};

const importProductsValidation = {
  body: Joi.object().keys({
    products: Joi.array()
      .items(
        Joi.object().keys({
          category: Joi.string().custom(objectId).required(),
          subCategory: Joi.string().custom(objectId).allow('', null),
          brand: Joi.string().custom(objectId).allow('', null),
          name: Joi.string().required().trim(),
          shortDescription: Joi.string().allow('', null),
          description: Joi.string().allow('', null),
          attributes: Joi.object().keys({
            fatLevel: Joi.string().allow('', null),
            milkType: Joi.string().allow('', null),
            variant: Joi.string().allow('', null),
          }),
        })
      )
      .min(1)
      .required(),
  }),
};

module.exports = {
  UNITS,
  allValidation,
  deleteValidation,
  categoryCreateValidation,
  categoryUpdateValidation,
  categoryListValidation,
  subCategoryCreateValidation,
  subCategoryUpdateValidation,
  subCategoryListValidation,
  brandCreateValidation,
  brandUpdateValidation,
  brandListValidation: allValidation,
  brandDeleteValidation: deleteValidation,
  productCreateValidation,
  productUpdateValidation,
  productListValidation,
  productDetailValidation,
  searchValidation,
  skuCreateValidation,
  skuUpdateValidation,
  stockAdjustValidation,
  skuListValidation,
  treeValidation,
  importProductsValidation,
};