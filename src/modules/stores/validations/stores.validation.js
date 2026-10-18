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
// src/modules/stores/validations -> src/validations
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

/**
 * The shared `objectId` helper is a bare validator function, not a Joi schema, so it
 * cannot be chained. Wrapping it once here means every call site below can use
 * `objectId`, `objectId.required()` and `objectId.allow('', null)` as usual.
 *
 * An id that reaches a query without this throws a Mongoose cast error and becomes a
 * 500 — an information leak, and a log line nobody reads.
 */
const objectId = Joi.string().custom(objectIdCustom);

/**
 * Joi schemas for the stores vertical.
 *
 * TWO RULES THAT ARE NOT OPTIONAL
 *
 * 1. Every id is `objectId`. A malformed id reaching a query throws a cast error and
 *    becomes a 500, which is an information leak and a wasted log line.
 *
 * 2. Every status that a service transition table ALSO checks must be Joi-allow-listed
 *    here. The table is the authority; Joi is the first gate, so a client cannot POST
 *    an arbitrary status string and reach the service at all. The route parameter
 *    form is `PATCH /orders/:status/:order`.
 *
 * `abortEarly: false` so a form returns every problem at once rather than one per
 * submission — the partner wizard depends on that.
 */

const outletStatus = Joi.string()
  .valid(
    'draft', 'submitted', 'under_review', 'changes_required', 'approved',
    'subscription_payment', 'active', 'suspended', 'reactivated', 'rejected', 'archived'
  );

const chainStatus = outletStatus;

const lifecycleStatus = Joi.string()
  .valid(
    'draft', 'submitted', 'under_review', 'changes_required', 'approved',
    'subscription_payment', 'active', 'suspended', 'reactivated', 'rejected', 'archived'
  );

const subscriptionStatus = Joi.string()
  .valid('trial', 'active', 'payment_due', 'retrying', 'grace_period', 'suspended', 'cancelled', 'expired');

const staffRole = Joi.string()
  .valid('owner', 'manager', 'order_manager', 'inventory_manager', 'dispatcher', 'regional_manager', 'staff');

const suspensionReason = Joi.string()
  .valid(
    'expired_subscription', 'compliance_issue', 'repeated_complaints',
    'fraud', 'payment_issue', 'operational_violation', 'admin_action'
  );

/** `HH:mm`, 24-hour. Operating hours and delivery windows both use it. */
const timeOfDay = Joi.string()
  .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
  .message('must be HH:mm in 24-hour format');

const isoDate = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).message('must be YYYY-MM-DD');

const point = Joi.object({
  type: Joi.string().valid('Point').required(),
  // [longitude, latitude] — longitude FIRST. A reversed pair is a valid number
  // pair, so nothing else catches it; the 2dsphere index accepts it happily.
  coordinates: Joi.array().items(Joi.number().min(-180).max(180).required()).length(2).required(),
});

const money = Joi.number().min(0).precision(2);

/** The common list query: page, limit, search, sort. */
const listQuery = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().max(120),
  sortOrder: Joi.number().integer().default(1),
};

/**
 * ## Customer request bodies (§7.2)
 *
 * The customer routes had NO Joi at all — every field reached the service unvalidated and
 * failed deep inside Mongoose as a `CastError`, which is a bad error to hand a mobile
 * client (it leaks schema shape and tells them nothing actionable). Validating here turns
 * those into 400s naming the offending field.
 *
 * ## Why `address` is `addressId` + a separate `addressSnapshot`
 *
 * `StoreOrder.address` is `ObjectId ref 'UserAddress'`, while `addressSnapshot` holds the
 * frozen copy of where the parcel actually went. They are deliberately distinct: the id
 * lets the customer manage the saved address afterwards, and the snapshot means EDITING
 * that address cannot rewrite where an already-placed order was delivered to — which is
 * exactly what a delivery dispute or a refund conversation is about.
 *
 * The client sends `addressId` (an id) and `addressSnapshot` (the object). Accepting the
 * address object under the key `address` was what produced
 * `Cast to ObjectId failed for value "{ name: 'Shopper', ... }"`.
 */
const addressSnapshotValidation = Joi.object({
  name: Joi.string().trim().max(120).required(),
  contact: Joi.string().trim().max(20).required(),
  countryCode: Joi.string().trim().max(6).required(),
  line1: Joi.string().trim().max(200).required(),
  line2: Joi.string().trim().max(200).allow('').optional(),
  area: Joi.string().trim().max(120).optional(),
  city: Joi.string().trim().max(120).optional(),
  locality: Joi.string().trim().max(120).optional(),
  pincode: Joi.string().trim().max(10).optional(),
  location: point.optional(),
}).required();

const cartAddValidation = {
  body: Joi.object({
    outlet: objectId.required(),
    chain: objectId.required(),
    product: objectId.required(),
    variant: objectId.required(),
    quantity: Joi.number().integer().min(1).max(99).required(),
    unitPrice: money,
    name: Joi.string().trim().max(200),
    variantName: Joi.string().trim().max(200),
    image: Joi.string().trim().max(500),
    sku: Joi.string().trim().max(80),
    attributes: Joi.array().items(Joi.object()).max(20).optional(),
    isOrganic: Joi.boolean().optional(),
  }).required(),
};

const cartUpdateValidation = {
  body: Joi.object({
    outlet: objectId.required(),
    variant: objectId.required(),
    quantity: Joi.number().integer().min(0).max(99).required(),
  }).required(),
};

const cartRemoveValidation = {
  body: Joi.object({
    outlet: objectId.required(),
    variant: objectId.required(),
  }).required(),
};

const cartOutletValidation = {
  query: Joi.object({ outlet: objectId.required() }).required(),
};

