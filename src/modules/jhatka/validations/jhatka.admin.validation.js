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
      key: Joi.string(),
      name: Joi.string(),
      parent: Joi.string(),
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
      status: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('active', 'inactive')),
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
      unitLabel: Joi.string(),
      packSize: Joi.object({
        value: Joi.number().min(0),
        unit: Joi.string(),
      }).unknown(true),
      status: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('active', 'inactive')),
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

const businessBody = {
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(2).max(160).required(),
      businessModel: Joi.string().valid('direct', 'franchise', 'commission_partner').default('direct'),
      city: objectId.required(),
      locality: objectId.allow('', null),
      code: Joi.string().trim().max(40).allow('', null),
      description: Joi.string().trim().max(1000).allow('', null),
      logo: Joi.string().allow('', null),
      cover: Joi.string().allow('', null),
      contact: Joi.object({
        name: Joi.string().trim().max(120).allow('', null),
        mobile: Joi.alternatives().try(Joi.number(), Joi.string().allow('', null)),
        countryCode: Joi.string().allow('', null),
        email: Joi.string().email().allow('', null),
      }).default({}),
      location: Joi.object({
        type: Joi.string().valid('Point'),
        coordinates: Joi.array().items(Joi.number()).length(2),
      }).allow(null),
    })
    .unknown(false),
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

// A paid payout is an auditable money movement: the bank/UPI reference is the
// only thing that ties this row to the transfer. Optional here would let a paid
// statement exist with no proof it was sent.
const payoutPayBody = {
  body: Joi.object()
    .keys({
      paymentReference: Joi.string().trim().min(3).max(120).required(),
      notes: Joi.string().trim().max(500).allow('', null),
    })
    .unknown(true),
};

const payableGenerateBody = {
  body: Joi.object()
    .keys({
      outlet: objectId.required(),
      supplier: objectId.required(),
      from: Joi.date().required(),
      to: Joi.date().required(),
      label: Joi.string().trim().max(160).allow('', null),
      payoutMethod: Joi.string().valid('bank', 'cash'),
      tdsApplicable: Joi.boolean(),
      tdsRatePercent: Joi.number().min(0).max(100),
      notes: Joi.string().trim().max(500).allow('', null),
    })
    .unknown(true),
};

const payableApproveBody = {
  body: Joi.object()
    .keys({
      notes: Joi.string().trim().max(500).allow('', null),
    })
    .unknown(true),
};

const payableReasonBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).max(500).required(),
    })
    .unknown(true),
};

const payablePayBody = {
  body: Joi.object()
    .keys({
      paymentReference: Joi.string().trim().min(3).max(120).required(),
      notes: Joi.string().trim().max(500).allow('', null),
    })
    .unknown(true),
};

const refundRetryBody = {
  body: Joi.object()
    .keys({
      note: Joi.string().trim().max(500).allow('', null),
    })
    .unknown(false),
};

// A manual refund close is an auditable money movement. Both the external reference
// and the operator's reason are mandatory: without them the row is an unexplained
// REFUNDED that no one can reconcile against a bank or provider statement.
const refundResolveBody = {
  body: Joi.object()
    .keys({
      paymentReference: Joi.string().trim().min(3).max(120).required(),
      note: Joi.string().trim().min(5).max(500).required(),
    })
    .unknown(false),
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
      // The partner's earning rate.
      ratePercent: Joi.number().min(0).max(100),
      // The platform's charge — DEDUCTED from the payout. Deliberately separate
      // from ratePercent: netting them hides both in a statement (the rule
      // model's own comment).
      platformFeePercent: Joi.number().min(0).max(100),
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
  businessBody,
  supplierBody,
  reviewDecisionBody,
  settlementDecisionBody,
  payoutApproveBody,
  payoutPayBody,
  payableGenerateBody,
  payableApproveBody,
  payableReasonBody,
  payablePayBody,
  refundRetryBody,
  refundResolveBody,
  commissionRuleAdminBody,
};
