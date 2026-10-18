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

/**
 * jhatka.admin.validation.js — Joi schemas for the eight admin files.
 *
 * Covers id params on every :param route plus the main POST/PATCH bodies.
 * List routes validate page/limit and pass status filters through.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const namedParam = (name) => ({
  params: Joi.object().keys({
    [name]: objectId.required(),
  }),
});

const pageQuery = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(500),
    status: Joi.string(),
    outlet: Joi.string(),
  }),
};

const categoryBody = {
  body: Joi.object()
    .keys({
      key: Joi.string().valid('chicken', 'mutton', 'fish_seafood', 'eggs'),
      name: Joi.string(),
      sortOrder: Joi.number().integer(),
    })
    .unknown(true),
};

const productBody = {
  body: Joi.object()
    .keys({
      category: objectId,
      code: Joi.string(),
      name: Joi.string(),
      hsnCode: Joi.string(),
      status: Joi.string().valid('active', 'inactive'),
    })
    .unknown(true),
};

const variantBody = {
  body: Joi.object()
    .keys({
      product: objectId,
      sku: Joi.string(),
      name: Joi.string(),
      measurementMode: Joi.string().valid('WEIGHT', 'COUNT'),
      pricePerUnit: Joi.number().min(0),
      priceBasis: Joi.string().valid('per_kg', 'per_piece', 'per_dozen', 'per_pack'),
      status: Joi.string().valid('active', 'inactive'),
    })
    .unknown(true),
};

const outletBody = {
  body: Joi.object()
    .keys({
      name: Joi.string(),
      status: Joi.string().valid('draft', 'pending_approval', 'active', 'suspended', 'closed'),
      statusReason: Joi.string(),
    })
    .unknown(true),
};

const supplierBody = {
  body: Joi.object()
    .keys({
      name: Joi.string(),
      code: Joi.string(),
      status: Joi.string().valid('active', 'suspended', 'terminated'),
      statusReason: Joi.string(),
    })
    .unknown(true),
};

const reviewDecisionBody = {
  body: Joi.object()
    .keys({
      action: Joi.string().valid('approve', 'reject', 'hide').required(),
      reason: Joi.string(),
    })
    .unknown(true),
};

const settlementDecisionBody = {
  body: Joi.object()
    .keys({
      force: Joi.boolean(),
      resolutionNote: Joi.string(),
      reason: Joi.string(),
    })
    .unknown(true),
};

const payoutApproveBody = {
  body: Joi.object()
    .keys({
      paymentReference: Joi.string(),
      notes: Joi.string(),
    })
    .unknown(true),
};

// Admin commission rules speak PERCENT with a basis enum — deliberately
// different from the partner money endpoint's basis POINTS. See
// jhatka.partner.money.validation.js; mixing them is a 100x payout bug.
const commissionRuleAdminBody = {
  body: Joi.object()
    .keys({
      code: Joi.string(),
      name: Joi.string(),
      businessModel: Joi.string().valid('commission_partner', 'franchise', 'direct'),
      basis: Joi.string().valid('final_weighted_value', 'gross_order_value', 'net_of_refunds', 'fixed_monthly'),
      ratePercent: Joi.number().min(0).max(100),
    })
    .unknown(true),
};

module.exports = {
  namedParam,
  pageQuery,
  categoryBody,
  productBody,
  variantBody,
  outletBody,
  supplierBody,
  reviewDecisionBody,
  settlementDecisionBody,
  payoutApproveBody,
  commissionRuleAdminBody,
};
