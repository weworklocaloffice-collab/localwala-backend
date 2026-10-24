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

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const {
  StoreOutlet,
  StoreChain,
  StoreRoleAssignment,
  StorePolicy,
  StoreFeaturedPlacement,
  TaxConfiguration,
  User,
} = require('../../../models');
const onboardingService = require('../services/stores.onboarding.service');
const staffService = require('../services/stores.staff.service');
const lifecycleService = require('../services/stores.lifecycle.service');
const profileService = require('../services/stores.profile.service');

/**
 * Partner and Admin controllers for the chain / outlet / staff surface.
 *
 * THIN BY CONVENTION. Each handler destructures, calls ONE service, and sends
 * `pick(result, [...])`.
 *
 * ## Why the outlet is never read from the params
 *
 * Every outlet-scoped handler uses `req.outletId`, which `stores.tenant.js` resolved
 * from the access token and the session and validated against the actor's scope. A
 * route path carries no outlet id at all, so there is nothing left for a client to
 * tamper with. Spreading `...req.query` and THEN overriding `outlet` is deliberate: it
 * means a `?outlet=` parameter cannot widen a list.
 */

// ---------------------------------------------------------------------------
// onboarding — the applicant's own application
// ---------------------------------------------------------------------------

const getMyApplication = catchAsync(async (req, res) => {
  const draft = await onboardingService.getOrCreateDraft(req.user._id);
  res.send(pick(draft, [
    '_id', 'status', 'currentStep', 'completedSteps', 'incompleteSteps',
    'businessInfo', 'storeInfo', 'ownerInfo', 'location', 'documents',
    'deliveryConfig', 'outletCount', 'changesRequested', 'rejectionReason',
    'submittedAt', 'reviewedAt',
  ]));
});

const saveApplication = catchAsync(async (req, res) => {
  const draft = await onboardingService.saveDraft(req.user._id, req.body);
  res.send(pick(draft, ['_id', 'status', 'currentStep', 'completedSteps', 'incompleteSteps']));
});

const submitApplication = catchAsync(async (req, res) => {
  const draft = await onboardingService.submit(req.user._id, req.user);
  res.send(pick(draft, ['_id', 'status', 'submittedAt']));
});

// ---------------------------------------------------------------------------
// session and scope — the outlet switcher
// ---------------------------------------------------------------------------

/**
 * Everything this actor may act on, grouped by chain. Drives the outlet switcher.
 *
 * Reads the middleware's resolved scope rather than re-querying: `storeScope` has
 * already computed the permitted set and the active outlet, and a second resolution
 * could disagree with the one the request was authorised under.
 */
const myScope = catchAsync(async (req, res) => {
  res.send({
    groups: req.scopeGroups || [],
    permittedOutletIds: req.permittedOutletIds || [],
    activeOutletId: req.outletId || null,
    activeChainId: req.chainId || null,
    role: req.role,
    isDriver: !!req.isStoreDriver,
  });
});

const myOutlets = catchAsync(async (req, res) => {
  const permitted = req.permittedOutletIds || [];

  // Empty permitted set means NO access, never "all". Handled by the middleware
  // already, but an explicit empty response is cheaper than a query.
  if (!permitted.length) {
    return res.send({ outlets: [] });
  }

  const outlets = await StoreOutlet.find({ _id: { $in: permitted } })
    .select('name slug outletCode logo cover status operational chain address location')
    .sort({ name: 1 })
    .lean();

  return res.send({ outlets, activeOutletId: req.outletId || null });
});

/**
 * Switch the active outlet.
 *
 * This persists the choice to `StoreRoleAssignment.lastActiveOutletId`, which is what
 * `resolveActorOutlet` falls back to when no `X-Store-Outlet` header is sent. There is
 * no session on this platform, so the database is where "which outlet am I in" lives —
 * and a value in the database cannot be forged.
 *
 * The outlet must be in `req.permittedOutletIds`, which `storeScope` has already
 * computed. Validation alone cannot enforce scope; the middleware does.
 */
