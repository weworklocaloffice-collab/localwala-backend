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
const RealEstateLoanApplicationStatusHistory = require('../models/realestate.loan.application.status.history.model');
const RealEstateBankOffer = require('../models/realestate.bank.offer.model');
const RealEstateBank = require('../models/realestate.bank.model');
const RealEstateLead = require('../models/realestate.lead.model');
const RealEstateSetting = require('../models/realestate.setting.model');
const { LOAN_TRANSITIONS, BANK_ONLY_LOAN_TARGETS, canTransition } = require('../utils/realestate.state.machine');
const fcmNotificationService = require('../../../services/fcm.notification.service');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');
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
  // Underwriting is also a bank action. It is not one of BR-10's three
  // money-bearing targets, but no customer or admin route should be able
  // to move an application into the review queue.
  if (target === 'UNDER_BANK_REVIEW' && actorType !== 'bank') {
    throw new Error('Loan transition to "UNDER_BANK_REVIEW" is bank-only.');
  }
}

/**
 * Shortest legal path between two loan states. The lifecycle table is a
 * graph, not a single line (REQUIRED can become CUSTOMER_WILL_APPLY), so
 * callers that need to catch a lagging parent up use BFS rather than
 * hard-coding one happy path.
 */
function loanStatusPath(from, to) {
  if (from === to) return [from];
  const queue = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];
    for (const next of LOAN_TRANSITIONS[current] || []) {
      if (seen.has(next)) continue;
      const candidate = [...path, next];
      if (next === to) return candidate;
      seen.add(next);
      queue.push(candidate);
    }
  }
  return null;
}

/**
 * Return `to` after proving every edge on a legal path from `from`.
 * A missing path falls through to `assertLoanTransition` so the caller
 * receives the usual "Allowed: ..." error instead of a silent write.
 */
function advanceLoanStatus(from, to) {
  if (from === to) return to;
  if (!loanStatusPath(from, to)) assertLoanTransition(from, to);
  return to;
}

/**
 * Request states before the customer has picked a bank. A bank declining
 * its own application here must not close the customer's whole request:
 * the other banks' offers are still live.
 */
const PRE_SELECTION_REQUEST_STATUSES = new Set([
  'REQUIRED',
  'CUSTOMER_WILL_APPLY',
  'LOAN_LEAD_CREATED',
  'OFFERS_PENDING',
  'OFFERS_RECEIVED',
  'CUSTOMER_SELECTING',
]);

/**
 * Keep the parent request chip in step with the selected application.
 * The customer reads the request status; a bank decision that only moved
 * the application left the list stuck on "Documents pending" forever.
 */
async function syncRequestStatus(requestId, target, session = null) {
  const request = await RealEstateLoanRequest.findById(requestId).session(session || null);
  if (!request || request.status === target) return request;
  if (target === 'WITHDRAWN' && PRE_SELECTION_REQUEST_STATUSES.has(request.status)) return request;
  request.status = advanceLoanStatus(request.status, target);
  await request.save(session ? { session } : {});
  return request;
}

/**
 * Append one row to an application's status history.
 *
 * The history is what the bank's `dialog-application-status` screen
 * renders: the loan application document itself only remembers the
 * latest state, so "who moved this file, when and why" is unanswerable
 * without it.
 *
 * Best-effort by design: a missing history row must never roll back a
 * transition that already succeeded. A broken history is a reporting
 * gap; a lost sanction is a lost sanction.
 *
 * @param {object} args
 * @param {string} args.applicationId
 * @param {string} [args.from]
 * @param {string} args.to
 * @param {string} [args.actorType]
 * @param {string} [args.actor]
 * @param {string} [args.reason]
 * @param {string} [args.note]
 * @param {number} [args.amount]
 */
async function recordStatusHistory({
  applicationId,
  from = undefined,
  to,
  actorType = undefined,
  actor = undefined,
  reason = undefined,
  note = undefined,
  amount = undefined,
}) {
  if (!applicationId || !to) return null;
  try {
    return await RealEstateLoanApplicationStatusHistory.create({
      application: applicationId,
      from,
      to,
      actorType,
      actor,
      reason,
      note,
      amount,
    });
  } catch (e) {
    console.error(`loan status history skipped for application ${applicationId}: ${e.message}`);
    return null;
  }
}

/**
 * The status history of one application, oldest first.
 *
 * @param {string} applicationId
 * @returns {Promise<Array<object>>}
 */
async function listStatusHistory(applicationId) {
  if (!applicationId) return [];
  return RealEstateLoanApplicationStatusHistory.find({ application: applicationId })
    .sort({ createdAt: 1 })
    .lean();
}

