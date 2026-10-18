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

const RealEstateLoanRequest = require('../models/realestate.loan.request.model');
const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
const RealEstateBankOffer = require('../models/realestate.bank.offer.model');
const RealEstateBank = require('../models/realestate.bank.model');
const RealEstateSetting = require('../models/realestate.setting.model');
const { LOAN_TRANSITIONS, BANK_ONLY_LOAN_TARGETS, canTransition } = require('../utils/realestate.state.machine');
const fcmNotificationService = require('../../../services/fcm.notification.service');
const ApiError = require('../../../utils/ApiError');
const { status: httpStatus } = require('http-status');

/**
 * Loan service — requests, applications, offers.
 *
 * BR-10: SANCTIONED / REJECTED / DISBURSED are bank-only. The route
 * carries a rights string that exists ONLY in the `bank` role array;
 * this service mirrors it with `actorType` so a mis-mounted route
 * still fails with a clear error instead of silently writing.
 */

function assertLoanTransition(from, to) {
  if (!canTransition(LOAN_TRANSITIONS, from, to)) {
    const allowed = LOAN_TRANSITIONS[from] || [];
    throw new Error(
      allowed.length
        ? `Cannot move loan from "${from}" to "${to}". Allowed: ${allowed.join(', ')}.`
        : `Loan is already "${from}" and cannot change.`
    );
  }
}

function assertBankActor(target, actorType) {
  if (BANK_ONLY_LOAN_TARGETS.includes(target) && actorType !== 'bank') {
    throw new Error(`Loan transition to "${target}" is bank-only (BR-10).`);
  }
}

async function createRequest({ customer, property, lead = null, requestedAmount, tenureMonths = null, employment = null, monthlyIncome = null }) {
  const doc = { customer, property, requestedAmount, status: 'REQUIRED' };
  if (lead) doc.lead = lead;
  if (tenureMonths) doc.tenureMonths = tenureMonths;
  if (employment) doc.employment = employment;
  if (monthlyIncome !== null) doc.monthlyIncome = monthlyIncome;
  return RealEstateLoanRequest.create(doc);
}

async function createApplication({ loanRequest, bank, customer, property, requestedAmount, status = 'APPLICATION_STARTED' }) {
  return RealEstateLoanApplication.create({
    loanRequest,
    bank,
    customer,
    property,
    requestedAmount,
    status,
  });
}

async function createOffer({ loanApplication, bank, loanAmount, tenureMonths, interestRate, processingFee = 0 }) {
  const created = await RealEstateBankOffer.create({
    loanApplication,
    bank,
    loanAmount,
    tenureMonths,
    interestRate,
    processingFee,
    status: 'PENDING',
  });
  // First offer on a lead moves the application and its parent request
  // to OFFERS_PENDING (LOAN_LEAD_CREATED → OFFERS_PENDING is a
  // sanctioned move), so the customer's list chip stops reading "lead
  // created" and shows that banks are answering. Best-effort: a failed
  // status flip must not lose an offer that is already persisted.
  try {
    const app = await RealEstateLoanApplication.findById(loanApplication);
    if (app && ['REQUIRED', 'CUSTOMER_WILL_APPLY', 'LOAN_LEAD_CREATED'].includes(app.status)) {
      app.status = 'OFFERS_PENDING';
      await app.save();
      const parent = await RealEstateLoanRequest.findById(app.loanRequest);
      if (parent && ['REQUIRED', 'CUSTOMER_WILL_APPLY', 'LOAN_LEAD_CREATED'].includes(parent.status)) {
        parent.status = 'OFFERS_PENDING';
        await parent.save();
      }
    }
  } catch (e) {
    /* status side-effect is best-effort */
  }
  // Phase 10: customer sees the offer. Never throws into creation.
  try {
    const app = await RealEstateLoanApplication.findById(loanApplication).select('customer').lean();
    if (app && app.customer) {
      await fcmNotificationService.realEstateLoanOfferReceived({
        userId: app.customer,
        recipientType: 'CUSTOMER',
        title: 'Loan offer received',
        body: `A bank offered ₹${loanAmount.toLocaleString('en-IN')} at ${interestRate}% for ${tenureMonths} months.`,
        data: { offerId: String(created._id), applicationId: String(loanApplication) },
      });
    }
  } catch (e) {
    /* notify-only */
  }
  return created;
}

async function setApplicationStatus(applicationId, target, { actorType, sanctionedAmount = 0, disbursedAmount = 0, rejectionReason = '' } = {}) {
  assertBankActor(target, actorType);
  const app = await RealEstateLoanApplication.findById(applicationId);
  if (!app) throw new Error('Loan application not found');
  assertLoanTransition(app.status, target);
  app.status = target;
  if (target === 'SANCTIONED') {
    app.sanctionedAmount = sanctionedAmount;
    app.sanctionedAt = new Date();
  }
  if (target === 'DISBURSED') {
    app.disbursedAmount = disbursedAmount;
    app.disbursedAt = new Date();
  }
  if (target === 'REJECTED') {
    app.rejectedAt = new Date();
    app.rejectionReason = rejectionReason;
  }
  await app.save();
  // §5.10: disbursement earns LocalWala the bank commission (REVENUE,
  // party BANK) under the ACTIVE agreement. Best-effort — a missing
  // agreement must not break bank operations; it surfaces in logs for
  // finance to configure and backfill. Single-fire: the transition
  // machine only reaches DISBURSED once per application.
  if (target === 'DISBURSED' && app.bank) {
    try {
      const agreementService = require('./realestate.bank.agreement.service');
      await agreementService.recordBankCommission({
        bankId: app.bank,
        sanctionedAmount: Number(app.sanctionedAmount) || 0,
        disbursedAmount: Number(app.disbursedAmount) || 0,
        loanApplicationId: app._id,
      });
    } catch (e) {
      console.error(`bank commission skipped for application ${applicationId}: ${e.message}`);
    }
  }
  // Phase 10: customer sees the bank decision. Never throws into the transition.
  try {
    if (app.customer) {
      const eventType = target === 'SANCTIONED' ? 'realEstateLoanSanctioned' : target === 'DISBURSED' ? 'realEstateLoanDisbursed' : null;
      if (eventType) {
        await fcmNotificationService[eventType]({
          userId: app.customer,
          recipientType: 'CUSTOMER',
          title: target === 'SANCTIONED' ? 'Loan sanctioned' : 'Loan disbursed',
          body: target === 'SANCTIONED' ? `Your loan of ₹${(sanctionedAmount || 0).toLocaleString('en-IN')} was sanctioned.` : `Your loan of ₹${(disbursedAmount || 0).toLocaleString('en-IN')} was disbursed.`,
          data: { applicationId: String(applicationId) },
        });
      }
    }
  } catch (e) {
    /* notify-only */
  }
  return app;
}

