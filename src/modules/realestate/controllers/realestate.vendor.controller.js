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
const vendorService = require('../services/realestate.vendor.service');
const packageService = require('../services/realestate.listing.package.service');
const orderService = require('../services/realestate.listing.order.service');
const listingOrderPaymentService = require('../services/realestate.listing.order.payment.service');
const entitlementService = require('../services/realestate.listing.entitlement.service');
const propertyService = require('../services/realestate.property.service');
const documentService = require('../services/realestate.document.service');
const leadService = require('../services/realestate.lead.service');
const visitService = require('../services/realestate.visit.service');
const holdService = require('../services/realestate.hold.service');
const commissionService = require('../services/realestate.commission.service');
const saleService = require('../services/realestate.sale.service');
const RealEstateProperty = require('../models/realestate.property.model');
const RealEstateLead = require('../models/realestate.lead.model');
const RealEstateVisit = require('../models/realestate.visit.model');
const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
const RealEstateSale = require('../models/realestate.sale.model');

/**
 * Vendor-facing Real Estate endpoints.
 *
 * ## Why the vendor id never comes from the path
 *
 * Doc §7.1: "Vendor: `vendorAuth` resolves from token. **No vendor id in any path.**"
 * A vendor id in a URL is a client-controlled value, so `/vendor/:vendorId/dashboard`
 * is an IDOR waiting to happen — swapping one path segment reads a competitor's
 * pipeline. Every handler below therefore takes the id from `req.actorId`, which
 * `realestate.tenant.js` set from the verified token.
 *
 * ## Why these are thin
 *
 * The state machines live in the service. The controller's only jobs are: resolve the
 * caller, validate that they exist, call the service, and translate a thrown error into
 * a status code. Repeating the transitions here would be the second copy that drifts.
 */

/**
 * Reject the request unless the token resolved to a vendor.
 *
 * The tenant middleware deliberately does not 401 — it falls through to `guest` so that
 * public browsing works without a token. That is right for `/realestate/public/*` and
 * wrong here, so this is where the 401 belongs.
 *
 * @param {object} req
 * @returns {string} the authenticated vendor id
 * @throws {ApiError} 401
 */
const requireVendor = (req) => {
  if (req.actorType !== 'vendor' || !req.actorId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'A vendor access token is required');
  }
  return req.actorId;
};

/**
 * Resolve the acting vendor from the token, 404 if the document is gone.
 *
 * A token can outlive its vendor: an admin suspends and deletes the vendor, and the
 * executive's phone still holds a valid JWT. Returning 404 rather than acting on a
 * dangling id keeps that case from writing rows against nothing.
 *
 * NOT wrapped in `catchAsync` — it is an await-able helper called from inside handlers
 * that are already wrapped, so it must return a promise rather than being a middleware.
 *
 * @param {object} req
 * @returns {Promise<object>}
 * @throws {ApiError} 401/404
 */
const resolveVendor = async (req) => {
  requireVendor(req);
  // findByUser takes the **User** id, so req.userId — not req.actorId, which is the
  // vendor document id. Swapping them returns null rather than throwing.
  const vendor = await vendorService.findByUser(req.userId);
  if (!vendor) throw new ApiError(httpStatus.NOT_FOUND, 'Vendor not found');
  return vendor;
};

// ------------------------------------------------------------------- vendor self

/**
 * POST /vendor/register
 * Register a vendor account against the authenticated user.
 *
 * This is the one handler that must NOT call `requireVendor`. Registration is how a
 * vendor row comes into existence, so demanding an existing vendor row is circular —
 * it would reject every first-time applicant. It authenticates as a signed-in *user*
 * instead, and the vendor row is created for them.
 */
const register = catchAsync(async (req, res) => {
  if (!req.userId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in before registering as a vendor');
  }
  const vendor = await vendorService.registerVendor(req.body, req.userId);
  res.status(httpStatus.CREATED).send({ data: vendor });
});

/**
 * GET /vendor/me
 * The authenticated vendor's own document.
 */
const me = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  res.send({ data: vendor });
});

/**
 * POST /vendor/submit-for-review
 * Move the vendor's own KYC from pending into review.
 */