const switchOutlet = catchAsync(async (req, res) => {
  const permitted = req.permittedOutletIds || [];
  const outletId = String(req.body.outlet);

  if (!permitted.includes(outletId)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUT_OF_SCOPE: this account may not act on that outlet',
      true,
      '',
      { permitted, requested: outletId }
    );
  }

  // Persisted through the MODEL, not through the request's assignment object.
  // `req.assignment` is a lean plain object with no query methods, so calling
  // `.updateOne()` on it throws "updateOne is not a function" and the switch
  // silently never happened.
  if (req.assignment) {
    await StoreRoleAssignment.updateOne(
      { _id: req.assignment._id, user: req.user._id },
      { $set: { lastActiveOutletId: outletId, lastActiveAt: new Date() } }
    );
  }

  const result = await profileService.resolveActorOutlet(req.user._id, outletId);
  return res.send(pick({
    outlet: { _id: result.outlet._id, name: result.outlet.name, outletCode: result.outlet.outletCode },
    chain: { _id: result.chain._id, name: result.chain.name },
    role: result.role,
  }, ['outlet', 'chain', 'role']));
});

// ---------------------------------------------------------------------------
// outlet — partner view of their own
// ---------------------------------------------------------------------------

/**
 * One outlet's detail, as seen by this actor.
 *
 * The `:outlet` parameter is validated against `req.permittedOutletIds` here rather
 * than trusted. Under `storeScope` there is no pinned active outlet, so this handler
 * must do the scope check itself — which is why it re-checks instead of reading
 * `req.outlet`.
 */
const myOutletDetail = catchAsync(async (req, res) => {
  const requested = String(req.params.outlet);
  const permitted = req.permittedOutletIds || [];

  if (!permitted.includes(requested)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'OUT_OF_SCOPE: this account may not act on that outlet',
      true,
      '',
      { permitted, requested }
    );
  }

  const outlet = await StoreOutlet.findById(requested)
    .populate('chain')
    .lean();

  if (!outlet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  }

  return res.send(pick(outlet, [
    '_id', 'chain', 'outletCode', 'name', 'logo', 'cover', 'photos', 'description',
    'address', 'location', 'serviceLocalities', 'operatingHours', 'holidays',
    'deliveryConfig', 'taxIdentity', 'contact', 'status', 'operational', 'suspension',
  ]));
});

const myChainDetail = catchAsync(async (req, res) => {
  const chain = await StoreChain.findById(req.chainId);
  res.send(pick(chain, [
    '_id', 'name', 'slug', 'logo', 'cover', 'description', 'brand',
    'categories', 'subcategories', 'outlets', 'outletCount', 'status', 'rating',
  ]));
});

/**
 * The BR-32 capability row for this outlet, so the app can render the right banners
 * without duplicating the matrix in Dart.
 */
const myCapabilities = catchAsync(async (req, res) => {
  const state = await lifecycleService.subscriptionStateFor(req.outlet);
  const caps = lifecycleService.capabilitiesFor(state);
  res.send(pick({ subscriptionState: state, capabilities: caps }, ['subscriptionState', 'capabilities']));
});

/** Change this outlet's status. OWNER-ONLY for suspend/reactivate. */
const changeOutletStatus = catchAsync(async (req, res) => {
  if (['suspended', 'reactivated'].includes(req.params.status)) {
    profileService.assertCan(req.role, 'staff.grant_owner');
  }
  const outlet = await lifecycleService.changeOutletStatus({
    outlet: req.outlet,
    to: req.params.status,
    actor: req.user,
    actorRole: req.role,
    reason: req.body,
  });
  res.send(pick(outlet, ['_id', 'status', 'operational', 'suspension', 'statusChangedAt']));
});

// ---------------------------------------------------------------------------
// staff
// ---------------------------------------------------------------------------

const listStaff = catchAsync(async (req, res) => {
  const result = await staffService.listAssignments({
    chain: req.chainId,
    role: req.query.role,
    status: req.query.status,
    search: req.query.search,
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  });
  res.send(pick(result, ['assignments', 'total', 'page', 'limit', 'totalPages']));
});

const assignStaff = catchAsync(async (req, res) => {
  const assignment = await staffService.assignRole({
    user: req.body.user,
    business: req.chain ? req.chain.business : undefined,
    chain: req.chainId,
    role: req.body.role,
    scopeType: req.body.scopeType,
    outlets: req.body.outlets,
    isPrimary: req.body.isPrimary,
    notes: req.body.notes,
    actor: { userId: req.user._id, role: req.role },
  });
  res.send(pick(assignment, ['_id', 'user', 'role', 'scopeType', 'outlets', 'permissions', 'status']));
});

