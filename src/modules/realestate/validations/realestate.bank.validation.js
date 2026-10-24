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
const ALLOWED_STATUS = ['UNDER_BANK_REVIEW', 'SANCTIONED', 'REJECTED', 'DISBURSED', 'WITHDRAWN'];

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

/**
 * The document a bank asks the customer for.
 *
 * `category` is a closed enum so the request list cannot end up with
 * "Salary Slip" and "salary slip" as two different asks. `title` is the
 * bank's own label ("Salary slips - last 3 months"), because "SALARY_SLIP"
 * alone does not tell a customer what to send.
 */
const DOCUMENT_REQUEST_CATEGORIES = [
  'AADHAAR',
  'PAN',
  'SALARY_SLIP',
  'SELF_EMPLOYED_INCOME',
  'BANK_STATEMENT',
  'KYC',
  'CREDIT_REPORT',
  'CERTIFICATE',
  'OTHER',
];

const createDocumentRequest = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
  body: Joi.object().keys({
    category: Joi.string().valid(...DOCUMENT_REQUEST_CATEGORIES).required(),
    title: Joi.string().trim().min(2).max(200).required(),
    notes: Joi.string().trim().max(2000).allow('').optional(),
    // The portal posts a plain `YYYY-MM-DD` (an <input type="date">),
    // so this accepts a calendar date as well as a full ISO stamp.
    dueDate: Joi.string().isoDate().optional(),
  }),
};

const reviewDocumentRequest = {
  params: Joi.object().keys({
    requestId: objectId.required(),
  }),
  body: Joi.object().keys({
    decision: Joi.string().valid('ACCEPTED', 'REJECTED').required(),
    note: Joi.string().trim().max(2000).allow('').optional(),
  }),
};

module.exports = {
  createOffer,
  setStatus,
  ALLOWED_STATUS,
  DOCUMENT_REQUEST_CATEGORIES,
  createDocumentRequest,
  reviewDocumentRequest,
};