const orderCreateValidation = {
  body: Joi.object({
    outlet: objectId.required(),
    chain: objectId.required(),
    items: Joi.array()
      .items(
        Joi.object({
          product: objectId.required(),
          variant: objectId.required(),
          quantity: Joi.number().integer().min(1).max(99).required(),
          // Display-only. Allowed because §4.9 snapshots the line name onto the order,
          // and because an old client already sends it — but the SERVER re-derives it
          // from the (variant × outlet) row, so a doctored name changes nothing but the
          // text. Rejecting it would only break clients for no security gain.
          name: Joi.string().trim().max(200),
          // NOTE: `unitPrice` is accepted and IGNORED. Pricing comes from
          // `StoreOutletProduct`, never from the request (§4.3b) — a client-sent price is
          // discarded rather than trusted. It is permitted here so an old client does not
          // 400 on a field that is now inert.
          unitPrice: money,
        })
      )
      .min(1)
      .required(),
    addressId: objectId.required(),
    addressSnapshot: addressSnapshotValidation,
    paymentMode: Joi.string().valid('gateway', 'wallet', 'cod').required(),
    promoCode: Joi.string().trim().max(40).optional(),
    couponCode: Joi.string().trim().max(40).optional(),
    instructions: Joi.string().trim().max(500).optional(),
  }).required(),
};

// ---------------------------------------------------------------------------
// picking / packing
//
// Guarded by storeAuth (`stores_order_pick` / `stores_order_pack`) and
// checkout validation: an explicit resolution is required for every non-picked
// item, and substitutions require both the replacement variant and a note.
const pickItemValidation = {
  params: Joi.object({ order: objectId.required() }).required(),
  body: Joi.object({
    variant: objectId.required(),
    pickedQuantity: Joi.number().integer().min(0).required(),
    status: Joi.string().valid('picked', 'partial', 'unavailable', 'substituted').required(),
    resolution: Joi.string().trim().max(120),
    substituteVariant: objectId,
    note: Joi.string().trim().max(500),
  }).required(),
};

const packingCompleteValidation = {
  params: Joi.object({ order: objectId.required() }).required(),
  body: Joi.object({
    packageCount: Joi.number().integer().min(1),
    totalWeightGrams: Joi.number().min(0),
    fragile: Joi.boolean(),
    specialHandling: Joi.string().trim().max(200),
    note: Joi.string().trim().max(500),
  }).required(),
};

const orderIdValidation = {
  params: Joi.object({ order: objectId.required() }).required(),
};

// ---------------------------------------------------------------------------
// onboarding
// ---------------------------------------------------------------------------

const onboardingDraftValidation = {
  params: Joi.object().keys({}).unknown(true),
  body: Joi.object()
    .keys({
      outletCount: Joi.number().integer().min(1).max(500),
      businessInfo: Joi.object().keys({
        legalName: Joi.string().trim().min(2).max(160),
        displayName: Joi.string().trim().max(160),
        businessType: Joi.string()
          .trim()
          .valid('proprietorship', 'partnership', 'private_limited', 'llp', 'other'),
        registrationNumber: Joi.string().trim().max(64),
        gstin: Joi.string().trim().uppercase()
          .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}$/)
          .message('must be a valid 15-character GSTIN')
          .allow('', null),
        tradeLicenceNumber: Joi.string().trim().max(64).allow('', null),
        contactNumber: Joi.number().min(1000000000).max(9999999999),
        countryCode: Joi.string().trim().default('+91'),
        email: Joi.string().email().lowercase().allow('', null),
        address: Joi.string().trim().max(400),
      }),
      storeInfo: Joi.object().keys({
        name: Joi.string().trim().min(2).max(160),
        logo: Joi.string().allow('', null),
        cover: Joi.string().allow('', null),
        photos: Joi.array().items(Joi.string()).max(8),
        description: Joi.string().trim().max(2000),
        brand: objectId.allow('', null),
        categories: Joi.array().items(objectId).min(1).max(20),
        subcategories: Joi.array().items(objectId).max(60),
      }),
      ownerInfo: Joi.object().keys({
        name: Joi.string().trim().min(2).max(120),
        mobile: Joi.number().min(1000000000).max(9999999999),
        email: Joi.string().email().lowercase().allow('', null),
        // LAST FOUR ONLY. A full government identifier must never be stored.
        aadhaarLast4: Joi.string().pattern(/^[0-9]{4}$/).allow('', null),
        relation: Joi.string().trim().valid('owner', 'partner', 'director', 'proprietor'),
      }),
      location: Joi.object().keys({
        line1: Joi.string().trim().max(200),
        line2: Joi.string().trim().max(200),
        area: Joi.string().trim().max(160),
        city: objectId,
        locality: objectId,
        pincode: Joi.string().trim().pattern(/^[1-9][0-9]{5}$/).message('must be a 6-digit PIN'),
        countryCode: Joi.string().trim().default('+91'),
        stateCode: Joi.string().trim().max(4),
        serviceLocalities: Joi.array().items(objectId).max(50),
        servicePinCodes: Joi.array().items(Joi.string().pattern(/^[1-9][0-9]{5}$/)).max(50),
        // Accepts coordinates WITHOUT 'type' — the service supplies 'Point'. The
        // client should not be able to set the GeoJSON type itself.
        geo: Joi.object()
          .keys({ coordinates: Joi.array().items(Joi.number()).length(2).required() })
          .unknown(false),
      }),
      documents: Joi.array().items(objectId).max(30),
      deliveryConfig: Joi.object().keys({
        radiusKm: Joi.number().min(0).max(200),
        minimumOrder: money,
        deliveryFee: money,
        freeDeliveryAbove: money,
        operatingHours: Joi.array().items(
          Joi.object().keys({
            day: Joi.number().integer().min(0).max(6),
            isOpen: Joi.boolean(),
            opensAt: timeOfDay.allow('', null),
            closesAt: timeOfDay.allow('', null),
          })
        ).max(7),
        holidays: Joi.array().items(
          Joi.object().keys({
            date: isoDate,
            reason: Joi.string().trim().max(160),
            isRecurring: Joi.boolean(),
            dayOfMonth: Joi.number().integer().min(1).max(31),
          })
        ).max(60),
      }),
    })
    .min(1)
    .message('send at least one step'),
};

