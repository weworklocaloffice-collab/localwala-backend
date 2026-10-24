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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

/**
 * Customer-facing Real Estate validation.
 *
 * ## The enquiry body
 *
 * `property` is required and the customer is **not**. The customer comes from the access
 * token: doc §7.1 is explicit that for a customer route "tenant is `req.user`", and an
 * enumerable `customer` field would let one signed-in customer file an enquiry under
 * another's account — which then shows in that person's history and gets their contact
 * details called.
 *
 * ## Referral is attribution, not identity
 *
 * `referralCode` names a *code*, never a user. Whoever holds the code is the referrer, and
 * that relationship is resolved server-side against the referral-code table. A
 * `referrer` field in the body would let a customer claim a referral to any account id.
 */

/** A Mongo id as a Joi schema. `objectId` is a validator function, not a schema. */
const id = Joi.string().custom(objectId);

/**
 * Lead status enum, mirroring `RealEstateLead.status`.
 *
 * Declared here rather than imported from the model: a Joi schema cannot read a mongoose
 * enum, and a copy that drifts from the model would let a request reach the service with a
 * status the model then rejects — a 500 instead of a 400.
 */
const LEAD_STATUS = [
  'NEW',
  'CONTACTED',
  'VISIT_REQUESTED',
  'VISIT_SCHEDULED',
  'VISIT_COMPLETED',
  'FOLLOW_UP',
  'HOLD',
  'SALE',
  'LOST',
];

const propertyIdParam = Joi.object({
  id: id.required(),
});

/**
 * No `property` field here on purpose.
 *
 * The property is `:id` in the path (`POST /properties/:id/enquiry`), so requiring it in
 * the body as well would demand the same id twice and let the two disagree — the body
 * would be the one the service read while the URL said something else. The controller
 * takes it from `req.params.id`.
 */
const enquiryBody = Joi.object({
  referralCode: Joi.string().trim().uppercase().max(32),
  // Free-text note from the customer about what they want. Recorded on the lead.
  message: Joi.string().trim().max(2000).allow(''),
})
  .unknown(false);

const leadIdParam = Joi.object({
  id: id.required(),
});

/**
 * Status change from the customer side.
 *
 * ## The model has no `CLOSED`
 *
 * `RealEstateLead.status` is NEW → CONTACTED → VISIT_REQUESTED → VISIT_SCHEDULED →
 * VISIT_COMPLETED → FOLLOW_UP → HOLD → SALE → LOST. A first draft of this schema offered a
 * customer-side `CLOSED`, which would have produced a `ValidationError` on save — a 500
 * from a route that looked like it worked.
 *
 * A customer's withdrawal is therefore recorded as `LOST`, with the reason captured, rather
 * than by inventing a terminal state the lifecycle does not have. `LOST` is the honest
 * mapping: the customer is the one deciding, and the rest of the pipeline must see it.
 *
 * Everything else in the lifecycle belongs to the vendor and the executive — a customer who
 * could set `VISIT_SCHEDULED` would be booking on their own behalf.
 */
const customerStatusBody = Joi.object({
  status: Joi.string().valid('LOST').required(),
  reason: Joi.string().trim().min(3).max(500).required(),
}).unknown(false);

