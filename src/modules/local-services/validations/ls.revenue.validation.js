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
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const scopeKeys = {
  categoryKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
  subcategoryKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
  serviceKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
  provider: objectId.allow(null),
};

const ruleBody = {
  body: Joi.object()
    .keys({
      code: Joi.string().trim().uppercase().max(64).required(),
      name: Joi.string().trim().max(200).required(),
      description: Joi.string().trim().max(2000).allow('', null),
      revenueModel: Joi.string()
        .valid('BOOKING_FEE', 'COMMISSION', 'COMBINED', 'LEAD_FEE', 'SUBSCRIPTION', 'FEATURED')
        .required(),
      ...scopeKeys,
      payer: Joi.string().valid('customer', 'provider', 'split').required(),
      bookingFeeEnabled: Joi.boolean().required(),
      bookingFee: Joi.number().min(0).max(100000).required(),
      commissionEnabled: Joi.boolean().required(),
      commissionType: Joi.string().valid('percentage', 'fixed').required(),
      commissionRatePercent: Joi.number().min(0).max(100).required(),
      commissionFixedAmount: Joi.number().min(0).max(1000000).required(),
      calculationBasis: Joi.string()
        .valid('LABOUR_ONLY', 'SERVICE_VALUE', 'ELIGIBLE_COLLECTED_AMOUNT', 'BOOKING_VALUE', 'QUALIFIED_LEAD')
        .required(),
      qualifyingEvent: Joi.string()
        .valid('BOOKING_CREATED', 'PAYMENT_RECEIVED', 'SERVICE_COMPLETED', 'COMPLETION_VERIFIED', 'QUOTE_ACCEPTED')
        .required(),
      partsCommissionable: Joi.boolean(),
      allowFeeAndCommissionStack: Joi.boolean(),
      minimumCharge: Joi.number().min(0),
      maximumCharge: Joi.number().min(0),
      currency: Joi.string().valid('INR').required(),
      effectiveFrom: Joi.date().required(),
      effectiveTo: Joi.date().greater(Joi.ref('effectiveFrom')).allow(null),
      refundReversalPolicy: Joi.string().valid('full_reverse', 'prorated', 'no_reverse'),
      stackingPolicy: Joi.string().valid('exclusive', 'stackable'),
    })
    .unknown(false),
};

const idParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const previewBody = {
  body: Joi.object()
    .keys({
      categoryKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      subcategoryKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      serviceKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      provider: objectId.allow(null),
      labourAmount: Joi.number().min(0).max(10000000).required(),
      partsAmount: Joi.number().min(0).max(10000000).required(),
      discountAmount: Joi.number().min(0).max(10000000).default(0),
      atDate: Joi.date(),
    })
    .unknown(false),
};

const statusParam = {
  params: Joi.object().keys({ id: objectId.required(), status: Joi.string().required() }),
};

module.exports = { ruleBody, idParam, previewBody, statusParam };