const submitValidation = {
  params: Joi.object().keys({}).unknown(true),
  body: Joi.object().keys({}).unknown(true).default({}),
};

const applicationIdValidation = {
  params: Joi.object().keys({ application: objectId.required() }).unknown(true),
  body: Joi.object().keys({}).unknown(true).default({}),
};

const applicationListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({
    ...listQuery,
    status: Joi.alternatives()
      .try(listQuery, Joi.string())
      .custom((value, helpers) => (value.split(',').map((s) => s.trim()), value)),
  }),
};

const requestChangesValidation = {
  params: Joi.object().keys({ application: objectId.required() }).unknown(true),
  body: Joi.object()
    .keys({
      step: Joi.number().integer().min(0).max(8).required(),
      field: Joi.string().trim().max(120),
      message: Joi.string().trim().min(3).max(500).required(),
    })
    .required(),
};

const rejectValidation = {
  params: Joi.object().keys({ application: objectId.required() }).unknown(true),
  body: Joi.object().keys({ reason: Joi.string().trim().min(3).max(500).required() }).required(),
};

// ---------------------------------------------------------------------------
// chain, outlet, session
// ---------------------------------------------------------------------------

const chainIdValidation = {
  params: Joi.object().keys({ chain: objectId.required() }).unknown(true),
  body: Joi.object().keys({}).unknown(true).default({}),
};

const outletIdValidation = {
  params: Joi.object().keys({ outlet: objectId.required() }).unknown(true),
  body: Joi.object().keys({}).unknown(true).default({}),
};

/**
 * Switching the active outlet. The outlet must be in `req.permittedOutletIds`, which
 * the tenancy middleware has already computed. Validation alone cannot enforce that —
 * only the service can, and it must.
 */
const sessionOutletSwitchValidation = {
  params: Joi.object().keys({}).unknown(true),
  body: Joi.object()
    .keys({ outlet: objectId.required() })
    .required(),
};

const outletListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({ ...listQuery, status: chainStatus, chain: objectId }),
};

const outletStatusChangeValidation = {
  params: Joi.object().keys({
    status: lifecycleStatus.required(),
    outlet: objectId.required(),
  }).unknown(true),
  body: Joi.object().keys({
    reasonCode: suspensionReason,
    reason: Joi.string().trim().max(500),
  }),
};

const chainStatusChangeValidation = {
  params: Joi.object().keys({
    status: chainStatus.required(),
    chain: objectId.required(),
  }).unknown(true),
  body: Joi.object().keys({ reason: Joi.string().trim().max(500) }),
};

// ---------------------------------------------------------------------------
// staff
// ---------------------------------------------------------------------------

const staffRoleValidation = {
  params: Joi.object().keys({}).unknown(true),
  body: Joi.object()
    .keys({
      user: objectId.required(),
      role: staffRole.required(),
      scopeType: Joi.string().valid('outlet', 'chain', 'business').required(),
      outlets: Joi.array().items(objectId).max(500),
      isPrimary: Joi.boolean(),
      notes: Joi.string().trim().max(500),
    })
    .required(),
};

/**
 * An outlet-scoped role with an empty `outlets[]` is a misconfiguration that would
 * mean "no access" at runtime. Refuse it at the edge instead, where the message can
 * be specific.
 */
const staffRoleBoundary = (value, helpers) => {
  if (value.scopeType === 'outlet' && (!value.outlets || !value.outlets.length)) {
    return helpers.message('outlets[] is required and must be non-empty when scopeType is "outlet"');
  }
  return value;
};

const staffListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({ ...listQuery, role: staffRole, status: Joi.string().valid('active', 'inactive', 'suspended') }),
};

const staffUpdateValidation = {
  params: Joi.object().keys({ assignment: objectId.required() }).unknown(true),
  body: Joi.object()
    .keys({
      role: staffRole,
      scopeType: Joi.string().valid('outlet', 'chain', 'business'),
      outlets: Joi.array().items(objectId).max(500),
      status: Joi.string().valid('active', 'inactive', 'suspended'),
      statusReason: Joi.string().trim().max(500),
      isPrimary: Joi.boolean(),
      notes: Joi.string().trim().max(500),
    })
    .min(1),
};

// ---------------------------------------------------------------------------
// compliance
// ---------------------------------------------------------------------------

const complianceDocumentValidation = {
  params: Joi.object().keys({ outlet: objectId.required() }).unknown(true),
  body: Joi.object()
    .keys({
      type: Joi.string().valid(
        'gst_registration', 'trade_licence', 'shop_and_establishment', 'fssai',
        'pharmacy_registration', 'drug_licence', 'fire_noc', 'shops_establishment',
        'fssai_registration', 'professional_tax', 'other'
      ).required(),
      number: Joi.string().trim().max(64),
      issuingAuthority: Joi.string().trim().max(160),
      issuedAt: Joi.date(),
      expiresAt: Joi.date().allow(null),
      file: Joi.string().allow('', null),
      fileType: Joi.string().trim().max(80),
      isMandatory: Joi.boolean(),
      notes: Joi.string().trim().max(500),
    })
    .required(),
};

const complianceReviewValidation = {
  params: Joi.object().keys({ document: objectId.required() }).unknown(true),
  body: Joi.object()
    .keys({
      status: Joi.string().valid('approved', 'rejected').required(),
      rejectionReason: Joi.string().trim().max(500),
    })
    .required(),
};