const listQuery = Joi.object({
  status: Joi.string().valid(...LEAD_STATUS),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const savedPropertyParams = Joi.object({
  propertyId: id.required(),
});

const savedPropertyListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

/**
 * Visit request body (Flow 11).
 *
 * `lead` in the body, not the path — the customer's leads are already
 * enumerated in the app, and the controller resolves the property from
 * the lead so a property id cannot disagree with the lead's own.
 *
 * There is deliberately **no** `customer` (tenant is `req.user`) and
 * no `status` / `executive` field: a customer cannot choose their own
 * status or self-assign, and an enumerable `executive` here would be
 * an assignment engine reachable from a phone.
 *
 * `preferredDate` accepts any ISO date — including a past one. The
 * past-date guard lives in the service, next to the property and
 * duplicate-request guards, because all three are business rules the
 * controller turns into 400/409 responses in one place.
 */
const visitCreateBody = Joi.object({
  lead: id.required(),
  preferredDate: Joi.date().iso().required(),
  preferredTimeSlot: Joi.string().valid('MORNING', 'AFTERNOON', 'EVENING').required(),
  note: Joi.string().trim().max(500).allow(''),
}).unknown(false);

const visitIdParam = Joi.object({
  id: id.required(),
});

const visitListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

/**
 * Loan request body (Flow 12).
 *
 * `property` is in the body (the loan form opens from a property, but
 * unlike the enquiry it is not a path param) — the controller still
 * loads it and applies the same PUBLIC_STATUS check, so an unpublished
 * listing cannot be referenced here either.
 *
 * `employment` and `monthlyIncome` are **required for new requests**:
 * the checklist names them as form fields and a bank prices nothing
 * without income. The model keeps them optional only for rows created
 * before the fields existed.
 *
 * There is deliberately no `customer` (tenant is `req.user`), no
 * `status`, and no `bank` — a customer cannot pick which banks see the
 * lead, and cannot mark their own request sanctioned (BR-10).
 */
const loanCreateBody = Joi.object({
  property: id.required(),
  lead: id,
  requestedAmount: Joi.number().integer().min(1000).max(1000000000).required(),
  tenureMonths: Joi.number().integer().min(1).max(360),
  employment: Joi.string().valid('SALARIED', 'SELF_EMPLOYED', 'BUSINESS', 'OTHER').required(),
  monthlyIncome: Joi.number().min(0).max(100000000).required(),
}).unknown(false);

const loanIdParam = Joi.object({
  id: id.required(),
});

const loanOfferParam = Joi.object({
  id: id.required(),
  offerId: id.required(),
});

const loanListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

/**
 * Purchases are read-only. There is deliberately no status filter: a
 * customer sees their own COMPLETED and CANCELLED rows, and the tenant
 * comes from the token.
 */
const purchaseIdParam = Joi.object({
  id: id.required(),
});

const purchaseListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

/**
 * The customer's answer to a document request.
 *
 * `fileUrl` is required: a request answered with no file is not an
 * answer, and the bank would have to ask again.
 *
 * The value is either an absolute http(s) url or a relative media path
 * (the shared upload endpoint answers with one). A relative path may not
 * walk up the tree: `../../etc/passwd` is not a document.
 */
const documentRequestSubmitBody = Joi.object({
  fileUrl: Joi.string()
    .trim()
    .max(2048)
    .required()
    .custom((value, helpers) => {
      if (/^https?:\/\//i.test(value)) return value;
      if (/^[A-Za-z0-9_\-./]+$/.test(value) && !value.includes('..')) {
        return value;
      }
      return helpers.error('any.invalid');
    }),
  fileName: Joi.string().trim().max(255).allow('').optional(),
  mimeType: Joi.string().trim().max(120).allow('').optional(),
  sizeBytes: Joi.number().integer().min(0).optional(),
}).unknown(false);

const documentRequestParams = Joi.object({
  id: id.required(),
});

/**
 * ## The export shape matters more than it looks
 *
 * `src/middlewares/validate.js` does `pick(schema, ['params', 'query', 'body'])` and then
 * returns `next()` immediately if nothing matched. So a module that exports a bare Joi
 * schema — `enquiryBody` rather than `{ body: enquiryBody }` — is **silently not
 * validating at all**: every request passes through unvalidated.
 *
 * That is not theoretical. The first version of this file exported bare schemas, and
 * `PATCH /leads/:id/withdraw` accepted `status: 'SALE'` — a customer setting their own lead
 * straight to SALE, the one transition that means "this sale closed" and carries a
 * commission. The route looked protected because `validate(...)` was in the chain.
 *
 * Every export below is therefore wrapped in the `{ body }` / `{ params }` / `{ query }`
 * shape `validate()` expects, matching `realestate.public.validation.js`.
 */
module.exports = {
  LEAD_STATUS,
  enquiry: { params: propertyIdParam, body: enquiryBody },
  leadParams: { params: leadIdParam },
  withdraw: { params: leadIdParam, body: customerStatusBody },
  list: { query: listQuery },
  savedPropertyParams: { params: savedPropertyParams },
  savedPropertyList: { query: savedPropertyListQuery },
  createVisit: { body: visitCreateBody },
  visitParams: { params: visitIdParam },
  visitList: { query: visitListQuery },
  createLoan: { body: loanCreateBody },
  loanParams: { params: loanIdParam },
  acceptLoanOffer: { params: loanOfferParam },
  loanList: { query: loanListQuery },
  purchaseParams: { params: purchaseIdParam },
  purchaseList: { query: purchaseListQuery },
  documentRequestParams: { params: documentRequestParams },
  documentRequestSubmit: { params: documentRequestParams, body: documentRequestSubmitBody },
};