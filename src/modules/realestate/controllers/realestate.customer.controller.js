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

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const leadService = require('../services/realestate.lead.service');
const favouriteService = require('../services/realestate.property.favourite.service');
const visitService = require('../services/realestate.visit.service');
const loanService = require('../services/realestate.loan.service');
const saleService = require('../services/realestate.sale.service');
const documentRequestService = require('../services/realestate.document.request.service');
const RealEstateLead = require('../models/realestate.lead.model');
const RealEstateProperty = require('../models/realestate.property.model');
const searchService = require('../services/realestate.property.search.service');

/**
 * Customer-facing Real Estate endpoints — enquiries and the customer's own leads.
 *
 * ## The rule every handler obeys
 *
 * Every read is scoped to `req.user.id`. Doc §7.1: for a customer route "tenant is
 * `req.user`". There is no handler that takes a customer id from the request, because a
 * customer id in a path or body is a customer choosing whose enquiry history to read — and
 * those histories carry contact details and visit dates.
 *
 * ## `POST /properties/:id/enquiry` is one of four named routes (doc §7.3)
 *
 * BR-06 makes it structural, not optional: an enquiry is never a stored contact message, it
 * always creates a Lead. Until this route existed, BR-06 was only reachable by calling the
 * service directly, so the rule had no path a customer could take or a reviewer could test.
 */
const requireCustomer = (req) => {
  // `appAuth()` populates `req.user`; the tenant middleware is not attached here because a
  // customer is neither a vendor nor an executive and would be mislabelled as `guest`.
  if (!req.user || !req.user.id) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in to enquire about a property');
  }
  return req.user.id;
};

/**
 * 404 for a lead that is not this customer's.
 *
 * One message for "missing" and "someone else's", so the endpoint cannot be used to
 * confirm that a lead id exists.
 */
const notFound = () => {
  throw new ApiError(httpStatus.NOT_FOUND, 'Enquiry not found');
};

/**
 * POST /customer/properties/:id/enquiry
 * Create a lead for a published property. BR-06.
 */
const createEnquiry = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);

  // A customer may only enquire about a property a customer can actually see. The search
  // service's `PUBLIC_STATUS` is the same constant the public routes filter on, so this
  // cannot drift into admitting an unpublished listing.
  const property = await RealEstateProperty.findById(req.params.id).lean();
  if (!property) notFound();
  if (property.status !== searchService.PUBLIC_STATUS) notFound();

  const lead = await leadService.createLeadFromEnquiry({
    // From the path, not the body. The validation schema has no `property` field precisely
    // so the URL is the only place the property id can come from.
    property: req.params.id,
    customer: customerId,
    source: 'ENQUIRY',
    referralCode: req.body.referralCode,
    message: req.body.message,
  });

  res.status(httpStatus.CREATED).send({ data: lead });
});

/**
 * GET /customer/leads
 * This customer's own enquiries, newest first.
 */
const listMyLeads = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const { status, page, limit } = req.query;

  const filter = { customer: customerId };
  if (status) filter.status = status;

  const leads = await RealEstateLead.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  const start = (page - 1) * limit;
  res.send({ results: leads.slice(start, start + limit), page, limit, total: leads.length });
});

/**
 * GET /customer/leads/:id
 *
 * The `_id` **and** `customer` go in the query, so a lead belonging to someone else returns
 * null and produces the same 404 as a lead that does not exist.
 */
const getMyLead = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const lead = await RealEstateLead.findOne({ _id: req.params.id, customer: customerId }).lean();
  if (!lead) notFound();
  res.send({ data: lead });
});

/**
 * PATCH /customer/leads/:id/withdraw
 *
 * The customer withdrawing their own enquiry. Recorded as `LOST` with a reason, because
 * `RealEstateLead.status` has no `CLOSED` — see the validation file for why inventing one
 * would have produced a 500.
 */
