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

const PERIODS = ['daily', 'weekly', 'monthly'];

const partnerCreateValidation = {
  body: Joi.object().keys({
    business: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    partnerCode: Joi.string().required().trim(),
    name: Joi.string().required().trim(),
    commissionPercentage: Joi.number().min(0).max(100).required(),
    // Default is product-only; see DairyPartner.commissionBasis for why.
    commissionBasis: Joi.string().valid('product_only', 'product_and_delivery').default('product_only'),
    agreement: Joi.object().keys({
      startDate: Joi.date().required(),
      endDate: Joi.date().allow('', null),
      minimumGuarantee: Joi.number().min(0).default(0),
      documentUrl: Joi.string().allow('', null),
      notes: Joi.string().allow('', null),
    }).required(),
    payoutMethod: Joi.string().valid('wallet', 'bank').default('wallet'),
    payoutDetails: Joi.object().keys({
      accountName: Joi.string().allow('', null),
      accountNumber: Joi.string().allow('', null),
      ifsc: Joi.string().allow('', null),
      upiId: Joi.string().allow('', null),
    }),
      driverPayoutMode: Joi.string().valid('business_pays'),
  }),
};

const partnerUpdateValidation = {
  params: Joi.object().keys({ partner: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({
    commissionPercentage: Joi.number().min(0).max(100),
    commissionBasis: Joi.string().valid('product_only', 'product_and_delivery'),
      driverPayoutMode: Joi.string().valid('business_pays'),
    payoutMethod: Joi.string().valid('wallet', 'bank'),
    payoutDetails: Joi.object().keys({
      accountName: Joi.string().allow('', null),
      accountNumber: Joi.string().allow('', null),
      ifsc: Joi.string().allow('', null),
      upiId: Joi.string().allow('', null),
    }),
    agreement: Joi.object().keys({
      startDate: Joi.date(),
      endDate: Joi.date().allow('', null),
      minimumGuarantee: Joi.number().min(0),
      documentUrl: Joi.string().allow('', null),
      notes: Joi.string().allow('', null),
    }),
  }).min(1),
};

const partnerStatusValidation = {
  params: Joi.object().keys({
    partner: Joi.string().custom(objectId).required(),
    status: Joi.string().valid('active', 'suspended', 'terminated').required(),
  }),
  body: Joi.object().keys({ reason: Joi.string().allow('', null) }),
};

const partnerListValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid('pending', 'active', 'suspended', 'terminated'),
    business: Joi.string().custom(objectId),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const franchiseCreateValidation = {
  body: Joi.object().keys({
    business: Joi.string().custom(objectId).required(),
    operator: Joi.string().custom(objectId).required(),
    franchiseCode: Joi.string().required().trim(),
    name: Joi.string().required().trim(),
    revenueSharePercentage: Joi.number().min(0).max(100).required(),
    revenueShareBasis: Joi.string().valid('product_only', 'product_and_delivery').default('product_only'),
    joiningFee: Joi.number().min(0).default(0),
    royalty: Joi.number().min(0).default(0),
    royaltyFrequency: Joi.string().valid('monthly', 'quarterly', 'annual').default('monthly'),
    territory: Joi.object().keys({
      city: Joi.string().custom(objectId).allow('', null),
      localities: Joi.array().items(Joi.string().custom(objectId)),
      polygon: Joi.object().keys({
        type: Joi.string().valid('Polygon'),
        coordinates: Joi.array().items(Joi.array().items(Joi.array().items(Joi.number()))),
      }),
    }),
    agreement: Joi.object().keys({
      startDate: Joi.date().required(),
      endDate: Joi.date().allow('', null),
      documentUrl: Joi.string().allow('', null),
      notes: Joi.string().allow('', null),
    }).required(),
    supplyModel: Joi.string().valid('platform_supplied', 'local_procurement', 'mixed').default('platform_supplied'),
    procurementEnabled: Joi.boolean().default(false),
  }),
};

const franchiseListValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid('pending', 'active', 'suspended', 'expired', 'terminated'),
    business: Joi.string().custom(objectId),
    city: Joi.string().custom(objectId),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const franchiseStatusValidation = {
  params: Joi.object().keys({
    franchise: Joi.string().custom(objectId).required(),
    status: Joi.string().valid('active', 'suspended', 'expired', 'terminated').required(),
  }),
  body: Joi.object().keys({ reason: Joi.string().allow('', null) }),
};

/**
 * Candidate franchise operators.
 *
 * Feeds the admin create dialog's operator picker. See
 * `listFranchiseOperators` for why this had to exist.
 */
const franchiseOperatorListValidation = {
  query: Joi.object().keys({
    search: Joi.string().allow(null, ''),
    limit: Joi.number().integer().min(1).max(100),
    page: Joi.number().integer().min(0),
  }),
};

const generateValidation = {
  body: Joi.object()
    .keys({
      partner: Joi.string().custom(objectId),
      franchise: Joi.string().custom(objectId),
      period: Joi.string().valid(...PERIODS).default('monthly'),
      reference: Joi.date().allow('', null),
      from: Joi.date(),
      to: Joi.date(),
    })
    // Exactly one agreement type, so a settlement cannot straddle both.
    .xor('partner', 'franchise'),
};

const settlementStatusValidation = {
  params: Joi.object().keys({
    status: Joi.string().valid('submitted', 'approved', 'draft', 'disputed', 'void').required(),
    settlement: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null),
    notes: Joi.string().allow('', null),
  }),
};

const settlementPayValidation = {
  params: Joi.object().keys({ settlement: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({ reference: Joi.string().allow('', null) }),
};

const settlementListValidation = {
  query: Joi.object().keys({
    business: Joi.string().custom(objectId),
    partner: Joi.string().custom(objectId),
    franchise: Joi.string().custom(objectId),
    status: Joi.string().valid('draft', 'submitted', 'approved', 'paid', 'disputed', 'void'),
    settlementType: Joi.string().valid('commission', 'franchise'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

/**
 * A single settlement by id.
 *
 * `GET /settlements/:settlement` was sharing the *list* schema, which validates only
 * a query and no params at all. Nothing rejected a malformed id, so it reached the
 * service as whatever the path carried.
 */
const settlementDetailValidation = {
  params: Joi.object().keys({
    settlement: Joi.string().custom(objectId).required(),
  }),
};

const settlementSummaryValidation = {
  query: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
    status: Joi.string().allow('', null),
  }),
};

module.exports = {
  PERIODS,
  partnerCreateValidation,
  partnerUpdateValidation,
  partnerStatusValidation,
  partnerListValidation,
  franchiseCreateValidation,
  franchiseListValidation,
  franchiseOperatorListValidation,
  franchiseStatusValidation,
  generateValidation,
  settlementStatusValidation,
  settlementPayValidation,
  settlementListValidation,
  settlementDetailValidation,
  settlementSummaryValidation,
};