async function createRequest({ customer, property, lead = null, requestedAmount, tenureMonths = null, employment = null, monthlyIncome = null }) {  const doc = { customer, property, requestedAmount, status: 'REQUIRED' };
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
  // A bank may only price its own application, and only while the
  // customer is still shopping. Without this scope, bank B could POST an
  // offer against bank A's application and see it echoed back as its own.
  const app = await RealEstateLoanApplication.findOne({ _id: loanApplication, bank });
  if (!app) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan application not found');
  }
  if (!['LOAN_LEAD_CREATED', 'OFFERS_PENDING'].includes(app.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'This loan application is no longer accepting offers.');
  }

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
    if (['REQUIRED', 'CUSTOMER_WILL_APPLY', 'LOAN_LEAD_CREATED'].includes(app.status)) {
      const from = app.status;
      app.status = 'OFFERS_PENDING';
      await app.save();
      await recordStatusHistory({
        applicationId: app._id,
        from,
        to: 'OFFERS_PENDING',
        actorType: 'BANK',
        note: 'First offer received.',
      });
    }
    const parent = await RealEstateLoanRequest.findById(app.loanRequest);
    if (parent && ['REQUIRED', 'CUSTOMER_WILL_APPLY', 'LOAN_LEAD_CREATED'].includes(parent.status)) {
      parent.status = 'OFFERS_PENDING';
      await parent.save();
    }
  } catch {
    /* status side-effect is best-effort */
  }
  // Phase 10: customer sees the offer. Never throws into creation.
  try {
    if (app.customer) {
      await fcmNotificationService.realEstateLoanOfferReceived({
        userId: app.customer,
        recipientType: 'CUSTOMER',
        title: 'Loan offer received',
        body: `A bank offered ₹${loanAmount.toLocaleString('en-IN')} at ${interestRate}% for ${tenureMonths} months.`,
        data: { offerId: String(created._id), applicationId: String(loanApplication) },
      });
    }
  } catch {
    /* notify-only */
  }
  return created;
}

async function setApplicationStatus(applicationId, target, { actorType, bankId = null, sanctionedAmount = 0, disbursedAmount = 0, rejectionReason = '' } = {}) {
  assertBankActor(target, actorType);
  const app = await RealEstateLoanApplication.findById(applicationId);
  if (!app) throw new ApiError(httpStatus.NOT_FOUND, 'Loan application not found');
  // The bank token is the tenant boundary. Never let one bank move
  // another bank's application just because it guessed the id.
  if (bankId && String(app.bank) !== String(bankId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan application not found');
  }
  assertLoanTransition(app.status, target);
  const previousStatus = app.status;
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
  // The customer reads the request, not the application. Keep both in
  // step in the same transaction so a bank decision cannot leave the
  // list chip behind.
  await withOptionalTransaction(async (session) => {
    await app.save(session ? { session } : {});
    await syncRequestStatus(app.loanRequest, target, session);
  });
  // The timeline the bank portal renders. Best-effort: it must never roll
  // back a transition that already succeeded.
  await recordStatusHistory({
    applicationId: app._id,
    from: previousStatus,
    to: target,
    actorType: actorType === 'bank' ? 'BANK' : String(actorType || 'SYSTEM').toUpperCase(),
    reason: rejectionReason || undefined,
    amount:
      target === 'SANCTIONED'
        ? Number(sanctionedAmount) || 0
        : target === 'DISBURSED'
        ? Number(disbursedAmount) || 0
        : undefined,
  });
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
  } catch {
    /* notify-only */
  }
  return app;
}

/**
 * Customer accepts exactly one bank offer.
 *
 * The compare screen used to be a dead end: the lifecycle stopped at
 * OFFERS_PENDING and no surface could choose a bank, so a bank could
 * never reach UNDER_BANK_REVIEW and sanction. This closes that loop:
 *
 *   - the selected offer becomes ACCEPTED;
 *   - every other offer is closed and every other bank application is
 *     withdrawn;
 *   - the selected application and its request advance to
 *     DOCUMENTS_PENDING through legal LOAN_TRANSITIONS edges;
 *   - the bank portal can then move it to UNDER_BANK_REVIEW and sanction.
 *
 * Ownership is proven through the request's customer. A foreign request
 * and a missing one are both 404.
 */