const withdrawEnquiry = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);

  const lead = await RealEstateLead.findOne({ _id: req.params.id, customer: customerId });
  if (!lead) notFound();

  // Withdrawing a lead that already produced a visit or a hold would erase the reason it
  // was worth anything. BR-21 is about not deleting; this is the same instinct applied to
  // a state change.
  if (['SALE', 'HOLD'].includes(lead.status)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `This enquiry is already "${lead.status}" and cannot be withdrawn`
    );
  }

  if (lead.status === 'LOST') notFound();

  // Recorded BEFORE the save. `recordActivity` re-reads the lead, so calling it after the
  // flip would capture `fromStatus: LOST` — a trail that does not record the lead was ever
  // anything else. `toStatus` is passed explicitly, because the service cannot know the
  // target from the lead's current value.
  //
  // `action: 'LOST'`, not a bespoke 'WITHDRAWN_BY_CUSTOMER'. `RealEstateLeadActivity.action`
  // is a closed enum (audit rows are worthless if the vocabulary is open), and
  // 'WITHDRAWN_BY_CUSTOMER' is not in it — so that spelling saved nothing and raised a
  // ValidationError. The fact that the actor was the *customer* is already carried by
  // `actorType: 'CUSTOMER'`, which is the field designed to answer "who did this".
  await leadService.recordActivity(
    lead._id,
    'LOST',
    customerId,
    'CUSTOMER',
    { reason: req.body.reason, withdrawnByCustomer: true },
    'LOST'
  );

  lead.status = 'LOST';
  await lead.save();

  res.send({ data: lead });
});

/**
 * GET /customer/leads/:id/activity
 *
 * The customer's own view of the history — status changes only, no internal notes. The
 * activity rows carry actor ids and reasons meant for staff, so only the shape a customer
 * can act on is returned.
 */
const getMyLeadActivity = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);

  const lead = await RealEstateLead.findOne({ _id: req.params.id, customer: customerId }).lean();
  if (!lead) notFound();

  const detail = await leadService.getLeadDetail(req.params.id);

  const activity = (detail.activities || []).map((a) => ({
    action: a.action,
    at: a.at || a.createdAt,
  }));

  res.send({ data: activity });
});

// ---------------- Saved properties (Favourite with type: 'property') ----
//
// Reuses the shared Favourite model. Endpoints here are for the
// customer app's "Saved" / "Favourites" tab — the user explicitly
// saves a property, then sees it on the dedicated screen.

const savePropertyFavourite = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { propertyId } = req.params;
  const result = await favouriteService.savePropertyFavourite(userId, propertyId);
  res.status(result.alreadySaved ? httpStatus.OK : httpStatus.CREATED).send(result);
});

const removePropertyFavourite = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { propertyId } = req.params;
  const result = await favouriteService.removePropertyFavourite(userId, propertyId);
  res.status(httpStatus.OK).send(result);
});

const isPropertyFavourited = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { propertyId } = req.params;
  const saved = await favouriteService.isPropertyFavourited(userId, propertyId);
  res.status(httpStatus.OK).send({ saved });
});

const listMySavedProperties = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = await favouriteService.listSavedProperties(userId, { page, limit });
  res.status(httpStatus.OK).send(result);
});

// ---------------- Site visits (Flow 11) --------------------------------
//
// The customer asks; the assignment engine decides. Every handler is
// scoped to `req.user.id` — the same rule as the lead endpoints: a
// visit request carries a property, a date, and an executive's name,
// so one customer must never read another's.

/**
 * POST /customer/visits
 * Request a site visit against one of the customer's own leads.
 */
const createVisitRequest = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const request = await visitService.createVisitRequest({
    customer: customerId,
    leadId: req.body.lead,
    preferredDate: req.body.preferredDate,
    preferredTimeSlot: req.body.preferredTimeSlot,
    note: req.body.note,
  });
  res.status(httpStatus.CREATED).send({ data: request });
});

/**
 * GET /customer/visits
 * This customer's visit requests — pending, scheduled and past.
 */
const listMyVisits = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const { page, limit } = req.query;
  const result = await visitService.listVisitRequestsForCustomer(customerId, { page, limit });
  res.send(result);
});

/**
 * GET /customer/visits/:id
 * One visit request; wrong owner and missing id are both 404.
 */
const getMyVisit = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const request = await visitService.findVisitRequestForCustomer(req.params.id, customerId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Visit not found');
  res.send({ data: request });
});