// ---------------------------------------------------------------------------
// taxonomy (admin)
// ---------------------------------------------------------------------------

const categoryValidation = {
  params: Joi.object().keys({}).unknown(true),
  body: Joi.object()
    .keys({
      key: Joi.string().trim().lowercase().pattern(/^[a-z0-9_]+$/).required(),
      name: Joi.string().trim().min(2).max(120).required(),
      description: Joi.string().trim().max(500),
      icon: Joi.string().allow('', null),
      sortOrder: Joi.number().integer().default(0),
      status: Joi.boolean(),
    })
    .required(),
};

const taxConfigurationValidation = {
  params: Joi.object().keys({}).unknown(true),
  body: Joi.object()
    .keys({
      code: Joi.string().trim().uppercase().min(2).max(12).required(),
      description: Joi.string().trim().max(200),
      // 0.25 and 0.5 exist for gold, diamonds and rough diamonds.
      gstRate: Joi.number().min(0).max(100).required(),
      effectiveFrom: Joi.date().required(),
      effectiveTo: Joi.date().allow(null),
      isDefault: Joi.boolean(),
      status: Joi.boolean(),
    })
    .required(),
};

const taxConfigurationQueryValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({
    ...listQuery,
    code: Joi.string().trim().uppercase(),
    status: Joi.boolean(),
    atDate: Joi.date(), // resolve the rate in force on this date
  }),
};

// Admin governance: paginating chains across the vertical.
//
// `business` lets an admin see every chain belonging to one tenant without the screen
// pulling one page per tenant. STATUS is the public chain status, not a subscription
// state — a suspended chain and a cancelled subscription are different ways of stopping
// trading, and they must be distinguishable in the list.
const chainsAdminListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({
    ...listQuery,
    business: objectId,
    status: Joi.string().trim(),
    featured: Joi.boolean(),
    verified: Joi.boolean(),
  }),
};

/**
 * Admin outlet registry filters. `status` is the outlet lifecycle string
 * (draft/active/suspended/…), never a boolean — the Angular screen must not
 * send the true/false dropdown it used to.
 */
const outletAdminListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({
    ...listQuery,
    chain: objectId,
    status: chainStatus,
  }),
};

/** Admin staff registry filters. Status is the assignment state, not a boolean. */
const staffAdminListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({
    ...listQuery,
    chain: objectId,
    outlet: objectId,
    role: staffRole,
    status: Joi.string().valid('active', 'inactive', 'suspended'),
  }),
};

/**
 * Admin policy registry filters. `status` arrives as a boolean query string
 * and maps to the model's `isActive`, because the shared admin list base
 * sends every status filter as `status`.
 */
const policyAdminListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({
    ...listQuery,
    chain: objectId,
    outlet: objectId,
    type: Joi.string().valid(
      'return', 'exchange', 'warranty', 'cancellation', 'delivery', 'privacy', 'terms'
    ),
    status: Joi.boolean(),
  }),
};

/** Admin featured-placement registry filters. Status is the billing lifecycle. */
const featuredAdminListValidation = {
  params: Joi.object().keys({}).unknown(true),
  query: Joi.object().keys({
    ...listQuery,
    chain: objectId,
    outlet: objectId,
    status: Joi.string().valid(
      'pending_payment', 'paid', 'approved', 'rejected', 'live', 'expired'
    ),
  }),
};

// ---------------------------------------------------------------------------
// payment initiation (gateway subjects)
// ---------------------------------------------------------------------------
// The gateway checkout (`makePayment`) and the callbacks read the
// PaymentInitiation row generically, so the only contract these routes must
// hold is: which order/payment-row is being paid, and through which
// PaymentConfig (gateway). `amount` is NEVER accepted from the client — the
// service re-reads it from the order / subscription payment row.

const orderPayValidation = {
  params: Joi.object().keys({ order: objectId.required() }).unknown(true),
  body: Joi.object()
    .keys({
      payment: objectId.required(),
      paymentRef: Joi.string().trim().max(120),
    })
    .required(),
};

const subscriptionPayValidation = {
  body: Joi.object()
    .keys({
      subscription: objectId.required(),
      payment: objectId.required(),
      paymentMethod: Joi.string().valid('card', 'upi', 'netbanking', 'wallet').required(),
      paymentRef: Joi.string().trim().max(120),
    })
    .required(),
};

// ---------------------------------------------------------------------------
// remittance
// ---------------------------------------------------------------------------
const remittanceSubmitValidation = {
  params: Joi.object({ remittance: objectId.required() }).required(),
  body: Joi.object({
    collected: money.required(),
    remitted: money.required(),
    notes: Joi.string().trim().max(500).allow('', null),
  }).required(),
};

const remittanceReconcileValidation = {
  params: Joi.object({ remittance: objectId.required() }).required(),
  body: Joi.object({
    notes: Joi.string().trim().max(500).allow('', null),
  }).required(),
};

const remittanceListValidation = {
  params: Joi.object({}).unknown(true),
  query: Joi.object({
    ...listQuery,
    driver: objectId,
    status: Joi.string().valid('pending', 'reconciled', 'disputed'),
    dateFrom: Joi.date(),
    dateTo: Joi.date(),
  }),
};