const submitForReview = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const updated = await vendorService.submitForReview(vendor._id, req.user?.id);
  res.send({ data: updated });
});

/**
 * GET /vendor/dashboard
 * Counters and publish eligibility for the authenticated vendor.
 */
const dashboard = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const data = await vendorService.getVendorDashboard(vendor._id);
  res.send({ data });
});

// ------------------------------------------------------------------ packages/orders

/**
 * These exist so BR-02 and BR-05 have a reachable path. Before them a vendor could not buy
 * a package through any request, so could not hold an entitlement, so could not submit a
 * listing — the entitlement rule was only ever exercised by tests calling services
 * directly.
 */

/**
 * GET /vendor/packages
 * The purchase catalogue. Inactive packages are hidden.
 */
const listPackages = catchAsync(async (req, res) => {
  const packages = await packageService.listAll({ status: true });
  res.send({ results: packages });
});

/**
 * GET /vendor/packages/:code
 */
const getPackage = catchAsync(async (req, res) => {
  const pkg = await packageService.getPackageDetails(req.params.code);
  if (!pkg) throw new ApiError(httpStatus.NOT_FOUND, 'Package not found');
  res.send({ data: pkg });
});

/**
 * POST /vendor/packages/:code/purchase
 * Create an order in PENDING_PAYMENT.
 *
 * Returns 201 with the order; it grants nothing yet. The entitlement appears when payment
 * confirms — see `orderService.markPaid` for why that is a separate step.
 */
const purchasePackage = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const order = await orderService.createOrder(vendor._id, req.params.code);
  res.status(httpStatus.CREATED).send({ data: order });
});

/**
 * GET /vendor/orders
 */
const listOrders = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page, limit } = req.query;
  const orders = await orderService.findForVendor(vendor._id);
  const start = (page - 1) * limit;
  res.send({ results: orders.slice(start, start + limit), page, limit, total: orders.length });
});

/**
 * GET /vendor/orders/:id
 * Scoped to the vendor, so one vendor cannot read another's purchase history.
 */
const getOrder = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const order = await orderService.findForVendorById(req.params.id, vendor._id);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  res.send({ data: order });
});

/**
 * POST /vendor/orders/:id/cancel
 *
 * A vendor may abandon a purchase they have not paid for. Paid orders are refused here —
 * a refund is a different operation, and BR-02 keeps package money separate from
 * commission money.
 */
const cancelOrder = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const owned = await orderService.findForVendorById(req.params.id, vendor._id);
  if (!owned) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  const order = await orderService.markUnpaid(owned._id, 'CANCELLED');
  res.send({ data: order });
});

/**
 * POST /vendor/orders/:id/pay
 *
 * Starts the gateway payment for a PENDING_PAYMENT order and returns the
 * initiation id as `payLink`. The app opens it through the shared
 * `v1/public/payments/makePayment/:id` flow; confirmation reaches
 * `markPaid` via the `listing_package` callback branch.
 */
const payOrder = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { order, initiation } = await listingOrderPaymentService.initiateOrderPayment({
    orderId: req.params.id,
    vendorId: vendor._id,
    userId: req.userId,
    paymentConfigId: req.body?.payment || null,
  });
  res.status(httpStatus.CREATED).send({ data: order, payLink: String(initiation._id) });
});

/**
 * GET /vendor/entitlements
 * What the vendor has bought and how much of it is left.
 */
const listEntitlements = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const entitlements = await entitlementService.findActiveForVendor(vendor._id);
  res.send({ results: entitlements });
});

// --------------------------------------------------------------------- properties

/**
 * The vendor's own CRUD on listings. The 27 missing routes the plan
 * called out collapse to 8 here: create, list, get, update, submit,
 * withdraw, archive, plus a generic status transition. Each is a
 * thin wrapper around the property service; the service is the one
 * place transitions are decided, so a vendor cannot bypass a guard
 * by routing a request through a different path.
 *
 * All reads are scoped to `req.actorId` — a vendor id in a URL would
 * be an IDOR (doc §7.1).
 */

