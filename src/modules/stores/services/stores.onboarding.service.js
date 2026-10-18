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
const mongoose = require('mongoose');
const ApiError = require('../../../utils/ApiError');
const { fromPaise } = require('../../../utils/money');
const { withRequiredTransaction } = require('../../../utils/optionalTransaction');
const {
  StoreChain,
  StoreOutlet,
  StoreRoleAssignment,
  StoreComplianceDocument,
} = require('../../../models');
const lifecycle = require('./stores.lifecycle.service');
const profileService = require('./stores.profile.service');
const notifyService = require('./stores.notify.service');

/**
 * The nine onboarding steps. A step index is a CURSOR, never a validator —
 * completeness is recomputed server-side on every save, so a client cannot jump to
 * the final step by writing a number.
 */
const STEPS = require('../constants/onboarding.steps').STEPS;

/** Field-level completeness. Each entry answers "is this present and plausible?" */
const STEP_REQUIREMENTS = {
  businessInfo: (d) => !!d.businessInfo?.legalName && !!d.businessInfo?.businessType,
  storeInfo: (d) =>
    !!d.storeInfo?.name && Array.isArray(d.storeInfo?.categories) && d.storeInfo.categories.length > 0,
  ownerInfo: (d) => !!d.ownerInfo?.name && !!d.ownerInfo?.mobile && !!d.ownerInfo?.relation,
  location: (d) =>
    !!d.location?.city &&
    !!d.location?.locality &&
    !!d.location?.geo?.coordinates &&
    d.location.geo.coordinates.length === 2,
  // Documents are checked against the outlet's MANDATORY set, not a fixed list, so a
  // Pharmacy is not asked for a GSTIN twice and an Electronics store is not let
  // through without its authorisation.
  documents: (d) => Array.isArray(d.documents) && d.documents.length > 0,
  deliveryConfig: (d) =>
    d.deliveryConfig?.radiusKm !== undefined &&
    d.deliveryConfig?.minimumOrder !== undefined &&
    d.deliveryConfig?.deliveryFee !== undefined,
};

/** Which steps are still missing. The wizard renders its "what is left" from this. */
const computeIncompleteSteps = (draft) =>
  STEPS.map((s, i) => (STEP_REQUIREMENTS[s.key](draft) ? null : i)).filter((i) => i !== null);

const recomputeProgress = (draft) => {
  const incomplete = computeIncompleteSteps(draft);
  draft.incompleteSteps = incomplete;
  draft.completedSteps = STEPS.map((_, i) => i).filter((i) => !incomplete.includes(i));
  // Cursor advances to the first incomplete step, never past it.
  draft.currentStep = incomplete.length ? incomplete[0] : STEPS.length - 1;
  return draft;
};

/**
 * Save the draft. Recomputes progress so `currentStep` and `incompleteSteps` can never
 * be set by the client.
 */
const saveDraft = async (ownerId, patch) => {
  const draft = await getOrCreateDraft(ownerId);
  if (draft.status !== 'draft' && draft.status !== 'changes_required') {
    throw new ApiError(httpStatus.CONFLICT, `APPLICATION_NOT_EDITABLE: ${draft.status}`);
  }

  const merged = mergeDraft(draft, patch);
  recomputeProgress(merged);
  if (merged.isModified()) await merged.save();
  return merged;
};

/** Shallow-merge per step, so a client can send one step without wiping the others. */
const mergeDraft = (draft, patch = {}) => {
  for (const step of STEPS) {
    const value = patch[step.key];
    if (value === undefined) continue; // eslint-disable-line no-continue

    // `documents` is an array, not a nested object. Spread-merging it as
    // `{ ...current, ...value }` turns the array into `{ 0: id }`, which Mongoose cannot
    // cast back to ObjectId[], so the documents step threw a CastError and a partner
    // could never save it. Arrays are REPLACED; only object-shaped groups are merged, so
    // a client can still patch a single field without re-sending the whole step.
    if (Array.isArray(value)) {
      draft.set(step.key, value);
    } else {
      draft.set(step.key, { ...(draft[step.key] || {}), ...value });
    }
    draft.markModified(step.key);
  }
  if (patch.outletCount !== undefined) draft.outletCount = Math.max(1, Number(patch.outletCount) || 1);
  return draft;
};