// ---------------------------------------------------------------------------
// warranty
// ---------------------------------------------------------------------------
// The warranty lifecycle is driven by explicit transitions (BR-21).
const warrantyCreateValidation = {
  body: Joi.object({
    order: objectId.required(),
    product: objectId.required(),
    variant: objectId.required(),
    productName: Joi.string().trim().max(200).required(),
    sku: Joi.string().trim().max(80).allow('', null),
    warrantyType: Joi.string().valid('manufacturer', 'store', 'manufacturer_service_centre').required(),
    warrantyMonths: Joi.number().integer().min(1).max(120).required(),
    purchaseDate: Joi.date().required(),
    warrantyExpiryDate: Joi.date().required(),
    issueDescription: Joi.string().trim().max(2000).required(),
    issueCategory: Joi.string().valid('manufacturing_defect', 'parts_failure', 'electrical_issue', 'physical_damage', 'other'),
    images: Joi.array().items(Joi.string()).max(10).optional(),
    documents: Joi.array().items(Joi.string()).max(10).optional(),
  }).required(),
};

const warrantyTransitionValidation = {
  params: Joi.object({ warranty: objectId.required() }).required(),
  body: Joi.object({
    status: Joi.string().valid('approved', 'rejected', 'in_repair', 'resolved', 'closed', 'cancelled').required(),
    notes: Joi.string().trim().max(500).allow('', null),
    resolution: Joi.string().valid('repaired', 'replaced', 'refunded', 'rejected', 'pending'),
    resolutionNotes: Joi.string().trim().max(500),
    serviceCentreName: Joi.string().trim().max(200),
    serviceCentreAddress: Joi.string().trim().max(500),
    serviceCentreContact: Joi.string().trim().max(100),
    repairCost: money,
    costBearer: Joi.string().valid('manufacturer', 'store', 'customer', 'shared'),
  }).required(),
};

const warrantyListValidation = {
  params: Joi.object({}).unknown(true),
  query: Joi.object({
    ...listQuery,
    status: Joi.string().valid('requested', 'approved', 'rejected', 'in_repair', 'resolved', 'closed', 'cancelled'),
    customer: objectId,
  }),
};

// ---------------------------------------------------------------------------
// customer subscriptions (recurring)
// ---------------------------------------------------------------------------
// The customer subscription lifecycle (BR-16, §6.18).
const customerSubscriptionCreateValidation = {
  body: Joi.object({
    // `outlet` is REQUIRED here, not taken from the session.
    //
    // This route is guarded by `appAuth`, i.e. a CUSTOMER token, so `req.outletId` is
    // undefined. The handler used to read the outlet from the session and the schema did
    // not accept one in the body — so a customer could neither supply nor inherit an
    // outlet, and every subscription they created was orphaned: undeliverable, invisible
    // to the store, and absent from `getUpcoming`. The outlet is the one thing only the
    // caller can know, because it is the store they are subscribing at.
    outlet: objectId.required(),
    // Optional: derived from the outlet's chain when omitted, so a client that only has
    // the store does not have to know the chain id as well.
    chain: objectId,
    plan: objectId,
    items: Joi.array().items(
      Joi.object({
        variant: objectId.required(),
        quantity: Joi.number().integer().min(1).max(99).required(),
        name: Joi.string().trim().max(200),
        unitPriceAtSubscribe: money,
      })
    ).min(1).required(),
    cadence: Joi.string().valid('weekly', 'biweekly', 'monthly', 'custom').required(),
    intervalCount: Joi.number().integer().min(1).max(100),
    deliveryDayOfWeek: Joi.number().integer().min(0).max(6).required(),
    deliverySlot: Joi.object({
      startTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
      endTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
    }).required(),
    address: objectId.required(),
    discountPercentage: Joi.number().min(0).max(100),
    substitutionPolicy: Joi.string().valid('none', 'same_category', 'same_brand', 'store_choice'),
    priceLockPolicy: Joi.string().valid('notify_and_confirm', 'charge_current_price'),
    startDate: Joi.date().required(),
    endDate: Joi.date().allow(null),
    editCutoffHours: Joi.number().integer().min(0).max(48),
    skipDates: Joi.array().items(Joi.date()),
  }).required(),
};

const customerSubscriptionTransitionValidation = {
  params: Joi.object({ subscription: objectId.required() }).required(),
  body: Joi.object({
    notes: Joi.string().trim().max(500),
  }).required(),
};

const customerSubscriptionSkipValidation = {
  params: Joi.object({ subscription: objectId.required() }).required(),
  body: Joi.object({
    reason: Joi.string().trim().max(500).required(),
  }).required(),
};

const customerSubscriptionPauseValidation = {
  params: Joi.object({ subscription: objectId.required() }).required(),
  body: Joi.object({
    reason: Joi.string().trim().max(500).required(),
  }).required(),
};

const customerSubscriptionCancelValidation = {
  params: Joi.object({ subscription: objectId.required() }).required(),
  body: Joi.object({
    reason: Joi.string().trim().max(500).required(),
  }).required(),
};

// ---------------------------------------------------------------------------
// policies
// ---------------------------------------------------------------------------
const policyCreateValidation = {
  params: Joi.object({}).unknown(true),
  body: Joi.object({
    type: Joi.string().valid('return', 'exchange', 'warranty', 'cancellation', 'delivery', 'privacy', 'terms').required(),
    title: Joi.string().trim().max(200).required(),
    content: Joi.string().trim().max(10000).required(),
    returnWindowDays: Joi.number().integer().min(0).max(365),
    exchangeWindowDays: Joi.number().integer().min(0).max(365),
    warrantyDefaultMonths: Joi.number().integer().min(0).max(120),
    cancellationWindowHours: Joi.number().integer().min(0).max(720),
    effectiveFrom: Joi.date(),
    effectiveTo: Joi.date().allow(null),
  }).required(),
};

const policyUpdateValidation = {
  params: Joi.object({ policy: objectId.required() }).required(),
  body: Joi.object({
    title: Joi.string().trim().max(200),
    content: Joi.string().trim().max(10000),
    returnWindowDays: Joi.number().integer().min(0).max(365),
    exchangeWindowDays: Joi.number().integer().min(0).max(365),
    warrantyDefaultMonths: Joi.number().integer().min(0).max(120),
    cancellationWindowHours: Joi.number().integer().min(0).max(720),
    effectiveFrom: Joi.date(),
    effectiveTo: Joi.date().allow(null),
    isActive: Joi.boolean(),
    version: Joi.number().integer().min(1),
  }).required(),
};

