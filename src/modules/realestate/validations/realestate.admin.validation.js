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

const setPropertyStatus = {
  params: Joi.object().keys({
    id: objectId.required(),
    status: Joi.string()
      .valid('IN_REVIEW', 'APPROVED', 'PUBLISHED', 'CHANGES_REQUIRED', 'REJECTED', 'SUSPENDED', 'EXPIRED', 'ARCHIVED')
      .required(),
  }),
};

const forfeitHold = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    requestedBy: objectId.required(),
    reason: Joi.string().allow('').optional(),
  }),
};

const createCommissionRule = {
  body: Joi.object().keys({
    type: Joi.string()
      .valid('PROPERTY_SALE', 'BANK_LOAN', 'CUSTOMER_REFERRAL', 'EXECUTIVE', 'HOLD_FEE', 'LISTING_PACKAGE', 'PROMOTION')
      .required(),
    name: Joi.string().required(),
    rate: Joi.number().min(0).max(100).required(),
    calculationBasis: Joi.string()
      .valid('SALE_VALUE', 'LOCALWALA_COMMISSION', 'LOAN_DISBURSED', 'SANCTION_AMOUNT', 'FIXED_AMOUNT', 'HOLD_PRINCIPAL', 'FLAT')
      .required(),
    slabFrom: Joi.number().min(0).optional(),
    slabTo: Joi.number().min(0).allow(null).optional(),
    effectiveFrom: Joi.date().required(),
    effectiveTo: Joi.date().allow(null).optional(),
  }),
};

const commissionRuleIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const updateCommissionRule = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(1).max(120).optional(),
      rate: Joi.number().min(0).max(100).optional(),
      calculationBasis: Joi.string()
        .valid('SALE_VALUE', 'LOCALWALA_COMMISSION', 'LOAN_DISBURSED', 'SANCTION_AMOUNT', 'FIXED_AMOUNT', 'HOLD_PRINCIPAL', 'FLAT')
        .optional(),
      slabFrom: Joi.number().min(0).allow(0).optional(),
      slabTo: Joi.number().min(0).allow(null).optional(),
      minAmount: Joi.number().min(0).allow(0).optional(),
      maxAmount: Joi.number().min(0).allow(0).optional(),
      effectiveFrom: Joi.date().optional(),
      effectiveTo: Joi.date().allow(null).optional(),
    })
    .unknown(false),
};

const retireCommissionRule = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    effectiveTo: Joi.date().allow(null).optional(),
  }),
};

const generateSettlement = {
  body: Joi.object().keys({
    partyType: Joi.string().valid('VENDOR', 'EXECUTIVE', 'REFERRER', 'BANK', 'LOCALWALA').required(),
    party: objectId.allow(null).optional(),
    periodFrom: Joi.date().required(),
    periodTo: Joi.date().required(),
    entryIds: Joi.array().items(objectId).min(1).required(),
    tdsPercent: Joi.number().min(0).max(100).optional(),
  }),
};

// Settlement workflow (plan §5.11). Target state is a route parameter,
// allow-listed here AND in the service machine — the same shape as
// property moderation (BR-03). `payoutReference` is only read on PAID.
const setSettlementStatus = {
  params: Joi.object().keys({
    id: objectId.required(),
    status: Joi.string()
      .valid('VERIFIED', 'EARNED', 'SETTLEMENT_CREATED', 'PAID')
      .required(),
  }),
  body: Joi.object().keys({
    payoutReference: Joi.string().trim().max(200).allow('', null).optional(),
  }),
};

const verifyDocument = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({ decision: Joi.string().valid('ACCEPTED', 'REJECTED').required() }),
};

// ---------------------------------------------------------------- categories
//
// Admin CRUD for the property-category catalogue. Categories seed
// `specSchema` for the runtime property-write validator (plan §7), so
// the request shape must carry the descriptors and the body validator
// checks them before the service touches the database.

const specField = Joi.object().keys({
  key: Joi.string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .required()
    .messages({ 'string.pattern.base': 'key must be UPPER_SNAKE_CASE and start with a letter' }),
  label: Joi.string().required(),
  type: Joi.string().valid('NUMBER', 'STRING', 'TEXT', 'ENUM', 'BOOLEAN', 'DATE').required(),
  required: Joi.boolean().default(false),
  unit: Joi.string().allow('').optional(),
  min: Joi.number().optional(),
  max: Joi.number().optional(),
  options: Joi.array().items(Joi.string()).optional(),
});