const createProperty = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  // VENDOR-sourced properties get the actor's vendor id; a future
  // LOCALWALA_DIRECT path goes through the admin controller.
  const property = await propertyService.create(
    { ...req.body, source: 'VENDOR', vendor: vendor._id },
    { _id: req.userId, actorType: 'vendor' }
  );
  res.status(httpStatus.CREATED).send({ data: property });
});

const listMyProperties = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page, limit, status } = req.query;
  const result = await propertyService.listForVendor(vendor._id, { page, limit, status });
  res.send(result);
});

const getMyProperty = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const property = await propertyService.findByIdForVendor(req.params.id, vendor._id);
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  res.send({ data: property });
});

const updateMyProperty = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const property = await propertyService.findByIdForVendor(req.params.id, vendor._id);
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  // The service is the one place that decides which fields are
  // editable in which state. The vendor can never widen that surface
  // by going through a different route.
  const updated = await propertyService.update(
    req.params.id,
    req.body,
    { _id: req.userId, actorType: 'vendor' }
  );
  res.send({ data: updated });
});

/**
 * POST /vendor/properties/:id/submit — DRAFT → SUBMITTED.
 * Consumes one entitlement (BR-02/BR-05). The service is the one
 * place that decides whether an entitlement is needed, so a vendor
 * cannot reach PUBLISHED without going through this.
 */
const submitMyProperty = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const property = await propertyService.findByIdForVendor(req.params.id, vendor._id);
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  const updated = await propertyService.changeStatus(
    req.params.id,
    'SUBMITTED',
    { _id: req.userId, actorType: 'vendor' }
  );
  res.send({ data: updated });
});

/**
 * POST /vendor/properties/:id/withdraw — pull a listing that has not
 * been approved yet. BR-05: below SUBMITTED the entitlement is
 * restored. At or beyond SUBMITTED the vendor cannot withdraw —
 * the admin owns the decision and the entitlement is spent.
 */
const withdrawMyProperty = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const property = await propertyService.findByIdForVendor(req.params.id, vendor._id);
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  // Withdrawal is recorded as a state transition so the audit log
  // catches it (BR-20). ARCHIVED is the only post-publish state
  // reachable by a vendor without admin action.
  const updated = await propertyService.changeStatus(
    req.params.id,
    'ARCHIVED',
    { _id: req.userId, actorType: 'vendor' }
  );
  res.send({ data: updated });
});

/**
 * POST /vendor/properties/:id/status/:status — generic transition
 * for the states a vendor may target. The Joi schema at the route
 * is the first copy of the allow-list; `STATUS_ACTORS` is the second.
 * A vendor cannot set `APPROVED`, `PUBLISHED`, `REJECTED`,
 * `SUSPENDED`, `EXPIRED`, `SOLD`, `RENTED` — those are admin-only.
 */
const changeMyPropertyStatus = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const property = await propertyService.findByIdForVendor(req.params.id, vendor._id);
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  const updated = await propertyService.changeStatus(
    req.params.id,
    req.params.status,
    { _id: req.userId, actorType: 'vendor' },
    { reason: req.body?.reason }
  );
  res.send({ data: updated });
});

// ------------------------------------------------------------------- documents

/**
 * Vendor document CRUD on their own property listings. Without this,
 * a vendor's property cannot reach APPROVED — the verification
 * checklist needs OWNERSHIP, APPROVAL, etc. attached.
 *
 * The four endpoints:
 *   POST   /properties/:id/documents          — upload metadata
 *   GET    /properties/:id/documents          — list
 *   GET    /properties/:id/documents/:documentId — one
 *   DELETE /properties/:id/documents/:documentId — remove (PENDING only)
 *
 * ACCEPTED documents cannot be removed (BR-21). The service throws a
 * `DOCUMENT_ACCEPTED` error; the controller maps that to 409.
 */