const getOrCreateDraft = async (ownerId) => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');
  // Counting exactly ONE application per owner is enforced by a unique index on `owner`.
  // Filtering by status here was therefore self-fulfilling in the failure direction: once
  // the application left draft, a later saveDraft call found no editable row, tried to
  // insert a second one, and threw E11000 — the raw, ugly duplicate-key error instead
  // of the meaningful 409. Return the owner's one application whatever its status and let
  // the caller's own transition gate speak.
  const existing = await StoreOnboarding.findOne({ owner: ownerId }).sort({ createdAt: -1 });
  if (existing) return existing;

  return StoreOnboarding.create({ owner: ownerId, status: 'draft' });
};

/**
 * Submit. Refuses while anything is incomplete, and says exactly what is missing.
 */
const submit = async (ownerId, actor) => {
  const draft = await getOrCreateDraft(ownerId);
  recomputeProgress(draft);

  if (draft.incompleteSteps.length) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      'APPLICATION_INCOMPLETE',
      true,
      '',
      {
        incompleteSteps: draft.incompleteSteps,
        missing: draft.incompleteSteps.map((i) => STEPS[i] && STEPS[i].label),
      }
    );
  }

  // Audit: append, do not overwrite. The five writers below all set
  // `draft.statusHistory = {...}`, which replaced the whole audit trail each transition —
  // the buyer who reads "when was this submitted" later got whichever transition ran last.
  // And `from: draft.status` was read after the status had already been updated, so every
  // row recorded the transition as same-status. `previousStatus` captures the real origin.
  const previousStatus = draft.status;
  draft.status = 'submitted';
  draft.submittedAt = new Date();
  draft.statusHistory.push({
    from: previousStatus,
    to: 'submitted',
    by: actor ? actor._id : undefined,
    actorRole: 'partner',
    at: new Date(),
  });
  await draft.save();

  // Fire-and-forget: a failed push must NEVER roll back the application, but it must
  // not be lost, so it is awaited with the error swallowed — the state transition above
  // is the record, this is the courtesy.
  await notifyService.notifyApplication(draft.owner, draft, 'application_submitted').catch(() => {});
  return draft;
};

/** Admin moves an application into review. */
const startReview = async (applicationId, actor) => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');
  const draft = await StoreOnboarding.findById(applicationId);
  if (!draft) throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');

  lifecycle.assertTransition(draft.status, 'under_review');

  draft.status = 'under_review';
  draft.reviewedBy = actor ? actor._id : undefined;
  draft.statusHistory.push({
    from: 'submitted',
    to: 'under_review',
    by: actor ? actor._id : undefined,
    actorRole: 'admin',
    at: new Date(),
  });
  await draft.save();
  return draft;
};

/** Ask for changes, with the exact field so the wizard can highlight it. */
const requestChanges = async (applicationId, { step, field, message }, actor) => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');
  const draft = await StoreOnboarding.findById(applicationId);
  if (!draft) throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  if (draft.status !== 'under_review') {
    throw new ApiError(
      httpStatus.CONFLICT,
      `ILLEGAL_APPLICATION_MOVE: under_review -> changes_required is only legal from under_review, is ${draft.status}`
    );
  }

  draft.status = 'changes_required';
  draft.reviewedAt = new Date();
  draft.reviewedBy = actor ? actor._id : undefined;
  draft.changesRequested.push({ step, field, message });
  draft.statusHistory.push({
    from: 'under_review',
    to: 'changes_required',
    by: actor ? actor._id : undefined,
    actorRole: 'admin',
    note: message,
    at: new Date(),
  });
  await draft.save();
  return draft;
};

/**
 * APPROVE AND COMMIT — the critical write.
 *
 * Creates `Business -> StoreChain -> StoreOutlet -> StoreRoleAssignment` in ONE
 * transaction. A partner who completes the last step and gets a half-built store is a
 * support call and a lost partner.
 *
 * Note the approval ladder: the APPLICATION becomes `approved`, and the chain and
 * outlet are born at `subscription_payment`. They do NOT become `active` here —
 * `assertCanBecomeActive` gates that separately, after the subscription is paid.
 */