const policyListValidation = {
  params: Joi.object({}).unknown(true),
  query: Joi.object({
    ...listQuery,
    type: Joi.string().valid('return', 'exchange', 'warranty', 'cancellation', 'delivery', 'privacy', 'terms'),
    isActive: Joi.boolean(),
  }),
};

// ---------------------------------------------------------------------------
// featured placements
// ---------------------------------------------------------------------------
const featuredPlacementCreateValidation = {
  params: Joi.object({}).unknown(true),
  body: Joi.object({
    subjectType: Joi.string().valid('store', 'product', 'banner').required(),
    outlet: objectId.required(),
    chain: objectId.required(),
    product: objectId,
    slot: Joi.string().trim().max(50).required(),
    startsAt: Joi.date().required(),
    endsAt: Joi.date().required(),
    amount: money.required(),
  }).required(),
};

const featuredPlacementUpdateValidation = {
  params: Joi.object({ placement: objectId.required() }).required(),
  body: Joi.object({
    slot: Joi.string().trim().max(50),
    startsAt: Joi.date(),
    endsAt: Joi.date(),
    amount: money,
    status: Joi.string().valid('pending_payment', 'paid', 'approved', 'rejected', 'live', 'expired'),
    invoice: Joi.string().trim().max(100).allow('', null),
  }).required(),
};

const featuredPlacementListValidation = {
  params: Joi.object({}).unknown(true),
  query: Joi.object({
    ...listQuery,
    subjectType: Joi.string().valid('store', 'product', 'banner'),
    status: Joi.string().valid('pending_payment', 'paid', 'approved', 'rejected', 'live', 'expired'),
    slot: Joi.string().trim().max(50),
  }),
};

const featuredPlacementTransitionValidation = {
  params: Joi.object({ placement: objectId.required() }).required(),
  body: Joi.object({
    notes: Joi.string().trim().max(500).allow('', null),
  }).required(),
};

// ---------------------------------------------------------------------------
// complaints
// ---------------------------------------------------------------------------
const complaintCreateValidation = {
  params: Joi.object({}).unknown(true),
  body: Joi.object({
    order: objectId,
    product: objectId,
    category: Joi.string().valid('quality', 'delivery', 'staff_behaviour', 'billing', 'wrong_item', 'missing_item', 'other').required(),
    subject: Joi.string().trim().max(200).required(),
    description: Joi.string().trim().max(5000).required(),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    images: Joi.array().items(Joi.string()).max(10).optional(),
    attachments: Joi.array().items(Joi.string()).max(10).optional(),
  }).required(),
};

const complaintTransitionValidation = {
  params: Joi.object({ complaint: objectId.required() }).required(),
  body: Joi.object({
    status: Joi.string().valid('open', 'in_progress', 'resolved', 'closed', 'escalated').required(),
    resolution: Joi.string().valid('refunded', 'replaced', 'apology', 'no_action', 'pending'),
    resolutionNotes: Joi.string().trim().max(500),
    escalatedTo: objectId,
  }).required(),
};