const uploadPropertyDocument = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  try {
    const doc = await documentService.upload({
      propertyId: req.params.id,
      vendorId: vendor._id,
      userId: req.userId,
      ...req.body,
    });
    res.status(httpStatus.CREATED).send({ data: doc });
  } catch (e) {
    if (e.code === 'PROPERTY_NOT_FOUND') {
      throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
    }
    if (
      [
        'DOCUMENT_SIZE_REQUIRED',
        'DOCUMENT_SIZE_INVALID',
        'DOCUMENT_TOO_LARGE',
        'DOCUMENT_MIME_TYPE_REQUIRED',
        'DOCUMENT_MIME_TYPE_NOT_ALLOWED',
      ].includes(e.code)
    ) {
      throw new ApiError(httpStatus.BAD_REQUEST, e.message);
    }
    throw e;
  }
});

const listPropertyDocuments = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const docs = await documentService.listForProperty(req.params.id, vendor._id);
  if (docs === null) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  res.send({ results: docs });
});

const getPropertyDocument = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const doc = await documentService.findByIdForVendor(req.params.documentId, vendor._id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  res.send({ data: doc });
});

const deletePropertyDocument = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  try {
    const result = await documentService.removeForVendor(req.params.documentId, vendor._id);
    if (result === null) throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
    res.status(httpStatus.NO_CONTENT).send();
  } catch (e) {
    if (e.code === 'DOCUMENT_ACCEPTED') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'An accepted document cannot be removed. Upload a replacement instead.'
      );
    }
    throw e;
  }
});

// --------------------------------------------------------------------- leads
//
// Vendor's read-only view of leads on their own listings. The lead
// model carries a denormalised `vendor` field (see model class doc),
// so the filter is direct and the index is already on `vendor`.
// A `getLeadById` path that 404s for cross-vendor reads keeps the
// endpoint from being an IDOR.

const listMyLeads = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page, limit, status } = req.query;
  const leads = await leadService.findLeads({ vendor: vendor._id, status });
  const start = (page - 1) * limit;
  res.send({
    results: leads.slice(start, start + limit),
    page,
    limit,
    total: leads.length,
  });
});

const getMyLead = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const detail = await leadService.getLeadDetail(req.params.id);
  if (!detail || String(detail.vendor) !== String(vendor._id)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found');
  }
  res.send({ data: detail });
});

// --------------------------------------------------------------------- visits

const listMyVisits = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page, limit, status } = req.query;
  const visits = await visitService.findVisits({ vendor: vendor._id, status });
  const start = (page - 1) * limit;
  res.send({
    results: visits.slice(start, start + limit),
    page,
    limit,
    total: visits.length,
  });
});

const getMyVisit = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const visit = await RealEstateVisit.findById(req.params.id).lean();
  if (!visit) throw new ApiError(httpStatus.NOT_FOUND, 'Visit not found');
  // Confirm the visit's property belongs to this vendor.
  const property = await RealEstateProperty.findOne({
    _id: visit.property,
    vendor: vendor._id,
  }).select('_id').lean();
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Visit not found');
  // Ownership confirmed — re-read populated for the detail screen.
  // Only non-money fields are selected, so lean stays paise-free.
  const full = await RealEstateVisit.findById(req.params.id)
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title addressLine mapAddress location')
    .populate('lead', 'leadCode status')
    .lean();
  res.send({ data: full });
});

// --------------------------------------------------------------------- holds
//
// Holds the vendor needs to see: which of their listings is currently
// on hold by a customer. The `findForVendor` service method handles the
// property-list subquery.

const listMyHolds = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page, limit, status } = req.query;
  const result = await holdService.listForVendor(vendor._id, { page, limit, status });
  res.send(result);
});

// ----------------------------------------------------------------- customers
//
// The "customers" view is a distinct-union of two collections:
//   - leads.vendor == vendorId  (every customer who ever enquired)
//   - visits.property in vendorProperties  (every customer who attended a visit)
// A vendor typically wants to see this list paginated.
//
// We run two queries, then deduplicate in memory. For a vendor with
// thousands of leads and visits, that is fine — the dedup is O(n) on
// ids. The two queries are indexed (lead.vendor, visit.property),
// so neither is a table scan.

