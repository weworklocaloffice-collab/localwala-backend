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

/**
 * Vendor-facing package, order, and property validation.
 *
 * ## The body is a package *code*, never a price or a count
 *
 * `createOrder` reads `amount` and `packageSnapshot` from the catalogue row and ignores
 * anything the client sends about them. Accepting a client-supplied price is how a ₹1
 * purchase becomes a 50-listing entitlement, so there is deliberately no `price` field
 * here to populate — the absence is the control.
 *
 * The `code` is constrained to uppercase letters, digits and underscores because that is
 * how package codes are stored (`findByCode` upper-cases, and the model's unique index is
 * on the code). Accepting arbitrary text here would only produce a lookup miss, so the
 * pattern turns a silent 404 into a 400.
 *
 * ## Property body validation is intentionally narrow
 *
 * `specs` is left as a free-form object because the spec schema comes from the chosen
 * category and is validated at the service layer. That keeps category edits from forcing
 * a Joi change here, but it also means a vendor cannot smuggle in a top-level
 * `status: 'PUBLISHED'` — the create service hard-codes `status: 'DRAFT'`. The
 * `unknown(false)` on the create body is therefore the second copy of that control.
 */

const PACKAGE_CODE = Joi.string()
  .trim()
  .uppercase()
  .pattern(/^[A-Z0-9_]{2,32}$/)
  .required()
  .messages({
    'string.pattern.base':
      '{{#label}} must be 2-32 characters of A-Z, 0-9 or underscore, e.g. BASIC',
  });

const OBJECT_ID = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .messages({
    'string.pattern.base': '{{#label}} must be a valid mongo id',
  });

const orderIdParam = Joi.object({
  id: OBJECT_ID.required(),
});

const packageCodeParam = Joi.object({
  code: PACKAGE_CODE.required(),
});

const purchaseBody = Joi.object({
  package: PACKAGE_CODE,
}).unknown(false);

const payBody = Joi.object({
  payment: OBJECT_ID,
}).unknown(false);

const orderStatusParam = Joi.object({
  id: OBJECT_ID.required(),
  status: Joi.string().valid('PAID', 'FAILED', 'CANCELLED').required(),
});

const cancelBody = Joi.object({
  reason: Joi.string().trim().min(3).max(500),
}).unknown(false);

const listQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

// ----------------------------------------------------------- property payloads

const coordinatesSchema = Joi.array()
  .length(2)
  .items(Joi.number().min(-180).max(180), Joi.number().min(-90).max(90))
  .messages({
    'array.length': '{{#label}} must be exactly two numbers: [longitude, latitude]',
  });

const locationSchema = Joi.object({
  addressLine: Joi.string().trim().max(500),
  locality: OBJECT_ID.required(),
  city: OBJECT_ID.required(),
  // No client can resolve State/Country ids (no states endpoint; cities
  // carry no state link), so both are optional: the service derives `state`
  // from the locality's operational zone, like `operationalZone` (BR-19).
  state: OBJECT_ID,
  country: OBJECT_ID,
  pincode: Joi.string().trim().pattern(/^[0-9]{4,10}$/).messages({
    'string.pattern.base': '{{#label}} must be 4-10 digits',
  }),
  coordinates: coordinatesSchema.required(),
  mapAddress: Joi.string().trim().max(500),
}).unknown(false);

const mediaItem = Joi.object({
  type: Joi.string().valid('IMAGE', 'VIDEO', 'FLOOR_PLAN', 'VIRTUAL_TOUR').required(),
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  thumbUrl: Joi.string().uri({ scheme: ['http', 'https'] }),
  caption: Joi.string().trim().max(200),
  sortOrder: Joi.number().integer().min(0).default(0),
  visibility: Joi.string().valid('PUBLIC', 'INTERNAL').default('PUBLIC'),
}).unknown(false);