const specSchema = Joi.object().keys({
  fields: Joi.array().items(specField).min(1).required(),
});

const categoryUpsert = {
  body: Joi.object().keys({
    key: Joi.string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .required()
      .messages({ 'string.pattern.base': 'key must be UPPER_SNAKE_CASE and start with a letter' }),
    name: Joi.string().required().trim(),
    group: Joi.string()
      .valid('APARTMENT', 'HOUSE', 'VILLA', 'PLOT', 'COMMERCIAL')
      .required(),
    description: Joi.string().allow('').optional(),
    icon: Joi.string().allow('').optional(),
    transactionTypes: Joi.array().items(Joi.string().valid('BUY', 'RENT')).optional(),
    amenityOptions: Joi.array().items(Joi.string()).optional(),
    sortOrder: Joi.number().optional(),
    status: Joi.boolean().optional(),
    specSchema,
  }),
};

const categoryIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const categoryListQuery = {
  query: Joi.object().keys({
    status: Joi.string().valid('true', 'false').optional(),
    group: Joi.string().optional(),
  }),
};

// Hold policy editor (plan §10.2 row 20). Partial — every field is
// optional because the editor only sends what the operator changed.
// Booleans default to their schema values; numbers carry their own
// min/max; `cancellationFeeBorneBy` is the OD-02 enum.

const holdPolicyPatch = {
  body: Joi.object()
    .keys({
      name: Joi.string().trim().max(120).optional(),
      principalAmount: Joi.number().min(0).optional(),
      serviceFeePercent: Joi.number().min(0).max(100).optional(),
      serviceFeeMin: Joi.number().min(0).allow(0).optional(),
      serviceFeeMax: Joi.number().min(0).allow(0).optional(),
      durationDays: Joi.number().integer().min(1).max(180).optional(),
      gracePeriodHours: Joi.number().integer().min(0).max(168).optional(),
      cancellationRefundable: Joi.boolean().optional(),
      expiryRefundable: Joi.boolean().optional(),
      feeRefundableOnListingWithdrawal: Joi.boolean().optional(),
      forfeitureRequiresDualControl: Joi.boolean().optional(),
      cancellationFeeBorneBy: Joi.string().valid('CUSTOMER', 'VENDOR').optional(),
      effectiveFrom: Joi.date().optional(),
      effectiveTo: Joi.date().allow(null).optional(),
      // OD-01 custody (operator draft/edit; approve/activate via workflow).
      custodyMode: Joi.string().valid('ESCROW', 'CUSTODIAL', 'PLATFORM_CURRENT').optional(),
      custodianBankReference: Joi.string().trim().max(200).allow('', null).optional(),
      accountIdentifier: Joi.string().trim().max(200).allow('', null).optional(),
      principalReleaseConditions: Joi.string().trim().max(2000).allow('', null).optional(),
      refundSLA: Joi.string().trim().max(200).allow('', null).optional(),
      reconciliationFrequency: Joi.string().trim().max(100).allow('', null).optional(),
      supportingDocuments: Joi.array().items(Joi.string().trim().max(500)).optional(),
      custodyApprovalStatus: Joi.string().valid('pending', 'approved', 'rejected').optional(),
      custodyEffectiveDate: Joi.date().allow(null).optional(),
      custodyApprovalReference: Joi.string().trim().max(200).allow('', null).optional(),
      custodyConfigurationVersion: Joi.string().trim().max(50).optional(),
      custodyChangeReason: Joi.string().trim().max(2000).allow('', null).optional(),
      custodyAccount: Joi.string().trim().max(200).allow('', null).optional(),
      approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
      configurationVersion: Joi.string().trim().max(50).optional(),
      changeReason: Joi.string().trim().max(2000).allow('', null).optional(),
    })
    .unknown(false),
};

const holdPolicyIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const holdPolicyNewVersion = {
  body: Joi.object().keys({
    name: Joi.string().trim().max(120).allow('', null).optional(),
    changeReason: Joi.string().trim().max(2000).allow('', null).optional(),
  }),
};

const holdPolicySubmit = {
  body: Joi.object().keys({
    changeReason: Joi.string().trim().max(2000).allow('', null).optional(),
    supportingDocuments: Joi.array().items(Joi.string().trim().max(500)).optional(),
  }),
};