const listMyCustomers = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page = 1, limit = 20 } = req.query;

  const propertyIds = await RealEstateProperty.find({ vendor: vendor._id })
    .select('_id')
    .lean();
  const ids = propertyIds.map((p) => String(p._id));

  const [leadCustomers, visitCustomers] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : RealEstateLead.distinct('customer', { vendor: vendor._id }),
    ids.length === 0
      ? Promise.resolve([])
      : RealEstateVisit.distinct('customer', { property: { $in: ids } }),
  ]);

  // Dedup while preserving first-seen order so the most recent
  // customer (a freshly imported lead) is at the top of the page.
  const seen = new Set();
  const merged = [];
  for (const id of [...leadCustomers, ...visitCustomers]) {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(id);
    }
  }

  // Hydrate the page to contact rows. Raw user ids are useless to a UI —
  // the vendor needs names and phone numbers to follow up — so the page
  // slice is resolved to `{ id, firstName, lastName, mobile }`. Order is
  // the dedup order above, not the database's.
  const start = (page - 1) * limit;
  const pageIds = merged.slice(start, start + limit);
  const User = require('../../../models/user.model');
  const users = await User.find({ _id: { $in: pageIds } })
    .select('firstName lastName mobile')
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const results = pageIds.map((id) => {
    const u = byId.get(String(id));
    return u
      ? { id: u._id, firstName: u.firstName, lastName: u.lastName, mobile: u.mobile }
      : { id };
  });
  res.send({
    results,
    page,
    limit,
    total: merged.length,
  });
});

// -------------------------------------------------------- analytics + money
//
// BR-02: the listing package and the sale commission are separate
// financial events. A vendor's "earnings" view is the sales
// commission only, never summed with package spend. The
// `listMyCommissions` route respects that — it never reaches into
// the listing-order table.

/**
 * Counters for the vendor dashboard.
 *
 * All counts are over the vendor's own data: properties, leads,
 * visits, holds, sales. The "live" hold count is the one that
 * matters to operations — it is the principal currently held in
 * trust against the vendor's listings.
 */
const getMyAnalytics = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const propertyFilter = { vendor: vendor._id };
  const propertyIds = await RealEstateProperty.find(propertyFilter)
    .select('_id')
    .lean();
  const ids = propertyIds.map((p) => p._id);

  const [properties, leads, visits, holds, sales] = await Promise.all([
    RealEstateProperty.countDocuments(propertyFilter),
    RealEstateLead.countDocuments({ vendor: vendor._id }),
    ids.length === 0
      ? 0
      : RealEstateVisit.countDocuments({ property: { $in: ids } }),
    ids.length === 0
      ? 0
      : RealEstatePropertyHold.countDocuments({ property: { $in: ids } }),
    RealEstateSale.countDocuments({ vendor: vendor._id }),
  ]);

  // Live holds = PENDING_PAYMENT or ACTIVE. The other states are
  // terminal or in-flight but the property is back on-market.
  const liveHoldFilter = ids.length === 0
    ? { _id: null }
    : { property: { $in: ids }, status: { $in: ['PENDING_PAYMENT', 'ACTIVE'] } };
  const liveHolds = ids.length === 0
    ? 0
    : await RealEstatePropertyHold.countDocuments(liveHoldFilter);

  res.send({
    data: {
      properties,
      leads,
      visits,
      holds,
      liveHolds,
      sales,
    },
  });
});

const listMyCommissions = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page, limit, status } = req.query;
  const result = await commissionService.listForVendor(vendor._id, { page, limit, status });
  res.send(result);
});

const listMySales = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const { page, limit } = req.query;
  const result = await saleService.listForVendor(vendor._id, { page, limit });
  res.send(result);
});

const getMySale = catchAsync(async (req, res) => {
  const vendor = await resolveVendor(req);
  const sale = await saleService.findByIdForVendor(req.params.id, vendor._id);
  if (!sale) throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  res.send({ data: sale });
});

// --------------------------------------------------------------------- admin side

/**
 * These take the vendor id from the path because the caller is an admin acting on a
 * *specific* vendor — that is the one case where naming the target in the URL is the
 * point. They are mounted on the admin route file behind `webAuth(<right>)`, not here,
 * because a rights string on the vendor file would hand admin powers to every vendor
 * who can reach it.
 */

/**
 * GET /admin/vendors/active
 * Every vendor currently able to list.
 */
const listActive = catchAsync(async (req, res) => {
  const vendors = await vendorService.findActiveVendors();
  res.send({ results: vendors });
});