const updateStaff = catchAsync(async (req, res) => {
  const assignment = await staffService.updateAssignment({
    assignmentId: req.params.assignment,
    patch: req.body,
    actor: { userId: req.user._id, role: req.role },
  });
  res.send(pick(assignment, ['_id', 'user', 'role', 'scopeType', 'outlets', 'status', 'statusReason']));
});

/**
 * Deactivate, never delete (BR-25). A historical order must keep resolving the person
 * who handled it.
 */
const deactivateStaff = catchAsync(async (req, res) => {
  const assignment = await staffService.deactivateAssignment({
    assignmentId: req.params.assignment,
    reason: req.body && req.body.reason,
    actor: { userId: req.user._id, role: req.role },
  });
  res.send(pick(assignment, ['_id', 'status', 'statusReason', 'endedAt']));
});

const outletTeam = catchAsync(async (req, res) => {
  const team = await staffService.outletTeam(req.outletId);
  res.send({ team });
});

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

const listApplications = catchAsync(async (req, res) => {
  const status = req.query.status
    ? (Array.isArray(req.query.status) ? req.query.status : String(req.query.status).split(','))
    : undefined;
  const result = await onboardingService.listApplications({
    status,
    search: req.query.search,
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  });
  res.send(pick(result, ['applications', 'total', 'page', 'limit', 'totalPages']));
});

/**
 * ONE application for the review screen.
 *
 * This is what `GET /admin/stores/applications/:application` must call. It previously
 * called `listApplications`, so the review screen showed the first 20 applications in
 * the list rather than the one whose id was in the URL.
 */
const getApplication = catchAsync(async (req, res) => {
  const application = await onboardingService.getApplication(req.params.application);
  res.send(pick(application, [
    '_id', 'status', 'currentStep', 'completedSteps', 'incompleteSteps', 'stepLabel',
    'businessInfo', 'storeInfo', 'ownerInfo', 'location', 'hasLocation', 'hasLocationGeo',
    'documents', 'deliveryConfig', 'outletCount', 'changesRequested', 'rejectionReason',
    'submittedAt', 'reviewedAt', 'reviewedBy',
  ]));
});

const startReview = catchAsync(async (req, res) => {
  const draft = await onboardingService.startReview(req.params.application, req.user);
  res.send(pick(draft, ['_id', 'status', 'reviewedAt']));
});

const requestChanges = catchAsync(async (req, res) => {
  const draft = await onboardingService.requestChanges(
    req.params.application,
    { step: req.body.step, field: req.body.field, message: req.body.message },
    req.user
  );
  res.send(pick(draft, ['_id', 'status', 'changesRequested']));
});

const approveApplication = catchAsync(async (req, res) => {
  const result = await onboardingService.approveAndCommit(req.params.application, req.user);
  res.send(pick(result, ['draft', 'chain', 'outlet', 'assignment']));
});

const rejectApplication = catchAsync(async (req, res) => {
  const draft = await onboardingService.rejectApplication(req.params.application, req.body.reason, req.user);
  res.send(pick(draft, ['_id', 'status', 'rejectionReason']));
});

// ---------------------------------------------------------------------------
// admin — chains and tax configuration
// ---------------------------------------------------------------------------

/**
 * Every chain on the vertical, for the admin console.
 *
 * There is deliberately no per-chain tenant scope here: an admin is reviewing the
 * vertical AS A WHOLE, and a merchant from Delhi must appear next to one from Hyderabad.
 * The outlet-level role assignments that make a list scoped to one actor are the same
 * ones an admin does not hold.
 *
 * `status` is the PUBLIC chain status, never the subscription state. A chain whose
 * subscription lapsed is still a chain, just a suspended one, and this list is where an
 * admin finds it.
 */