const approveAndCommit = async (applicationId, actor) => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');
  const draft = await StoreOnboarding.findById(applicationId);
  if (!draft) throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  if (draft.status !== 'under_review') {
    throw new ApiError(
      httpStatus.CONFLICT,
      `ILLEGAL_APPLICATION_MOVE: only an application under_review can be approved, is ${draft.status}`
    );
  }

  const Business = mongoose.model('Business');

  // REQUIRED, not optional. This is the single most consequential write in the vertical:
  // it commits Business, StoreChain, StoreOutlet and the owner's StoreRoleAssignment, and
  // it changes the application's status to 'approved'. Run sequentially on a standalone
  // mongod, a failure halfway leaves an approved business with no outlet and no owner who
  // can log in — and no retry repairs it, because the retry re-runs a submit that already
  // completed. `withRequiredTransaction` refuses before writing anything instead.
  return withRequiredTransaction(async () => {
    const business = await Business.create({
      vertical: 'stores',
      businessModel: 'direct',
      name: draft.businessInfo.legalName,
      logo: draft.storeInfo.logo,
      description: draft.storeInfo.description,
      owner: draft.owner,
      contact: {
        name: draft.ownerInfo.name,
        mobile: draft.ownerInfo.mobile,
        countryCode: draft.businessInfo.countryCode || '+91',
        email: draft.ownerInfo.email || draft.businessInfo.email,
      },
      city: draft.location.city,
      locality: draft.location.locality,
      location: draft.location.geo,
      // BR-04 — a local store owns its fleet
      ownDeliveryPartner: true,
      driverPayoutMode: 'business_pays',
      status: true,
    });

    const chain = await StoreChain.create({
      business: business._id,
      name: draft.storeInfo.name,
      logo: draft.storeInfo.logo,
      cover: draft.storeInfo.cover,
      description: draft.storeInfo.description,
      catalogueScope: 'shared',
      brand: draft.storeInfo.brand,
      categories: draft.storeInfo.categories,
      subcategories: draft.storeInfo.subcategories,
      status: 'approved',
      statusChangedAt: new Date(),
    });

    const outletCode = await buildOutletCode(business, chain, 1);

    const outlet = await StoreOutlet.create({
      chain: chain._id,
      outletCode,
      name: draft.storeInfo.name,
      logo: draft.storeInfo.logo,
      cover: draft.storeInfo.cover,
      photos: draft.storeInfo.photos || [],
      description: draft.storeInfo.description,
      address: {
        line1: draft.location.line1,
        line2: draft.location.line2,
        area: draft.location.area,
        city: draft.location.city,
        locality: draft.location.locality,
        pincode: draft.location.pincode,
        countryCode: draft.location.countryCode || '+91',
      },
      location: draft.location.geo,
      serviceLocalities: draft.location.serviceLocalities || [],
      servicePinCodes: draft.location.servicePinCodes || [],
      operatingHours: draft.deliveryConfig.operatingHours || [],
      holidays: draft.deliveryConfig.holidays || [],
      deliveryConfig: {
        radiusKm: draft.deliveryConfig.radiusKm,
        minimumOrder: draft.deliveryConfig.minimumOrder,
        deliveryFee: draft.deliveryConfig.deliveryFee,
        freeDeliveryAbove: draft.deliveryConfig.freeDeliveryAbove,
        // COD stays OFF until the partner explicitly turns it on and an Admin has
        // enabled it platform-wide. Defaulting it on is how a cash-handling surprise
        // reaches a first-time partner.
        codEnabled: false,
        onlinePaymentEnabled: true,
      },
      // BR-42 — the outlet is the merchant of record
      taxIdentity: {
        gstin: draft.businessInfo.gstin,
        legalName: draft.businessInfo.legalName,
        stateCode: draft.location.stateCode,
        registeredAddress: draft.businessInfo.address,
      },
      // BR-43 — server-controlled, per outlet, gapless
      invoiceSeries: {
        prefix: outletCode,
        financialYear: currentFinancialYear(),
        lastSequence: 0,
      },
      contact: {
        mobile: draft.businessInfo.contactNumber,
        countryCode: draft.businessInfo.countryCode || '+91',
        email: draft.businessInfo.email,
      },
      // Born here, NOT active. Activation is a separate gated transition.
      status: 'subscription_payment',
      operational: false,
      statusChangedAt: new Date(),
      verified: true,
    });

    await chain.updateOne({
      $set: { outlets: [outlet._id], outletCount: 1 },
    });
    await business.updateOne({ $set: { name: draft.businessInfo.legalName } });

    // The applicant becomes the owner with chain scope, so they can add outlets later.
    const assignment = await StoreRoleAssignment.create({
      user: draft.owner,
      business: business._id,
      chain: chain._id,
      role: 'owner',
      scopeType: 'chain',
      permissions: profileService.ROLE_PERMISSIONS.owner,
      isPrimary: true,
      status: 'active',
      joinedAt: new Date(),
      grantedBy: actor ? actor._id : undefined,
    });

    // Carry the documents across, preserving their review state.
    if (draft.documents && draft.documents.length) {
      await StoreComplianceDocument.updateMany(
        { _id: { $in: draft.documents } },
        { $set: { outlet: outlet._id, chain: chain._id } }
      );
    }

    draft.status = 'approved';
    draft.reviewedAt = new Date();
    draft.reviewedBy = actor ? actor._id : undefined;
    draft.business = business._id;
    draft.chain = chain._id;
    draft.outlet = outlet._id;
    draft.statusHistory.push({
      from: 'under_review',
      to: 'approved',
      by: actor ? actor._id : undefined,
      actorRole: 'admin',
      at: new Date(),
    });
    await draft.save();

    return { draft, business, chain, outlet, assignment };
  });
};

