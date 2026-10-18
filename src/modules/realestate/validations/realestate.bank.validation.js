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

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const createOffer = {
  body: Joi.object().keys({
    loanApplication: objectId.required(),
    loanAmount: Joi.number().positive().required(),
    tenureMonths: Joi.number().integer().min(1).optional(),
    interestRate: Joi.number().min(0).max(100).optional(),
    processingFee: Joi.number().min(0).optional(),
    otherTerms: Joi.string().allow('').optional(),
  }),
};

// Target state is a route parameter, allow-listed here AND in the
// service table (plan §0.0). Bank-only targets are enforced again in
// the service by actorType (BR-10).
const ALLOWED_STATUS = ['SANCTIONED', 'REJECTED', 'DISBURSED', 'WITHDRAWN'];

const setStatus = {
  params: Joi.object().keys({
    id: objectId.required(),
    status: Joi.string().valid(...ALLOWED_STATUS).required(),
  }),
  body: Joi.object().keys({
    sanctionedAmount: Joi.number().min(0).optional(),
    disbursedAmount: Joi.number().min(0).optional(),
    rejectionReason: Joi.string().allow('').optional(),
  }),
};

module.exports = {
  createOffer,
  setStatus,
  ALLOWED_STATUS,
};