const adminListChains = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.business) filter.business = req.query.business;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.featured !== undefined) filter.featured = req.query.featured === 'true' || req.query.featured === true;
  if (req.query.verified !== undefined) filter.verified = req.query.verified === 'true' || req.query.verified === true;

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const [items, total] = await Promise.all([
    StoreChain.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('business', 'name businessType')
      .lean(),
    StoreChain.countDocuments(filter),
  ]);

  res.send({
    chains: items.map((c) => ({
      ...c,
      businessName: c.business ? c.business.name : null,
      businessType: c.business ? c.business.businessType : undefined,
      outletCount: c.outletCount !== undefined ? c.outletCount : (c.outlets || []).length,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
});

const adminChainDetail = catchAsync(async (req, res) => {
  const chain = await StoreChain.findById(req.params.chain)
    .populate('business', 'name businessType')
    .lean();

  if (!chain) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Chain not found');
  }

  res.send(pick(chain, [
    '_id', 'name', 'slug', 'logo', 'cover', 'description', 'brand',
    'categories', 'subcategories', 'outlets', 'outletCount', 'status',
    'rating', 'ratingCount', 'isOrganicCertified', 'featured', 'verified',
    'maxRadiusKm', 'business', 'catalogueScope', 'createdAt', 'updatedAt',
    'statusChangedAt',
  ]));
});

/**
 * Settlement policy is the ONE chain setting an admin writes directly.
 *
 * Cadence and T+days decide when the cron creates a payout period for every outlet of
 * the chain, so leaving them DB-only made the feature unreachable. Defaults match the
 * cron: daily, T+2.
 */
const settlementConfigOf = (chain) => {
  const settings = (chain && chain.settings) || {};
  const config = settings.settlementConfig || {};
  const cadence = ['daily', 'weekly', 'monthly'].includes(config.cadence)
    ? config.cadence
    : 'daily';
  const tPlusDays = Number.isInteger(config.tPlusDays) && config.tPlusDays >= 0
    ? config.tPlusDays
    : 2;
  return { cadence, tPlusDays };
};

const adminGetChainSettlementConfig = catchAsync(async (req, res) => {
  const chain = await StoreChain.findById(req.params.chain).select('name settings.settlementConfig').lean();
  if (!chain) throw new ApiError(httpStatus.NOT_FOUND, 'Chain not found');

  res.send({
    chain: chain._id,
    name: chain.name,
    settlementConfig: settlementConfigOf(chain),
  });
});

const adminUpdateChainSettlementConfig = catchAsync(async (req, res) => {
  const chain = await StoreChain.findById(req.params.chain).select('name settings');
  if (!chain) throw new ApiError(httpStatus.NOT_FOUND, 'Chain not found');

  const current = settlementConfigOf(chain.toObject());
  chain.settings = chain.settings || {};
  chain.settings.settlementConfig = {
    cadence: req.body.cadence !== undefined ? req.body.cadence : current.cadence,
    tPlusDays: req.body.tPlusDays !== undefined ? req.body.tPlusDays : current.tPlusDays,
  };
  await chain.save();

  res.send({
    chain: chain._id,
    name: chain.name,
    settlementConfig: settlementConfigOf(chain.toObject()),
  });
});

/**
 * Escape user input before it becomes a RegExp. An unescaped `(` or `[` in
 * the search box would otherwise throw inside `new RegExp` and 500 the list.
 */
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Admin outlet registry (read-only).
 *
 * Outlets are committed by the application-approval transaction, never created
 * by hand, so there is deliberately no POST/PATCH here. Envelope is
 * `{ items, total }` so the shared admin list base reads it directly.
 */
const adminListOutlets = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.chain) filter.chain = req.query.chain;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const q = escapeRegExp(req.query.search.trim());
    filter.$or = [{ name: new RegExp(q, 'i') }, { outletCode: new RegExp(q.toUpperCase(), 'i') }];
  }

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const [items, total] = await Promise.all([
    StoreOutlet.find(filter)
      .populate('chain', 'name slug')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreOutlet.countDocuments(filter),
  ]);

  res.send({ items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

/**
 * Admin staff registry (read-only).
 *
 * Role assignment is owned by the partner scope model: assigning or changing a
 * role must revalidate outlet scope server-side (BR-40), which is Phase-1
 * service work, not an admin inline edit. So this lists; it does not mutate.
 */
const adminListStaff = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.chain) filter.chain = req.query.chain;
  if (req.query.outlet) filter.outlets = req.query.outlet;
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    // Names live on User, not on the assignment — resolve first, then match.
    const users = await User.find({ name: new RegExp(escapeRegExp(req.query.search.trim()), 'i') })
      .select('_id')
      .lean();
    filter.user = { $in: users.map((u) => u._id) };
  }

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const [items, total] = await Promise.all([
    StoreRoleAssignment.find(filter)
      .populate('user', 'name mobile')
      .populate('chain', 'name slug')
      .populate('outlets', 'name outletCode')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreRoleAssignment.countDocuments(filter),
  ]);

  res.send({ items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

/**
 * Admin policy registry (read-only).
 *
 * Policies version: a new version supersedes rather than edits (the same
 * append-only discipline as tax, §6.24). Version creation with resolution
 * order (`lockedFields`) is Phase-13 service work; this lists.
 */
const adminListPolicies = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.chain) filter.chain = req.query.chain;
  if (req.query.outlet) filter.outlet = req.query.outlet;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status !== undefined) filter.isActive = req.query.status === 'true' || req.query.status === true;
  if (req.query.search) filter.title = new RegExp(escapeRegExp(req.query.search.trim()), 'i');

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const [items, total] = await Promise.all([
    StorePolicy.find(filter)
      .populate('chain', 'name slug')
      .populate('outlet', 'name outletCode')
      .sort({ chain: 1, type: 1, version: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StorePolicy.countDocuments(filter),
  ]);

  res.send({ items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

/**
 * Admin featured-placement registry (read-only).
 *
 * Placement billing + approval is Phase-12 service work (OD-11: separate
 * one-off invoice flow). This lists placements with their billing lifecycle.
 */
const adminListFeatured = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.chain) filter.chain = req.query.chain;
  if (req.query.outlet) filter.outlet = req.query.outlet;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) filter.slot = new RegExp(escapeRegExp(req.query.search.trim()), 'i');

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const [items, total] = await Promise.all([
    StoreFeaturedPlacement.find(filter)
      .populate('chain', 'name slug')
      .populate('outlet', 'name outletCode')
      .sort({ startsAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreFeaturedPlacement.countDocuments(filter),
  ]);

  res.send({ items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 });
});

/**
 * The effective-dated GST rate table, for the admin console.
 *
 * Resolve-by-date is the half that actually enforces BR-41: an invoice dated the day
 * before a rate change must NOT inherit the new rate, and this endpoint is the one place
 * an admin can see that the right rate is in force for a given date rather than trusting
 * the latest row blindly.
 */
const adminListTaxConfigs = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.code) filter.code = String(req.query.code).toUpperCase();
  if (req.query.status !== undefined) filter.status = req.query.status === 'true' || req.query.status === true;

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const query = TaxConfiguration.find(filter).sort({ code: 1, effectiveFrom: -1 });

  const [items, total] = await Promise.all([
    query.skip((page - 1) * limit).limit(limit).lean(),
    TaxConfiguration.countDocuments(filter),
  ]);

  res.send({
    taxConfigurations: items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
});

const adminResolveTaxRate = catchAsync(async (req, res) => {
  if (!req.query.code) {
    throw new ApiError(httpStatus.BAD_REQUEST, '"code" is required');
  }

  const atDate = req.query.atDate ? new Date(req.query.atDate) : new Date();

  // resolveRate throws, by design: the rate is either in force or it does not exist, and
  // an absent rate must never collapse into a silent 0% GST. Mapped to a clear 404 here
  // rather than leaking an unstructured Error into the admin console.
  let rate;
  try {
    rate = await TaxConfiguration.resolveRate(req.query.code, atDate);
  } catch (error) {
    if (String(error.message).startsWith('TAX_CONFIG_')) {
      throw new ApiError(httpStatus.NOT_FOUND, error.message);
    }
    throw error;
  }

  res.send(pick(rate, ['_id', 'code', 'description', 'gstRate', 'effectiveFrom', 'effectiveTo', 'isDefault', 'status']));
});

module.exports = {
  getMyApplication,
  saveApplication,
  submitApplication,
  myScope,
  myOutlets,
  switchOutlet,
  myOutletDetail,
  myChainDetail,
  myCapabilities,
  changeOutletStatus,
  listStaff,
  assignStaff,
  updateStaff,
  deactivateStaff,
  outletTeam,
  listApplications,
  getApplication,
  startReview,
  requestChanges,
  approveApplication,
  rejectApplication,
  adminListChains,
  adminChainDetail,
  adminGetChainSettlementConfig,
  adminUpdateChainSettlementConfig,
  adminListOutlets,
  adminListStaff,
  adminListPolicies,
  adminListFeatured,
  adminListTaxConfigs,
  adminResolveTaxRate,
};