// Approval cases (Phase A). Approve/reject/comment carry the approve
// right; SoD (requester ≠ approver) is enforced in the service.
const approvalCaseIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const approvalCaseListQuery = {
  query: Joi.object().keys({
    status: Joi.string()
      .valid('REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ACTIVATED')
      .optional(),
    category: Joi.string()
      .valid('HOLD_POLICY', 'BANK_AGREEMENT', 'COMMISSION_RULE', 'TAX_CONFIG', 'CUSTODY_CONFIG')
      .optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

const approvalCaseDecide = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    note: Joi.string().trim().max(2000).allow('', null).optional(),
    approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
  }),
};

const approvalCaseReject = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    note: Joi.string().trim().max(2000).required(),
  }),
};

const approvalCaseComment = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    text: Joi.string().trim().min(1).max(2000).required(),
  }),
};

const holdPolicyApprove = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    approvedBy: objectId.optional(),
    approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
    changeReason: Joi.string().trim().max(2000).allow('', null).optional(),
  }),
};

const taxSupplyPatch = {
  params: Joi.object().keys({
    id: objectId.required(),
    supply: Joi.string().valid('holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee').required(),
  }),
  body: Joi.object()
    .keys({
      hsnSac: Joi.string().trim().max(50).allow('', null).optional(),
      taxClassification: Joi.string().trim().max(100).allow('', null).optional(),
      applicableRate: Joi.number().min(0).max(100).allow(null).optional(),
      invoiceTreatment: Joi.string().trim().max(500).allow('', null).optional(),
      taxComponents: Joi.string().trim().max(200).allow('', null).optional(),
      inclusivePricing: Joi.boolean().optional(),
      effectiveFrom: Joi.date().optional(),
      effectiveTo: Joi.date().allow(null).optional(),
      approvalStatus: Joi.string().valid('pending', 'approved', 'rejected').optional(),
      approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
      configurationVersion: Joi.string().trim().max(50).optional(),
      changeReason: Joi.string().trim().max(2000).allow('', null).optional(),
    })
    .unknown(false),
};