async function acceptOffer({ requestId, offerId, customerId }) {
  const request = await RealEstateLoanRequest.findOne({ _id: requestId, customer: customerId });
  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan request not found');
  }

  const offer = await RealEstateBankOffer.findById(offerId);
  if (!offer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan offer not found');
  }
  const app = await RealEstateLoanApplication.findOne({
    _id: offer.loanApplication,
    loanRequest: request._id,
  });
  if (!app || String(offer.bank) !== String(app.bank)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan offer not found');
  }

  if (['REJECTED', 'WITHDRAWN', 'DISBURSED'].includes(request.status) ||
      ['REJECTED', 'WITHDRAWN', 'DISBURSED'].includes(app.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'This loan request is already closed.');
  }

  const applications = await RealEstateLoanApplication.find({ loanRequest: request._id }).select('_id');
  const applicationIds = applications.map((a) => a._id);
  const alreadyAccepted = await RealEstateBankOffer.findOne({
    loanApplication: { $in: applicationIds },
    status: 'ACCEPTED',
  });
  if (alreadyAccepted && String(alreadyAccepted._id) !== String(offer._id)) {
    throw new ApiError(httpStatus.CONFLICT, 'You have already selected a loan offer.');
  }

  if (offer.status === 'ACCEPTED') {
    const current = await findForCustomer(request._id, customerId);
    if (current) return current;
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan request not found');
  }
  if (offer.status !== 'PENDING') {
    throw new ApiError(httpStatus.CONFLICT, 'This offer is no longer available.');
  }

  const selectable = ['REQUIRED', 'CUSTOMER_WILL_APPLY', 'LOAN_LEAD_CREATED', 'OFFERS_PENDING', 'OFFERS_RECEIVED', 'CUSTOMER_SELECTING'];
  if (!selectable.includes(request.status) || !selectable.includes(app.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'This loan request is not open for selection.');
  }

  const winningStatusBefore = app.status;
  // The losing applications, captured before they are closed, so their
  // timeline rows can be written after the transaction commits.
  let withdrawnApplications = [];
  await withOptionalTransaction(async (session) => {
    offer.status = 'ACCEPTED';
    await offer.save(session ? { session } : {});

    app.status = advanceLoanStatus(app.status, 'DOCUMENTS_PENDING');
    await app.save(session ? { session } : {});

    request.status = advanceLoanStatus(request.status, 'DOCUMENTS_PENDING');
    await request.save(session ? { session } : {});

    const otherApplicationIds = applicationIds.filter((id) => String(id) !== String(app._id));
    if (otherApplicationIds.length) {
      withdrawnApplications = await RealEstateLoanApplication.find({
        _id: { $in: otherApplicationIds },
        status: {
          $in: [
            'REQUIRED',
            'CUSTOMER_WILL_APPLY',
            'LOAN_LEAD_CREATED',
            'OFFERS_PENDING',
            'OFFERS_RECEIVED',
            'CUSTOMER_SELECTING',
            'BANK_SELECTED',
            'APPLICATION_STARTED',
            'DOCUMENTS_PENDING',
            'UNDER_BANK_REVIEW',
          ],
        },
      })
        .select('_id status')
        .lean();
      await RealEstateLoanApplication.updateMany(
        {
          _id: { $in: otherApplicationIds },
          status: {
            $in: [
              'REQUIRED',
              'CUSTOMER_WILL_APPLY',
              'LOAN_LEAD_CREATED',
              'OFFERS_PENDING',
              'OFFERS_RECEIVED',
              'CUSTOMER_SELECTING',
              'BANK_SELECTED',
              'APPLICATION_STARTED',
              'DOCUMENTS_PENDING',
              'UNDER_BANK_REVIEW',
            ],
          },
        },
        { $set: { status: 'WITHDRAWN' } },
        session ? { session } : {}
      );
    }
    await RealEstateBankOffer.updateMany(
      {
        loanApplication: { $in: applicationIds },
        _id: { $ne: offer._id },
        status: 'PENDING',
      },
      { $set: { status: 'REJECTED' } },
      session ? { session } : {}
    );
  });

  // The timeline the bank portal renders. The losing applications were
  // closed by the customer's choice, not by their bank.
  for (const other of withdrawnApplications) {
    await recordStatusHistory({
      applicationId: other._id,
      from: other.status,
      to: 'WITHDRAWN',
      actorType: 'CUSTOMER',
      note: 'The customer selected another bank.',
    });
  }

  await recordStatusHistory({
    applicationId: app._id,
    from: winningStatusBefore,
    to: 'DOCUMENTS_PENDING',
    actorType: 'CUSTOMER',
    note: 'The customer accepted this bank\'s offer.',
  });

  const current = await findForCustomer(request._id, customerId);
  if (!current) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan request not found');
  }
  return current;
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

async function listForExecutive(executiveId, { page = 1, limit = 20, status } = {}) {
  const leads = await RealEstateLead.find({ executive: executiveId }).select('_id').lean();
  if (!leads.length) return { results: [], page, limit, total: 0 };
  const leadIds = leads.map((l) => l._id);
  const filter = { lead: { $in: leadIds } };
  if (status) filter.status = status;
  const [requests, total] = await Promise.all([
    RealEstateLoanRequest.find(filter)
      .populate('customer', 'firstName lastName mobile')
      .populate('property', 'title propertyCode availability')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    RealEstateLoanRequest.countDocuments(filter),
  ]);
  return { results: await attachApplications(requests), page, limit, total };
}

async function findForExecutive(requestId, executiveId) {
  const leads = await RealEstateLead.find({ executive: executiveId }).select('_id').lean();
  if (!leads.length) return null;
  const request = await RealEstateLoanRequest.findOne({
    _id: requestId,
    lead: { $in: leads.map((l) => l._id) },
  })
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title propertyCode availability');
  if (!request) return null;
  const [result] = await attachApplications([request]);
  return result || null;
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
  acceptOffer,
  advanceLoanStatus,
  createRequestForCustomer,
  listForCustomer,
  findForCustomer,
  listForExecutive,
  findForExecutive,
  recordStatusHistory,
  listStatusHistory,
};

module.exports = realEstateLoanService;