/**
 * POST /customer/loans — Flow 12.
 * Ask for a loan against a property the customer can see. The request
 * is distributed to every ACTIVE bank as a LOAN_LEAD_CREATED
 * application (plan §5.8, §13.3 — a bank sees only its own rows).
 */
const createLoanRequest = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);

  const property = await RealEstateProperty.findById(req.body.property).lean();
  if (!property) notFound();
  if (property.status !== searchService.PUBLIC_STATUS) notFound();

  // An optional lead must be this customer's; a foreign id is treated
  // as missing so the endpoint cannot confirm another customer's lead.
  let lead = null;
  if (req.body.lead) {
    lead = await RealEstateLead.findOne({ _id: req.body.lead, customer: customerId }).lean();
    if (!lead) notFound();
  }

  const request = await loanService.createRequestForCustomer({
    customer: customerId,
    property,
    lead: lead ? lead._id : null,
    requestedAmount: req.body.requestedAmount,
    tenureMonths: req.body.tenureMonths || null,
    employment: req.body.employment || null,
    monthlyIncome: req.body.monthlyIncome ?? null,
  });
  res.status(httpStatus.CREATED).send({ data: request });
});

/**
 * GET /customer/loans — this customer's loan requests with their
 * applications and offers nested (the compare screen reads one call).
 */
const listMyLoans = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const { page, limit } = req.query;
  const result = await loanService.listForCustomer(customerId, { page, limit });
  res.send(result);
});

/**
 * GET /customer/loans/:id — one request, nested applications + offers.
 */
const getMyLoan = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const request = await loanService.findForCustomer(req.params.id, customerId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Loan request not found');
  res.send({ data: request });
});

/**
 * POST /customer/loans/:id/offers/:offerId/accept — choose one bank.
 * The service proves the request belongs to this customer, closes the
 * losing offers/applications, and advances the winner to
 * DOCUMENTS_PENDING so the bank portal can start underwriting.
 */
const acceptLoanOffer = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const request = await loanService.acceptOffer({
    requestId: req.params.id,
    offerId: req.params.offerId,
    customerId,
  });
  res.send({ data: request });
});

/**
 * GET /customer/purchases �?" this customer's completed/cancelled sales.
 * Newest first; the tenant is always `req.user.id`.
 */
const listMyPurchases = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const { page, limit } = req.query;
  const result = await saleService.listForCustomer(customerId, { page, limit });
  res.send(result);
});

/**
 * GET /customer/purchases/:id �?" one purchase. A sale belonging to
 * another customer is treated as missing, so the id cannot be probed.
 */
const getMyPurchase = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const sale = await saleService.findByIdForCustomer(req.params.id, customerId);
  if (!sale) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
  res.send({ data: sale });
});

/**
 * GET /customer/document-requests
 *
 * What the banks have asked this customer for, newest first. Every row
 * is this customer's own - the customer id comes from the token, so
 * there is no way to ask for another customer's paperwork.
 */
const listMyDocumentRequests = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const results = await documentRequestService.listForCustomer(customerId);
  res.send({ results });
});

/**
 * POST /customer/document-requests/:id/submit
 *
 * The customer answers a request with an uploaded file. `fileUrl` is the
 * url the shared media upload already returned - the customer app
 * uploads first, then answers, exactly like the vendor document flow.
 */
const submitMyDocumentRequest = catchAsync(async (req, res) => {
  const customerId = requireCustomer(req);
  const request = await documentRequestService.submitByCustomer({
    requestId: req.params.id,
    customerId,
    fileUrl: req.body.fileUrl,
    fileName: req.body.fileName || '',
    mimeType: req.body.mimeType || '',
    sizeBytes: req.body.sizeBytes,
  });
  res.send({ data: request.toObject({ getters: true }) });
});

module.exports = {
  createEnquiry,
  listMyLeads,
  getMyLead,
  withdrawEnquiry,
  getMyLeadActivity,
  savePropertyFavourite,
  removePropertyFavourite,
  isPropertyFavourited,
  listMySavedProperties,
  createVisitRequest,
  listMyVisits,
  getMyVisit,
  createLoanRequest,
  listMyLoans,
  getMyLoan,
  acceptLoanOffer,
  listMyPurchases,
  getMyPurchase,
  listMyDocumentRequests,
  submitMyDocumentRequest,
};