const complaintListValidation = {
  params: Joi.object({}).unknown(true),
  query: Joi.object({
    ...listQuery,
    status: Joi.string().valid('open', 'in_progress', 'resolved', 'closed', 'escalated'),
    category: Joi.string().valid('quality', 'delivery', 'staff_behaviour', 'billing', 'wrong_item', 'missing_item', 'other'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    customer: objectId,
  }),
};

module.exports = {
  onboardingDraftValidation,
  submitValidation,
  applicationIdValidation,
  applicationListValidation,
  requestChangesValidation,
  rejectValidation,
  chainIdValidation,
  outletIdValidation,
  sessionOutletSwitchValidation,
  outletListValidation,
  outletStatusChangeValidation,
  chainStatusChangeValidation,
  staffRoleValidation,
  staffRoleBoundary,
  staffListValidation,
  staffUpdateValidation,
  complianceDocumentValidation,
  complianceReviewValidation,
  categoryValidation,
  taxConfigurationValidation,
  taxConfigurationQueryValidation,
  chainsAdminListValidation,
  outletAdminListValidation,
  staffAdminListValidation,
  policyAdminListValidation,
  featuredAdminListValidation,

  // -- customer (§7.2) -------------------------------------------------
  // These had no Joi at all; malformed bodies failed deep in Mongoose as CastErrors.
  cartAddValidation,
  cartUpdateValidation,
  cartRemoveValidation,
  cartOutletValidation,
  orderCreateValidation,
  customerOrderIdValidation: orderIdValidation,
  orderPayValidation,
  subscriptionPayValidation,
  pickItemValidation,
  packingCompleteValidation,
  remittanceSubmitValidation,
  remittanceReconcileValidation,
  remittanceListValidation,
  warrantyCreateValidation,
  warrantyTransitionValidation,
  warrantyListValidation,
  customerSubscriptionCreateValidation,
  customerSubscriptionTransitionValidation,
  customerSubscriptionSkipValidation,
  customerSubscriptionPauseValidation,
  customerSubscriptionCancelValidation,
  policyCreateValidation,
  policyUpdateValidation,
  policyListValidation,
  featuredPlacementCreateValidation,
  featuredPlacementUpdateValidation,
  featuredPlacementListValidation,
  featuredPlacementTransitionValidation,
  complaintCreateValidation,
  complaintTransitionValidation,
  complaintListValidation,

  // -- catalog -------------------------------------------------------
  productListValidation: Joi.object({
    category: objectId,
    subcategory: objectId,
    brand: objectId,
    search: Joi.string().trim(),
    facetKeys: Joi.array().items(Joi.string()),
    inStockOnly: Joi.boolean(),
    organicOnly: Joi.boolean(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().valid('name', 'newest', 'price_asc', 'price_desc').default('name'),
  }),
  productCreateValidation: Joi.object({
    category: objectId.required(),
    subcategory: objectId,
    brand: objectId,
    name: Joi.string().trim().required().max(200),
    description: Joi.string().trim().max(2000),
    images: Joi.array().items(Joi.string()).default([]),
    hasVariants: Joi.boolean().default(false),
    variantAxes: Joi.array().items(objectId),
    basePrice: Joi.number().min(0),
    baseMrp: Joi.number().min(0),
    tax: Joi.string().valid('inclusive', 'exclusive', 'none').default('inclusive'),
    taxPercentage: Joi.number().min(0).max(100).default(0),
    hsn: Joi.string().trim(),
    tags: Joi.array().items(Joi.string()).default([]),
    searchTerms: Joi.array().items(Joi.string()).default([]),
    isOrganic: Joi.boolean().default(false),
    warranty: Joi.object({
      months: Joi.number().integer().min(0),
      provider: Joi.string(),
      terms: Joi.string(),
      type: Joi.string().valid('manufacturer', 'store', 'manufacturer_service_centre'),
    }),
  }),
  productUpdateValidation: Joi.object({
    name: Joi.string().trim().max(200),
    description: Joi.string().trim().max(2000),
    images: Joi.array().items(Joi.string()),
    hasVariants: Joi.boolean(),
    variantAxes: Joi.array().items(objectId),
    basePrice: Joi.number().min(0),
    baseMrp: Joi.number().min(0),
    tax: Joi.string().valid('inclusive', 'exclusive', 'none'),
    taxPercentage: Joi.number().min(0).max(100),
    hsn: Joi.string().trim(),
    tags: Joi.array().items(Joi.string()),
    searchTerms: Joi.array().items(Joi.string()),
    isOrganic: Joi.boolean(),
    warranty: Joi.object({
      months: Joi.number().integer().min(0),
      provider: Joi.string(),
      terms: Joi.string(),
      type: Joi.string().valid('manufacturer', 'store', 'manufacturer_service_centre'),
    }),
    status: Joi.string().valid('active', 'inactive', 'archived'),
  }),
  variantGenerateValidation: Joi.object({
    selections: Joi.object().pattern(Joi.string(), Joi.array().items(Joi.string())).required(),
    priceMatrix: Joi.object().pattern(Joi.string(), Joi.number().min(0)),
    combinationLimit: Joi.number().integer().min(1).max(1000).default(200),
  }),
  productFormQueryValidation: Joi.object({
    category: objectId,
    subcategory: objectId,
  }),

  // -- inventory -----------------------------------------------------
  stockAdjustValidation: Joi.object({
    variant: objectId.required(),
    product: objectId.required(),
    type: Joi.string().valid('STOCK_ADDED', 'STOCK_REMOVED', 'ADJUSTMENT', 'DAMAGED', 'EXPIRED').required(),
    quantity: Joi.number().integer().min(1).required(),
    reason: Joi.string().trim().max(500),
    notes: Joi.string().trim().max(1000),
  }),
  stockListValidation: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
  movementListValidation: Joi.object({
    variant: objectId,
    limit: Joi.number().integer().min(1).max(200).default(50),
  }),

  // -- admin product / inventory (cross-tenant reads, no outlet scope) ----
  // Admin reads intentionally omit `outlet`: an admin investigating a dispute
  // needs the product regardless of which chain it belongs to. BR-38 still
  // applies to partner writes; the admin side never has tenant scope.
  productAdminList: Joi.object({
    ...listQuery,
    category: objectId,
    subcategory: objectId,
    brand: objectId,
    chain: objectId,
    outlet: objectId,
    status: Joi.string().valid('active', 'inactive', 'archived'),
    approval: Joi.string().valid('not_required', 'pending', 'approved', 'rejected'),
  }),
  productApproval: Joi.object({
    product: objectId.required(),
    status: Joi.string().valid('approved', 'rejected').required(),
    note: Joi.string().trim().max(1000),
  }),
  inventoryStockList: Joi.object({
    ...listQuery,
    outlet: objectId,
    chain: objectId,
    product: objectId,
    variant: objectId,
    lowOnly: Joi.boolean(),
  }),
  inventoryMovementList: Joi.object({
    ...listQuery,
    outlet: objectId,
    chain: objectId,
    product: objectId,
    variant: objectId,
    from: Joi.date(),
    to: Joi.date(),
  }),

  // -- orders --------------------------------------------------------
  orderListValidation: Joi.object({
    lifecycle: Joi.string().valid('created', 'payment_pending', 'paid', 'store_received', 'accepted', 'picking', 'packing', 'ready', 'driver_assigned', 'picked_up', 'out_for_delivery', 'delivered', 'completed', 'rejected', 'cancelled', 'payment_failed'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
  orderIdValidation: Joi.object({
    order: objectId.required(),
  }),

  // -- subscription --------------------------------------------------
  subscriptionPlanValidation: Joi.object({
    name: Joi.string().trim().required().max(100),
    description: Joi.string().trim().max(500),
    amount: Joi.number().min(0).required(),
    billingPeriod: Joi.string().valid('monthly', 'quarterly', 'yearly').default('monthly'),
    trialDays: Joi.number().integer().min(0).default(0),
    features: Joi.array().items(Joi.string()).default([]),
    maxOutlets: Joi.number().integer().min(1).default(1),
    maxProducts: Joi.number().integer().min(1).default(100),
    maxStaff: Joi.number().integer().min(1).default(5),
    isDefault: Joi.boolean().default(false),
  }),

  // -- delivery ------------------------------------------------------
  deliveryAssignValidation: Joi.object({
    order: objectId.required(),
    driver: objectId.required(),
    deliveryFee: Joi.number().min(0).default(0),
    estimatedMinutes: Joi.number().integer().min(1).default(30),
  }),
  deliveryOtpValidation: Joi.object({
    otp: Joi.string().length(6).required(),
  }),
  deliveryCodValidation: Joi.object({
    amount: Joi.number().min(0).required(),
  }),

  // -- returns/exchanges ---------------------------------------------
  returnCreateValidation: Joi.object({
    order: objectId.required(),
    items: Joi.array().items(Joi.object({
      product: objectId.required(),
      variant: objectId.required(),
      name: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
      unitPrice: Joi.number().min(0).required(),
      refundAmount: Joi.number().min(0).required(),
      reason: Joi.string().required(),
      condition: Joi.string().valid('unopened', 'opened_unused', 'defective', 'damaged', 'wrong_item', 'other'),
      notes: Joi.string(),
    })).min(1).required(),
    reason: Joi.string().required(),
    reasonCategory: Joi.string().valid('defective', 'wrong_item', 'damaged_in_delivery', 'not_as_described', 'changed_mind', 'other'),
    images: Joi.array().items(Joi.string()).default([]),
    notes: Joi.string(),
  }),
  exchangeCreateValidation: Joi.object({
    order: objectId.required(),
    items: Joi.array().items(Joi.object({
      originalProduct: objectId.required(),
      originalVariant: objectId.required(),
      exchangeForProduct: objectId.required(),
      exchangeForVariant: objectId.required(),
      quantity: Joi.number().integer().min(1).required(),
      priceDifference: Joi.number().default(0),
      reason: Joi.string().required(),
      condition: Joi.string().valid('unopened', 'opened_unused', 'defective', 'damaged', 'wrong_item', 'other'),
    })).min(1).required(),
    reason: Joi.string().required(),
    reasonCategory: Joi.string().valid('defective', 'wrong_item', 'damaged_in_delivery', 'not_as_described', 'size_fit', 'changed_mind', 'other'),
    images: Joi.array().items(Joi.string()).default([]),
    notes: Joi.string(),
  }),

  // -- promotions ----------------------------------------------------
  promotionCreateValidation: Joi.object({
    name: Joi.string().trim().required().max(200),
    description: Joi.string().trim().max(1000),
    type: Joi.string().valid('percent_off', 'fixed_off', 'min_order_offer', 'free_delivery', 'product_discount').required(),
    value: Joi.number().min(0).required(),
    maxDiscount: Joi.number().min(0),
    minOrderAmount: Joi.number().min(0).default(0),
    applicableProducts: Joi.array().items(objectId).default([]),
    applicableCategories: Joi.array().items(objectId).default([]),
    applicableVariants: Joi.array().items(objectId).default([]),
    code: Joi.string().trim().uppercase().max(20),
    usageLimit: Joi.number().integer().min(0).default(0),
    perCustomerLimit: Joi.number().integer().min(1).default(1),
    startsAt: Joi.date().required(),
    endsAt: Joi.date().greater(Joi.ref('startsAt')).required(),
  }),
  promotionValidateValidation: Joi.object({
    code: Joi.string().trim().uppercase().required(),
    cartAmount: Joi.number().min(0).required(),
  }),

  // -- reviews -------------------------------------------------------
  reviewCreateValidation: Joi.object({
    order: objectId,
    product: objectId,
    variant: objectId,
    rating: Joi.number().integer().min(1).max(5).required(),
    title: Joi.string().trim().max(200),
    comment: Joi.string().trim().max(2000),
    images: Joi.array().items(Joi.string()).default([]),
  }),
  reviewModerateValidation: Joi.object({
    status: Joi.string().valid('approved', 'rejected', 'archived').required(),
    reply: Joi.object({
      text: Joi.string().trim().max(1000).required(),
      repliedBy: objectId.required(),
    }),
  }),

  // -- drivers -------------------------------------------------------
  driverCreateValidation: Joi.object({
    user: objectId.required(),
    driverCode: Joi.string().trim().required().max(20),
    vehicle: objectId,
    licenseNumber: Joi.string().trim().required().max(50),
    licenseExpiry: Joi.date().required(),
    aadhaarLast4: Joi.string().length(4),
    panNumber: Joi.string().trim().max(10),
    bankDetails: Joi.object({
      accountName: Joi.string(),
      accountNumber: Joi.string(),
      ifsc: Joi.string(),
      bankName: Joi.string(),
    }),
    payoutMode: Joi.string().valid('business_pays', 'driver_pays').default('business_pays'),
  }),
  driverUpdateValidation: Joi.object({
    vehicle: objectId,
    licenseNumber: Joi.string().trim().max(50),
    licenseExpiry: Joi.date(),
    bankDetails: Joi.object({
      accountName: Joi.string(),
      accountNumber: Joi.string(),
      ifsc: Joi.string(),
      bankName: Joi.string(),
    }),
    payoutMode: Joi.string().valid('business_pays', 'driver_pays'),
    isAvailable: Joi.boolean(),
  }),

  // -- settlement ----------------------------------------------------
  settlementListValidation: Joi.object({
    status: Joi.string().valid('pending', 'processing', 'settled', 'failed', 'reversed', 'disputed'),
    period: Joi.string().valid('daily', 'weekly', 'monthly', 'custom'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
  settlementGenerateValidation: Joi.object({
    store: objectId.required(),
    period: Joi.string().valid('daily', 'weekly', 'monthly', 'custom').required(),
    from: Joi.date().required(),
    to: Joi.date().greater(Joi.ref('from')).required(),
  }),
};