/**
 * Customer Flow 12 — one request per property, then the request becomes
 * a lead distributed to every ACTIVE bank (one application each, status
 * LOAN_LEAD_CREATED). A bank sees only its own rows — cross-bank
 * visibility is a data leak to a competitor (plan §13.3).
 *
 * `property` is a document already loaded and ownership-checked by the
 * controller; this function guards the rest.
 */
async function createRequestForCustomer({ customer, property, lead = null, requestedAmount, tenureMonths = null, employment = null, monthlyIncome = null }) {
  // Admin can turn the capability off from settings. The flag defaults
  // ON and a missing settings row means enabled — same convention as
  // autoAssignVisitRequests.
  const settings = await RealEstateSetting.findOne();
  if (settings && settings.customerCanRequestLoan === false) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Requesting a loan is currently disabled.');
  }
  const open = await RealEstateLoanRequest.findOne({
    customer,
    property: property._id,
    status: { $nin: ['WITHDRAWN', 'REJECTED', 'DISBURSED'] },
  });
  if (open) {
    throw new ApiError(httpStatus.CONFLICT, 'You already have an open loan request for this property.');
  }
  const request = await createRequest({
    customer,
    property: property._id,
    lead,
    requestedAmount,
    tenureMonths,
    employment,
    monthlyIncome,
  });
  assertLoanTransition(request.status, 'LOAN_LEAD_CREATED');
  request.status = 'LOAN_LEAD_CREATED';
  await request.save();
  const banks = await RealEstateBank.find({ status: 'ACTIVE' }).select('_id');
  for (const bank of banks) {
    try {
      await createApplication({
        loanRequest: request._id,
        bank: bank._id,
        customer,
        property: property._id,
        requestedAmount,
        status: 'LOAN_LEAD_CREATED',
      });
    } catch (e) {
      // unique index { loanRequest, bank } — a retry must not double-distribute.
      if (e && e.code !== 11000) throw e;
    }
  }
  return request;
}

/**
 * Requests for one customer, newest first, each with its applications
 * and the offers on them (manual joins — no aggregation stages).
 *
 * **No `.lean()` here.** The money fields are moneyField getters and
 * lean bypasses them, so every amount would ship to the app in paise —
 * a silent 100× bug (verified: lean → 500000000, getters → 5000000).
 * `toObject({ getters: true })` applies the same getter `toJSON`
 * applies on the wire, once, at the source.
 */
async function listForCustomer(customerId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [requests, total] = await Promise.all([
    RealEstateLoanRequest.find({ customer: customerId })
      .populate('property', 'title locality city price pricePeriod availability')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    RealEstateLoanRequest.countDocuments({ customer: customerId }),
  ]);
  const results = await attachApplications(requests);
  return { results, page, limit, total };
}

async function findForCustomer(requestId, customerId) {
  const request = await RealEstateLoanRequest.findOne({ _id: requestId, customer: customerId })
    .populate('property', 'title locality city price pricePeriod availability');
  if (!request) return null;
  const [results] = await attachApplications([request]);
  return results || null;
}

async function attachApplications(requests) {
  if (!requests.length) return [];
  const ids = requests.map((r) => r._id);
  const apps = await RealEstateLoanApplication.find({ loanRequest: { $in: ids } }).populate('bank', 'name code');
  const appIds = apps.map((a) => a._id);
  const offers = await RealEstateBankOffer.find({ loanApplication: { $in: appIds } }).populate('bank', 'name code');
  const offersByApp = new Map();
  for (const offer of offers) {
    const key = String(offer.loanApplication);
    const plain = offer.toObject({ getters: true });
    if (offersByApp.has(key)) offersByApp.get(key).push(plain);
    else offersByApp.set(key, [plain]);
  }
  const appsByRequest = new Map();
  for (const app of apps) {
    const plain = app.toObject({ getters: true });
    plain.offers = offersByApp.get(String(app._id)) || [];
    const key = String(app.loanRequest);
    if (appsByRequest.has(key)) appsByRequest.get(key).push(plain);
    else appsByRequest.set(key, [plain]);
  }
  return requests.map((r) => ({
    ...r.toObject({ getters: true }),
    applications: appsByRequest.get(String(r._id)) || [],
  }));
}

const realEstateLoanService = {
  assertLoanTransition,
  assertBankActor,
  createRequest,
  createApplication,
  createOffer,
  setApplicationStatus,
  createRequestForCustomer,
  listForCustomer,
  findForCustomer,
};

module.exports = realEstateLoanService;