/**
 * POST /admin/vendors/:vendorId/approve
 */
const approve = catchAsync(async (req, res) => {
  const updated = await vendorService.approveVendor(req.params.vendorId, req.user?.id);
  res.send({ data: updated });
});

/**
 * POST /admin/vendors/:vendorId/reject
 */
const reject = catchAsync(async (req, res) => {
  const updated = await vendorService.rejectVendor(
    req.params.vendorId,
    req.user?.id,
    req.body?.reason
  );
  res.send({ data: updated });
});

/**
 * POST /admin/vendors/:vendorId/suspend
 */
const suspend = catchAsync(async (req, res) => {
  const updated = await vendorService.suspendVendor(
    req.params.vendorId,
    req.user?.id,
    req.body?.reason
  );
  res.send({ data: updated });
});

/**
 * PUT /admin/vendors/:vendorId/documents/:category/verify
 */
const verifyDocument = catchAsync(async (req, res) => {
  const updated = await vendorService.verifyDocument(
    req.params.vendorId,
    req.params.category
  );
  res.send({ data: updated });
});

const VERIFICATION_QUEUE_STATUSES = ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUIRED'];

/**
 * GET /admin/vendors/verification-queue — vendors awaiting KYC decision
 * (plan §10.2 row 8). Defaults to the three actionable statuses;
 * `?verificationStatus=` overrides with a single allow-listed value.
 * Paginated, oldest-submitted first so the longest-waiting vendor is on top.
 */
const listVerificationQueue = catchAsync(async (req, res) => {
  const RealEstateVendor = require('../models/realestate.vendor.model');
  let statuses = VERIFICATION_QUEUE_STATUSES;
  if (req.query.verificationStatus) {
    const all = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUIRED'];
    if (!all.includes(req.query.verificationStatus)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown verificationStatus: ${req.query.verificationStatus}`);
    }
    statuses = [req.query.verificationStatus];
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
  const result = await RealEstateVendor.paginate(
    { verificationStatus: { $in: statuses } },
    { page, limit, sort: { submittedAt: 1, createdAt: 1 } }
  );
  res.send(result);
});

/**
 * GET /admin/vendors/:vendorId/documents — KYC paperwork for the queue row.
 */
const listVendorDocuments = catchAsync(async (req, res) => {
  const RealEstateVendorDocument = require('../models/realestate.vendor.document.model');
  const docs = await RealEstateVendorDocument.find({ vendor: req.params.vendorId }).sort({ category: 1 }).lean();
  res.send({ results: docs });
});

module.exports = {
  register,
  me,
  submitForReview,
  dashboard,
  listPackages,
  getPackage,
  purchasePackage,
  listOrders,
  getOrder,
  cancelOrder,
  payOrder,
  listEntitlements,
  listActive,
  approve,
  reject,
  suspend,
  verifyDocument,
  listVerificationQueue,
  listVendorDocuments,
  requireVendor,

  // Vendor property CRUD — the surface that lets a vendor actually
  // list, edit, submit, and withdraw their properties. Plan §7.2 had
  // 38 vendor routes; this adds 17 of the missing 27.
  createProperty,
  listMyProperties,
  getMyProperty,
  updateMyProperty,
  submitMyProperty,
  withdrawMyProperty,
  changeMyPropertyStatus,

  // Vendor document CRUD — the surface that lets the verification
  // checklist receive the paperwork it needs to mark a property
  // APPROVED. 4 routes.
  uploadPropertyDocument,
  listPropertyDocuments,
  getPropertyDocument,
  deletePropertyDocument,

  // Vendor read-only views — leads, visits, holds, customers on the
  // vendor's own listings. 6 routes.
  listMyLeads,
  getMyLead,
  listMyVisits,
  getMyVisit,
  listMyHolds,
  listMyCustomers,

  // Vendor analytics + money — counters and commission/sale listings.
  // BR-02: commissions here are sales commissions only. Package
  // spend lives on /vendor/orders and is never summed with these. 4 routes.
  getMyAnalytics,
  listMyCommissions,
  listMySales,
  getMySale,
};