const rejectApplication = async (applicationId, reason, actor) => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');
  const draft = await StoreOnboarding.findById(applicationId);
  if (!draft) throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  if (draft.status !== 'under_review') {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_APPLICATION_MOVE: is ${draft.status}`);
  }
  draft.status = 'rejected';
  draft.rejectionReason = reason;
  draft.reviewedAt = new Date();
  draft.reviewedBy = actor ? actor._id : undefined;
  draft.statusHistory.push({
    from: 'under_review',
    to: 'rejected',
    by: actor ? actor._id : undefined,
    actorRole: 'admin',
    note: reason,
    at: new Date(),
  });
  await draft.save();

  // Fire-and-forget: a failed push must NEVER roll back the business move,
  // but the in-app feed is derived from the same template, so the text record
  // is the source of truth regardless of delivery status.
  await notifyService.notifyApplication(draft.owner, draft, 'application_rejected').catch(() => {});
  return draft;
};

/**
 * Add a further outlet to an existing chain. Reuses the same code as first
 * onboarding, so a second outlet can never take a different path.
 */
const addOutletToChain = async ({ chain, payload, actor }) => {
  const business = await mongoose.model('Business').findById(chain.business);
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');

  const outletCount = chain.outletCount || (chain.outlets || []).length || 0;
  const outletCode = await buildOutletCode(business, chain, outletCount + 1);

  const outlet = await StoreOutlet.create({
    chain: chain._id,
    outletCode,
    name: payload.name,
    logo: payload.logo,
    address: payload.address,
    location: payload.location,
    serviceLocalities: payload.serviceLocalities || [],
    operatingHours: payload.operatingHours || [],
    holidays: payload.holidays || [],
    deliveryConfig: {
      radiusKm: payload.deliveryConfig?.radiusKm ?? 5,
      minimumOrder: payload.deliveryConfig?.minimumOrder ?? 0,
      deliveryFee: payload.deliveryConfig?.deliveryFee ?? 0,
      codEnabled: false, // never inherits COD from a sibling outlet
      onlinePaymentEnabled: true,
    },
    taxIdentity: payload.taxIdentity,
    invoiceSeries: {
      prefix: outletCode,
      financialYear: currentFinancialYear(),
      lastSequence: 0,
    },
    // A new outlet starts its own approval journey.
    status: 'submitted',
    operational: false,
    statusChangedAt: new Date(),
  });

  chain.outlets.push(outlet._id);
  chain.outletCount = chain.outlets.length;
  await chain.save();

  return outlet;
};

/** OutletCode is the invoice prefix, so it must be unique platform-wide. */
const buildOutletCode = async (business, chain, ordinal) => {
  const cityPart = (chain.name || 'OUT')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');
  const bizPart = String(business._id).slice(-4).toUpperCase();

  let candidate = `${cityPart}-${bizPart}-${String(ordinal).padStart(2, '0')}`;
  let suffix = 0;
  // eslint-disable-next-line no-await-in-loop
  while (await StoreOutlet.exists({ outletCode: candidate })) {
    suffix += 1;
    candidate = `${cityPart}-${bizPart}-${String(ordinal).padStart(2, '0')}${String.fromCharCode(64 + suffix)}`;
  }
  return candidate;
};

/** Indian financial year, April to March. */
const currentFinancialYear = (at = new Date()) => {
  const y = at.getFullYear();
  const startMonth = at.getMonth() >= 3 ? y : y - 1;
  return `${startMonth}-${String(startMonth + 1).slice(-2)}`;
};

/** The Admin work queue, with a computed hasLocation so an operator can see at a
 *  glance that an application predates the location rules. */
/** Money keys inside deliveryConfig that store paise. Keep in sync with the schema. */
const DELIVERY_MONEY_KEYS = ['minimumOrder', 'deliveryFee', 'freeDeliveryAbove'];

/**
 * Convert a LEAN deliveryConfig's money fields from paise to rupees.
 *
 * `.lean()` bypasses the `moneyField` getter, so every monetary value comes back a
 * hundred times too large. Applied on both read paths that use `.lean()`.
 *
 * A missing deliveryConfig stays missing rather than becoming zeros, so the wizard's
 * "step 6 is incomplete" check keeps working.
 *
 * @param {object|null|undefined} deliveryConfig
 * @returns {object|null|undefined}
 */
const withRupeeDeliveryConfig = (deliveryConfig) => {
  if (!deliveryConfig) return deliveryConfig;
  const out = { ...deliveryConfig };
  for (const key of DELIVERY_MONEY_KEYS) {
    out[key] = fromPaise(out[key]);
  }
  return out;
};

/**
 * ONE application, for the admin review screen.
 *
 * ## Why this is not `listApplications({ id })`
 *
 * It was, and `GET /admin/stores/applications/:application` returned the entire list
 * paginated at 20 while ignoring the `:application` in the path. The review screen then
 * rendered application 1 regardless of which row the admin clicked. The failure was
 * silent: the response was a valid array of valid applications.
 *
 * So this loads exactly one document by id and throws NOT_FOUND when it does not exist,
 * which makes a bad id visible instead of showing the wrong applicant.
 *
 * @param {string} applicationId
 * @returns {Promise<object>}
 */
const getApplication = async (applicationId) => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');

  const application = await StoreOnboarding.findById(applicationId).lean();

  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  }

  // Only expose what a reviewer needs, and never the owner's raw contact details in a
  // list response. `hasLocationGeo` tells the review screen whether the map pin is
  // usable without the admin opening the record.
  return {
    ...application,
    // `.lean()` returns raw paise. Converted here so the review screen shows the
    // rupee figure the applicant typed; see fromPaise for why this is not optional.
    deliveryConfig: withRupeeDeliveryConfig(application.deliveryConfig),
    hasLocation: !!(application.location && application.location.geo && application.location.geo.coordinates),
    hasLocationGeo: !!(
      application.location &&
      application.location.geo &&
      application.location.geo.type === 'Point'
    ),
    stepLabel: STEPS[application.currentStep] ? STEPS[application.currentStep].label : null,
  };
};

const listApplications = async ({ status, search, page = 1, limit = 20 }) => {
  const StoreOnboarding = mongoose.model('StoreOnboarding');
  const filter = {};
  if (status) filter.status = { $in: [].concat(status) };
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { 'businessInfo.legalName': rx },
      { 'storeInfo.name': rx },
      { 'ownerInfo.name': rx },
      { 'ownerInfo.mobile': rx },
    ];
  }

  const [items, total] = await Promise.all([
    StoreOnboarding.find(filter)
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreOnboarding.countDocuments(filter),
  ]);

  return {
    applications: items.map((a) => ({
      ...a,
      // Same paise -> rupees conversion as getApplication. A queue row showing a
      // delivery fee of 15000 instead of 150 makes an applicant look like a fraud
      // case, so this is a correctness issue and not cosmetics.
      deliveryConfig: withRupeeDeliveryConfig(a.deliveryConfig),
      hasLocation: !!(a.location && a.location.geo && a.location.geo.coordinates),
      hasLocationGeo: !!(a.location && a.location.geo && a.location.geo.type === 'Point'),
      stepLabel: STEPS[a.currentStep] ? STEPS[a.currentStep].label : null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

module.exports = {
  STEPS,
  saveDraft,
  getOrCreateDraft,
  submit,
  startReview,
  requestChanges,
  approveAndCommit,
  rejectApplication,
  addOutletToChain,
  getApplication,
  listApplications,
  recomputeProgress,
  computeIncompleteSteps,
  buildOutletCode,
  currentFinancialYear,
};