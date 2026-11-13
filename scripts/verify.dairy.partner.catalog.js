const { test } = require('node:test');
const assert = require('node:assert/strict');
const Joi = require('joi');
const catalogValidation = require('../src/modules/dairy/validations/dairy.catalog.validation');
const catalogController = require('../src/modules/dairy/controllers/dairy.catalog.controller');
const catalogService = require('../src/modules/dairy/services/dairy.catalog.service');
const { DairyProduct, DairySku } = require('../src/models');

const validCategory = '507f1f77bcf86cd799439011';
const tokenOutlet = '507f191e810c19729de860ea';

test('partner product validation allows token-scoped creation without a business id', () => {
  const result = Joi.compile(catalogValidation.productCreateValidation.body).validate({
    name: 'Farm Milk',
    category: validCategory,
  });
  assert.equal(result.error, undefined);
});

test('product creation uses the authenticated outlet instead of a body outlet', async () => {
  const original = catalogService.createProduct;
  let received;
  catalogService.createProduct = async (payload) => {
    received = payload;
    return payload;
  };
  try {
    let sent;
    await catalogController.productCreate(
      { body: { name: 'Farm Milk', category: validCategory, business: 'client-outlet' }, outletId: tokenOutlet },
      { send: (body) => { sent = body; } },
      (error) => { throw error; }
    );
    assert.equal(received.business, tokenOutlet);
    assert.equal(sent.product.business, tokenOutlet);
  } finally {
    catalogService.createProduct = original;
  }
});

test('partner product listing is always scoped to the authenticated outlet', async () => {
  const original = catalogService.listProducts;
  let received;
  catalogService.listProducts = async (query) => {
    received = query;
    return { products: [], totalResults: 0, page: 1, limit: 10 };
  };
  try {
    await catalogController.partnerProductList(
      { query: { business: 'client-outlet', page: '1' }, outletId: tokenOutlet },
      { send: () => {} },
      (error) => { throw error; }
    );
    assert.equal(received.business, tokenOutlet);
  } finally {
    catalogService.listProducts = original;
  }
});

test('SKU creation checks product ownership and inherits its outlet and taxonomy', async () => {
  const originalProductFindOne = DairyProduct.findOne;
  const originalSkuCreate = DairySku.create;
  let query;
  let created;
  DairyProduct.findOne = async (filter) => {
    query = filter;
    return {
      business: tokenOutlet,
      category: 'category-from-product',
      subCategory: 'subcategory-from-product',
      brand: 'brand-from-product',
    };
  };
  DairySku.create = async (document) => {
    created = document;
    return document;
  };
  try {
    const result = await catalogService.createSku(
      {
        product: validCategory,
        business: 'client-outlet',
        category: 'wrong-category',
        brand: 'wrong-brand',
        name: 'Farm Milk 500 ml',
      },
      tokenOutlet
    );
    assert.equal(query.business.toString(), tokenOutlet);
    assert.equal(created.business, tokenOutlet);
    assert.equal(created.category, 'category-from-product');
    assert.equal(created.subCategory, 'subcategory-from-product');
    assert.equal(created.brand, 'brand-from-product');
    assert.equal(result.name, 'Farm Milk 500 ml');
  } finally {
    DairyProduct.findOne = originalProductFindOne;
    DairySku.create = originalSkuCreate;
  }
});