const createPropertyBody = Joi.object({
  title: Joi.string().trim().min(3).max(200).required(),
  description: Joi.string().trim().max(5000),
  transactionType: Joi.string().valid('BUY', 'RENT').required(),
  price: Joi.number().min(0).required(),
  priceOnRequest: Joi.boolean().default(false),
  category: OBJECT_ID.required(),
  location: locationSchema.required(),
  specs: Joi.object().unknown(true),
  amenities: Joi.array().items(Joi.string().trim().max(60)).max(40),
  media: Joi.array().items(mediaItem).max(20),
  projectName: Joi.string().trim().max(200),
  builderName: Joi.string().trim().max(200),
}).unknown(false);

const updatePropertyBody = Joi.object({
  title: Joi.string().trim().min(3).max(200),
  description: Joi.string().trim().max(5000),
  transactionType: Joi.string().valid('BUY', 'RENT'),
  price: Joi.number().min(0),
  priceOnRequest: Joi.boolean(),
  category: OBJECT_ID,
  location: locationSchema,
  specs: Joi.object().unknown(true),
  amenities: Joi.array().items(Joi.string().trim().max(60)).max(40),
  media: Joi.array().items(mediaItem).max(20),
  projectName: Joi.string().trim().max(200),
  builderName: Joi.string().trim().max(200),
})
  .min(1)
  .unknown(false);

const propertyIdParam = Joi.object({
  id: OBJECT_ID.required(),
});

// `status` is allow-listed again here (BR-03 / doc §0.0). The service is the third
// copy: a vendor may only target a state reachable from the current one. This Joi
// guard prevents a typo from spending a 500 on a misspelt value.
const propertyStatusParam = Joi.object({
  id: OBJECT_ID.required(),
  status: Joi.string()
    .valid('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUIRED', 'ARCHIVED')
    .required(),
});

const transitionBody = Joi.object({
  reason: Joi.string().trim().min(3).max(500),
}).unknown(false);

const propertyListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid(
    'DRAFT',
    'SUBMITTED',
    'IN_REVIEW',
    'CHANGES_REQUIRED',
    'APPROVED',
    'PUBLISHED',
    'SUSPENDED',
    'EXPIRED',
    'SOLD',
    'RENTED',
    'ARCHIVED'
  ),
}).unknown(true);

// ----------------------------------------------------------- document payloads

// Mirrors the model's `category` enum. Duplicating here means a typo
// in the client becomes a 400 here, not a write that silently slips
// through to the document and breaks the verification checklist.
const DOCUMENT_CATEGORY = Joi.string()
  .trim()
  .uppercase()
  .valid('OWNERSHIP', 'APPROVAL', 'TAX', 'ENCUMBRANCE', 'PROJECT', 'SELLER', 'OTHER')
  .required();

// Mirrors the model's `visibility` enum, restricted to the two
// values a vendor may set. ADMIN_ONLY and BANK_VISIBLE are reviewer
// and loan-officer classes; the vendor's role is the seller, not
// the gatekeeper.
const DOCUMENT_VISIBILITY = Joi.string()
  .valid('INTERNAL', 'CUSTOMER_VISIBLE')
  .default('INTERNAL');

const uploadDocumentBody = Joi.object({
  category: DOCUMENT_CATEGORY,
  title: Joi.string().trim().min(2).max(200).required(),
  fileUrl: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  fileName: Joi.string().trim().max(255),
  mimeType: Joi.string().trim().lowercase().max(100).required(),
  sizeBytes: Joi.number().integer().min(1).max(50 * 1024 * 1024).required(),
  checksum: Joi.string().trim().max(128),
  visibility: DOCUMENT_VISIBILITY,
  notes: Joi.string().trim().max(500),
}).unknown(false);

const documentParams = Joi.object({
  id: OBJECT_ID.required(),
  documentId: OBJECT_ID.required(),
});

// ----------------------------------------------------------- lead / visit / customer / hold