const settingsPatch = {
  body: Joi.object().keys({
    enabled: Joi.boolean().optional(),
    enquiryRequiresContactVerified: Joi.boolean().optional(),
    autoAssignVisitRequests: Joi.boolean().optional(),
    defaultCheckInRadiusMeters: Joi.number().min(1).optional(),
    defaultHoldDurationDays: Joi.number().min(1).optional(),
    searchMaxRadiusKm: Joi.number().min(1).optional(),
    listingMaxImages: Joi.number().min(1).optional(),
    listingMaxVideos: Joi.number().min(0).optional(),
    documentMaxSizeBytes: Joi.number().min(1).optional(),
    customerCanRequestLoan: Joi.boolean().optional(),
    customerCanHoldProperty: Joi.boolean().optional(),
    referralCommissionEnabled: Joi.boolean().optional(),
    promotionsEnabled: Joi.boolean().optional(),
    notificationsEnabled: Joi.boolean().optional(),
    holdCustody: Joi.object()
      .keys({
        custodyMode: Joi.string().valid('ESCROW', 'CUSTODIAL', 'PLATFORM_CURRENT').optional(),
        custodianBankReference: Joi.string().trim().max(200).allow('', null).optional(),
        accountIdentifier: Joi.string().trim().max(200).allow('', null).optional(),
        principalReleaseConditions: Joi.string().trim().max(2000).allow('', null).optional(),
        refundSLA: Joi.string().trim().max(200).allow('', null).optional(),
        reconciliationFrequency: Joi.string().trim().max(100).allow('', null).optional(),
        supportingDocuments: Joi.array().items(Joi.string().trim().max(500)).optional(),
        status: Joi.string().valid('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED').optional(),
        approvedBy: objectId.allow(null).optional(),
        approvedAt: Joi.date().allow(null).optional(),
        effectiveFrom: Joi.date().allow(null).optional(),
        effectiveTo: Joi.date().allow(null).optional(),
        approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
        configurationVersion: Joi.string().trim().max(50).optional(),
        changeReason: Joi.string().trim().max(2000).allow('', null).optional(),
      })
      .optional(),
    taxInvoicing: Joi.object()
      .keys({
        holdServiceFee: Joi.object()
          .keys({
            hsnSac: Joi.string().trim().max(50).allow('', null).optional(),
            taxClassification: Joi.string().trim().max(100).allow('', null).optional(),
            approvedRate: Joi.number().min(0).max(100).allow(null).optional(),
            invoiceTreatment: Joi.string().trim().max(500).allow('', null).optional(),
            taxComponents: Joi.string().trim().max(200).allow('', null).optional(),
            inclusivePricing: Joi.boolean().optional(),
            effectiveFrom: Joi.date().allow(null).optional(),
            effectiveTo: Joi.date().allow(null).optional(),
            approvalStatus: Joi.string().valid('pending', 'approved', 'rejected').optional(),
            approvedBy: objectId.allow(null).optional(),
            approvedAt: Joi.date().allow(null).optional(),
            approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
          })
          .optional(),
        propertySaleCommission: Joi.object()
          .keys({
            hsnSac: Joi.string().trim().max(50).allow('', null).optional(),
            taxClassification: Joi.string().trim().max(100).allow('', null).optional(),
            approvedRate: Joi.number().min(0).max(100).allow(null).optional(),
            invoiceTreatment: Joi.string().trim().max(500).allow('', null).optional(),
            taxComponents: Joi.string().trim().max(200).allow('', null).optional(),
            inclusivePricing: Joi.boolean().optional(),
            effectiveFrom: Joi.date().allow(null).optional(),
            effectiveTo: Joi.date().allow(null).optional(),
            approvalStatus: Joi.string().valid('pending', 'approved', 'rejected').optional(),
            approvedBy: objectId.allow(null).optional(),
            approvedAt: Joi.date().allow(null).optional(),
            approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
          })
          .optional(),
        holdPrincipal: Joi.object()
          .keys({
            hsnSac: Joi.string().trim().max(50).allow('', null).optional(),
            taxClassification: Joi.string().trim().max(100).allow('', null).optional(),
            approvedRate: Joi.number().min(0).max(100).allow(null).optional(),
            invoiceTreatment: Joi.string().trim().max(500).allow('', null).optional(),
            taxComponents: Joi.string().trim().max(200).allow('', null).optional(),
            inclusivePricing: Joi.boolean().optional(),
            effectiveFrom: Joi.date().allow(null).optional(),
            effectiveTo: Joi.date().allow(null).optional(),
            approvalStatus: Joi.string().valid('pending', 'approved', 'rejected').optional(),
            approvedBy: objectId.allow(null).optional(),
            approvedAt: Joi.date().allow(null).optional(),
            approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
          })
          .optional(),
        listingPackageFee: Joi.object()
          .keys({
            hsnSac: Joi.string().trim().max(50).allow('', null).optional(),
            taxClassification: Joi.string().trim().max(100).allow('', null).optional(),
            approvedRate: Joi.number().min(0).max(100).allow(null).optional(),
            invoiceTreatment: Joi.string().trim().max(500).allow('', null).optional(),
            taxComponents: Joi.string().trim().max(200).allow('', null).optional(),
            inclusivePricing: Joi.boolean().optional(),
            effectiveFrom: Joi.date().allow(null).optional(),
            effectiveTo: Joi.date().allow(null).optional(),
            approvalStatus: Joi.string().valid('pending', 'approved', 'rejected').optional(),
            approvedBy: objectId.allow(null).optional(),
            approvedAt: Joi.date().allow(null).optional(),
            approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
          })
          .optional(),
        status: Joi.string().valid('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED').optional(),
        approvedBy: objectId.allow(null).optional(),
        approvedAt: Joi.date().allow(null).optional(),
        effectiveFrom: Joi.date().allow(null).optional(),
        effectiveTo: Joi.date().allow(null).optional(),
        approvalReference: Joi.string().trim().max(200).allow('', null).optional(),
        configurationVersion: Joi.string().trim().max(50).optional(),
        changeReason: Joi.string().trim().max(2000).allow('', null).optional(),
        orgGstin: Joi.string().trim().max(15).allow('', null).optional(),
        defaultPlaceOfSupply: Joi.string().trim().max(100).allow('', null).optional(),
        invoiceSeries: Joi.object()
          .keys({
            holdServiceFee: Joi.string().trim().max(60).optional(),
            propertySaleCommission: Joi.string().trim().max(60).optional(),
            holdPrincipal: Joi.string().trim().max(60).optional(),
            listingPackageFee: Joi.string().trim().max(60).optional(),
          })
          .optional(),
      })
      .optional(),
  }),
};