const leadStatusEnum = Joi.string().valid(
  'NEW',
  'CONTACTED',
  'VISIT_REQUESTED',
  'VISIT_SCHEDULED',
  'VISIT_COMPLETED',
  'FOLLOW_UP',
  'HOLD',
  'SALE',
  'LOST'
);

const visitStatusEnum = Joi.string().valid(
  'ASSIGNED',
  'ACCEPTED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
);

const holdStatusEnum = Joi.string().valid(
  'PENDING_PAYMENT',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
  'CONVERTED_TO_SALE',
  'REFUND_PENDING',
  'REFUNDED',
  'ADJUSTED'
);

const leadsListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: leadStatusEnum,
}).unknown(true);

const visitsListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: visitStatusEnum,
}).unknown(true);

const holdsListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: holdStatusEnum,
}).unknown(true);

const customersListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const leadParams = Joi.object({ id: OBJECT_ID.required() });
const visitParams = Joi.object({ id: OBJECT_ID.required() });
const holdParamsFull = Joi.object({ id: OBJECT_ID.required() });

// ----------------------------------------------------------- commission / sale

const commissionStatusEnum = Joi.string().valid(
  'PENDING',
  'VERIFIED',
  'EARNED',
  'SETTLEMENT_CREATED',
  'PAID',
  'REVERSED'
);

const commissionsListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  status: commissionStatusEnum,
}).unknown(true);

const salesListQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const saleParams = Joi.object({ id: OBJECT_ID.required() });

/**
 * ## The export shape
 *
 * `src/middlewares/validate.js` does `pick(schema, ['params', 'query', 'body'])` and returns
 * `next()` when nothing matched. Bare schemas are therefore **not validated at all** while
 * still appearing to be wired in — see the same note in
 * `realestate.executive.validation.js`, where that mistake affected 16 routes.
 *
 * So the exports below are `{ params }` / `{ body }` / `{ query }`, and the raw schemas are
 * kept under `raw` for unit testing the shapes themselves.
 */
module.exports = {
  PACKAGE_CODE,

  raw: {
    packageCodeParam,
    purchaseBody,
    payBody,
    orderIdParam,
    orderStatusParam,
    cancelBody,
    listQuery,
    createPropertyBody,
    updatePropertyBody,
    propertyIdParam,
    propertyStatusParam,
    transitionBody,
    propertyListQuery,
    uploadDocumentBody,
    documentParams,
    leadsListQuery,
    visitsListQuery,
    holdsListQuery,
    customersListQuery,
    leadParams,
    visitParams,
    holdParamsFull,
    commissionsListQuery,
    salesListQuery,
    saleParams,
  },

  packages: { query: listQuery },
  purchase: { params: packageCodeParam },
  orderParams: { params: orderIdParam },
  orderStatusParams: { params: orderStatusParam },
  cancel: { params: orderIdParam, body: cancelBody },
  pay: { params: orderIdParam, body: payBody },
  orders: { query: listQuery },

  createProperty: { body: createPropertyBody },
  updateProperty: { params: propertyIdParam, body: updatePropertyBody },
  propertyIdParam: { params: propertyIdParam },
  propertyStatus: { params: propertyStatusParam, body: transitionBody },
  propertyList: { query: propertyListQuery },

  uploadDocument: { params: propertyIdParam, body: uploadDocumentBody },
  listDocuments: { params: propertyIdParam },
  documentById: { params: documentParams },
  deleteDocument: { params: documentParams },

  leadsList: { query: leadsListQuery },
  leadParams: { params: leadParams },
  visitsList: { query: visitsListQuery },
  visitParams: { params: visitParams },
  holdsList: { query: holdsListQuery },
  holdParamsFull: { params: holdParamsFull },
  customersList: { query: customersListQuery },
  commissionsList: { query: commissionsListQuery },
  salesList: { query: salesListQuery },
  saleParams: { params: saleParams },
};