// Listing packages (plan §10.2 row 9). Catalogue items a vendor buys.
// `code` is UPPER_SNAKE and immutable after creation, as is `price`
// (orders carry packageSnapshot, BR-15) — updates only touch name,
// description, features, limits, sortOrder and status.
const packageCodeParam = {
  params: Joi.object().keys({
    code: Joi.string().trim().max(60).required(),
  }),
};

const packageCreate = {
  body: Joi.object().keys({
    code: Joi.string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .required()
      .messages({ 'string.pattern.base': 'code must be UPPER_SNAKE_CASE and start with a letter' }),
    name: Joi.string().trim().min(1).max(120).required(),
    description: Joi.string().trim().max(2000).allow('', null).optional(),
    price: Joi.number().min(0).required(),
    listingCount: Joi.number().integer().min(1).allow(null).optional(),
    durationDays: Joi.number().integer().min(1).max(3650).required(),
    features: Joi.array().items(Joi.string().trim().max(500)).optional(),
    limits: Joi.object()
      .keys({
        maxImages: Joi.number().integer().min(0).allow(null).optional(),
        maxVideos: Joi.number().integer().min(0).allow(null).optional(),
        maxFeatured: Joi.number().integer().min(0).allow(null).optional(),
        allowFeatured: Joi.boolean().optional(),
      })
      .unknown(true)
      .optional(),
    sortOrder: Joi.number().integer().optional(),
    status: Joi.boolean().optional(),
  }),
};

const packageUpdate = {
  params: Joi.object().keys({
    code: Joi.string().trim().max(60).required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(1).max(120).optional(),
      description: Joi.string().trim().max(2000).allow('', null).optional(),
      features: Joi.array().items(Joi.string().trim().max(500)).optional(),
      limits: Joi.object()
        .keys({
          maxImages: Joi.number().integer().min(0).allow(null).optional(),
          maxVideos: Joi.number().integer().min(0).allow(null).optional(),
          maxFeatured: Joi.number().integer().min(0).allow(null).optional(),
          allowFeatured: Joi.boolean().optional(),
        })
        .unknown(true)
        .optional(),
      sortOrder: Joi.number().integer().optional(),
      status: Joi.boolean().optional(),
    })
    .unknown(false),
};

// Bank agreements (plan §10.2 row 19, §5.10). Versioned commission
// terms: DRAFT rows are editable, ACTIVE rows are immutable (new
// version instead), activation retires competing ACTIVE rows.
const bankAgreementCreate = {
  body: Joi.object().keys({
    bank: objectId.required(),
    commissionType: Joi.string().valid('DISBURSED', 'SANCTIONED').required(),
    rate: Joi.number().min(0).max(100).required(),
    calculationBasis: Joi.string().valid('LOAN_DISBURSED', 'SANCTION_AMOUNT').required(),
    minLoan: Joi.number().min(0).allow(0).optional(),
    maxLoan: Joi.number().min(0).allow(0).optional(),
    effectiveFrom: Joi.date().required(),
    effectiveTo: Joi.date().allow(null).optional(),
    settlementTerms: Joi.object()
      .keys({
        payoutCycle: Joi.string().trim().max(200).allow('', null).optional(),
        tdsPercentage: Joi.number().min(0).max(100).allow(null).optional(),
      })
      .unknown(false)
      .optional(),
    offerVisibleToCustomer: Joi.boolean().optional(),
  }),
};

const bankAgreementIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const bankAgreementUpdate = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      commissionType: Joi.string().valid('DISBURSED', 'SANCTIONED').optional(),
      rate: Joi.number().min(0).max(100).optional(),
      calculationBasis: Joi.string().valid('LOAN_DISBURSED', 'SANCTION_AMOUNT').optional(),
      minLoan: Joi.number().min(0).allow(0).optional(),
      maxLoan: Joi.number().min(0).allow(0).optional(),
      effectiveFrom: Joi.date().optional(),
      effectiveTo: Joi.date().allow(null).optional(),
      settlementTerms: Joi.object()
        .keys({
          payoutCycle: Joi.string().trim().max(200).allow('', null).optional(),
          tdsPercentage: Joi.number().min(0).max(100).allow(null).optional(),
        })
        .unknown(false)
        .optional(),
      offerVisibleToCustomer: Joi.boolean().optional(),
    })
    .unknown(false),
};

// Banks + officers. `code` immutable; removal is a member status
// (SUSPENDED/TERMINATED fail bank-auth), never a delete.
const bankIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const bankUpdate = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(1).max(120).optional(),
      contactEmail: Joi.string().trim().email().max(200).allow('', null).optional(),
      contactPhone: Joi.string().trim().max(30).allow('', null).optional(),
      status: Joi.string().valid('ACTIVE', 'SUSPENDED', 'CLOSED').optional(),
    })
    .unknown(false),
};

const bankMemberStatus = {
  params: Joi.object().keys({
    id: objectId.required(),
    memberId: objectId.required(),
  }),
  body: Joi.object()
    .keys({
      status: Joi.string().valid('ACTIVE', 'SUSPENDED', 'TERMINATED').optional(),
      designation: Joi.string().trim().max(200).allow('', null).optional(),
    })
    .unknown(false),
};

// Invoices + GSTR-1 (Phase C). Frozen rows only; cancellation is a
// compensating credit note with a mandatory reason.
const invoiceIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const invoiceListQuery = {
  query: Joi.object().keys({
    supply: Joi.string()
      .valid('HOLD_SERVICE_FEE', 'PROPERTY_SALE_COMMISSION', 'HOLD_PRINCIPAL', 'LISTING_PACKAGE_FEE')
      .optional(),
    status: Joi.string().valid('ISSUED', 'CANCELLED').optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

const invoiceCancel = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    reason: Joi.string().trim().min(1).max(2000).required(),
  }),
};

const gstr1Query = {
  query: Joi.object().keys({
    from: Joi.date().required(),
    to: Joi.date().required(),
  }),
};

// Custody statements (Phase B external leg, ManualCustody). CSV text
// pasted/uploaded by finance; strict header, capped rows, matched
// exactly (paise + window) — never fuzzy.
const custodyStatementUpload = {
  body: Joi.object().keys({
    filename: Joi.string().trim().max(200).allow('', null).optional(),
    csvText: Joi.string().min(1).max(2 * 1024 * 1024).required(),
  }),
};

const custodyStatementIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

// Executive assignment queue (plan §10.2 row 15). Manual override of the
// auto-assignment engine — admin picks the executive, engine constraints
// still enforced in the controller (ACTIVE + available + load cap).
const visitRequestIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const assignVisitRequest = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({
    executiveId: objectId.required(),
  }),
};

const visitRequestListQuery = {
  query: Joi.object().keys({
    status: Joi.string()
      .valid('PENDING_ASSIGNMENT', 'ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
      .optional(),
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
  }),
};

const markPackagePaymentPaid = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(1).max(2000).required(),
      paymentRef: Joi.string().trim().max(200).allow('', null).optional(),
    })
    .unknown(false),
};

module.exports = {
  setPropertyStatus,
  forfeitHold,
  createCommissionRule,
  commissionRuleIdParam,
  updateCommissionRule,
  retireCommissionRule,
  setSettlementStatus,
  generateSettlement,
  verifyDocument,
  categoryUpsert,
  categoryIdParam,
  categoryListQuery,
  holdPolicyPatch,
  holdPolicyIdParam,
  holdPolicyNewVersion,
  holdPolicySubmit,
  holdPolicyApprove,
  approvalCaseIdParam,
  approvalCaseListQuery,
  approvalCaseDecide,
  approvalCaseReject,
  approvalCaseComment,
  taxSupplyPatch,
  settingsPatch,
  packageCodeParam,
  packageCreate,
  packageUpdate,
  bankAgreementCreate,
  bankAgreementIdParam,
  bankAgreementUpdate,
  bankIdParam,
  bankUpdate,
  bankMemberStatus,
  custodyStatementUpload,
  custodyStatementIdParam,
  invoiceIdParam,
  invoiceListQuery,
  invoiceCancel,
  gstr1Query,
  markPackagePaymentPaid,
  visitRequestIdParam,
  assignVisitRequest,
  visitRequestListQuery,
};
