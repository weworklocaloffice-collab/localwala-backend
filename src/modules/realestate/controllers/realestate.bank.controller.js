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
const catchAsync = require('../../../utils/catchAsync');
const loanService = require('../services/realestate.loan.service');
const bankService = require('../services/realestate.bank.service');
const documentRequestService = require('../services/realestate.document.request.service');

/**
 * Bank controller — offers + bank-owned loan transitions.
 * Every handler runs behind `bankAuth`: `req.bankId` is the bank,
 * never a URL param. `actorType: 'bank'` is passed to the service
 * so BR-10 holds even if a route is mis-mounted.
 */

/**
 * The application list a bank works from.
 *
 * ## Why this reads hydrated documents and not `.lean()`
 *
 * `requestedAmount` / `sanctionedAmount` / `disbursedAmount` are money
 * fields: the column is paise, the getter is rupees. A `.lean()` read
 * bypasses the getter, so the portal would price a ₹50 lakh loan as
 * ₹5,000 lakh. `toObject({ getters: true })` keeps the rupees.
 *
 * ## Why `customer` and `property` are populated
 *
 * The portal's loan-leads and applications screens show the customer's
 * name and the property title. Without the join they read `undefined`
 * and fall back to a raw ObjectId hex - a screen full of ids.
 *
 * ## Why the rows keep `_id`
 *
 * `toObject()` (unlike `toJSON()`) does not rename `_id` to `id` and does
 * not strip `createdAt`. The portal links on the application id, and a
 * queue that cannot say when a file arrived is a queue a banker cannot
 * triage.
 */
const listApplications = catchAsync(async (req, res) => {
  const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
  const apps = await RealEstateLoanApplication.find({ bank: req.bankId })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('customer', 'firstName lastName mobile email')
    .populate('property', 'title propertyCode city locality addressLine');
  res.status(httpStatus.OK).send(apps.map((a) => a.toObject({ getters: true })));
});

const getApplication = catchAsync(async (req, res) => {
  const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
  const app = await RealEstateLoanApplication.findOne({ _id: req.params.id, bank: req.bankId })
    .populate('property', 'title propertyCode city locality addressLine')
    .populate('customer', 'firstName lastName mobile email')
    // The bank prices a loan against income, not against an amount
    // alone (plan §5.8): `employment` and `monthlyIncome` live on the
    // parent request, so the loan officer cannot see them without it.
    .populate('loanRequest', 'requestedAmount tenureMonths employment monthlyIncome status')
    .populate('bank', 'name code');
  if (!app) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Loan application not found' });
  }
  res.status(httpStatus.OK).send(app.toObject({ getters: true }));
});

/**
 * GET /applications/:id/status-history
 *
 * The timeline the bank's application-status dialog renders: every
 * transition of this application, oldest first, with who moved it.
 */
const getApplicationStatusHistory = catchAsync(async (req, res) => {
  const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
  const app = await RealEstateLoanApplication.findOne({
    _id: req.params.id,
    bank: req.bankId,
  })
    .select('_id')
    .lean();
  if (!app) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Loan application not found' });
  }
  const history = await loanService.listStatusHistory(app._id);
  res.status(httpStatus.OK).send({ results: history });
});

/**
 * GET /applications/:id/document-requests
 *
 * What the bank has asked this customer for, and what came back.
 */
const listApplicationDocumentRequests = catchAsync(async (req, res) => {
  const requests = await documentRequestService.listForApplication(
    req.params.id,
    req.bankId
  );
  if (requests === null) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Loan application not found' });
  }
  res.status(httpStatus.OK).send({ results: requests });
});

/**
 * POST /applications/:id/document-requests
 *
 * The bank asks the customer for a document. The customer is notified.
 */
const createApplicationDocumentRequest = catchAsync(async (req, res) => {
  const request = await documentRequestService.createRequest({
    applicationId: req.params.id,
    bankId: req.bankId,
    requestedBy: (req.user && (req.user.id || req.user._id)) || null,
    category: req.body.category,
    title: req.body.title,
    notes: req.body.notes || '',
    dueDate: req.body.dueDate || null,
  });
  res.status(httpStatus.CREATED).send({ data: request.toObject({ getters: true }) });
});

/**
 * PATCH /document-requests/:requestId
 *
 * The bank accepts or rejects what the customer sent.
 */
const reviewDocumentRequest = catchAsync(async (req, res) => {
  const request = await documentRequestService.reviewByBank({
    requestId: req.params.requestId,
    bankId: req.bankId,
    decision: req.body.decision,
    note: req.body.note || '',
    reviewedBy: (req.user && (req.user.id || req.user._id)) || null,
  });
  res.status(httpStatus.OK).send({ data: request.toObject({ getters: true }) });
});

const listOffers = catchAsync(async (req, res) => {
  const RealEstateBankOffer = require('../models/realestate.bank.offer.model');
  const offers = await RealEstateBankOffer.find({ bank: req.bankId })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('loanApplication', 'requestedAmount status property')
    .populate('bank', 'name code');
  res.status(httpStatus.OK).send(offers.map((o) => o.toObject({ getters: true })));
});

const createOffer = catchAsync(async (req, res) => {
  await bankService.resolveBankForUser(req.user.id || req.user._id);
  const offer = await loanService.createOffer({ ...req.body, bank: req.bankId });
  res.status(httpStatus.CREATED).send(offer);
});

const setApplicationStatus = catchAsync(async (req, res) => {
  const app = await loanService.setApplicationStatus(req.params.id, req.params.status, {
    actorType: 'bank',
    bankId: req.bankId,
    sanctionedAmount: req.body.sanctionedAmount || 0,
    disbursedAmount: req.body.disbursedAmount || 0,
    rejectionReason: req.body.rejectionReason || '',
  });
  res.status(httpStatus.OK).send(app);
});

const updatePassword = catchAsync(async (req, res) => {
  // A bank officer may only change their own password — never another
  // user's, even within the same bank. `bankAuth` already proved the
  // caller is a bank member; this binds the `:id` to the caller.
  const me = req.user && (req.user.id || req.user._id);
  if (!me || String(req.params.id) !== String(me)) {
    throw new Error('You can only update your own password');
  }
  const userService = require('../../../services/user.service');
  const result = await userService.updateAccountantPassword(req.params.id, req.body.password);
  res.status(httpStatus.OK).send(result);
});

const listBankDocuments = catchAsync(async (req, res) => {
  // Plan §5.12: a bank sees BANK_VISIBLE + CUSTOMER_VISIBLE documents, and
  // only for properties it has a live loan application on. There is no
  // `bank` field on the document — scope goes through the bank's live
  // loan applications → their properties. Live = anything except a dead
  // application (REJECTED / WITHDRAWN). Returns an array like the sibling
  // list endpoints, not a paginate object.
  const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
  const RealEstatePropertyDocument = require('../models/realestate.property.document.model');
  const documentAccess = require('../middlewares/realestate.document.access');
  const liveApps = await RealEstateLoanApplication.find({
    bank: req.bankId,
    status: { $nin: ['REJECTED', 'WITHDRAWN'] },
  })
    .select('property')
    .lean();
  const propertyIds = [...new Set((liveApps || []).map((a) => String(a.property)).filter(Boolean))];
  if (!propertyIds.length) {
    res.status(httpStatus.OK).send([]);
    return;
  }
  const docs = await RealEstatePropertyDocument.find({
    property: { $in: propertyIds },
    visibility: { $in: documentAccess.allowedClasses('bank') },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    // The property title is what makes the list usable: a raw ObjectId
    // tells a loan officer nothing about which file a document belongs
    // to.
    .populate('property', 'title propertyCode')
    .lean();
  res.status(httpStatus.OK).send(documentAccess.redactAll(docs, 'bank'));
});

const listCustomers = catchAsync(async (req, res) => {
  // Each bank sees the distinct customers who have applied for a loan
  // through it. BR-10: the bank is the only party that sees its own
  // customer relationships, so this resolves entirely from req.bankId.
  const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const apps = await RealEstateLoanApplication.find({ bank: req.bankId })
    .populate('customer', 'firstName lastName mobile email')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  const totalResults = await RealEstateLoanApplication.countDocuments({ bank: req.bankId });
  const seen = new Map();
  const customers = [];
  for (const app of apps) {
    if (!app.customer) continue;
    const key = String(app.customer._id);
    if (!seen.has(key)) {
      seen.set(key, 1);
      customers.push({
        customer: app.customer,
        applicationCount: 1,
        latestStatus: app.status,
        latestAt: app.createdAt,
      });
    } else {
      // The count was hard-coded to 1, which told a banker "one
      // application" when the customer actually had three. Count every
      // application the bank holds for this customer.
      const row = customers.find((c) => String(c.customer._id) === key);
      if (row) row.applicationCount += 1;
    }
  }
  res.status(httpStatus.OK).send({ results: customers, totalResults });
});

const listCommissions = catchAsync(async (req, res) => {
  // Bank commission earnings — commissions where the beneficiary is a BANK
  // and matches this bank. BR-16: rates are percentages of the bank's
  // sanctioned/disbursed amount, not the property sale value.
  const RealEstateCommission = require('../models/realestate.commission.model');
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const filter = { beneficiaryType: 'BANK', beneficiary: req.bankId };
  const result = await RealEstateCommission.paginate(filter, { page, limit, sort: { createdAt: -1 } });
  res.status(httpStatus.OK).send(result);
});

/**
 * GET /bank/me — the signed-in officer's bank + membership.
 * Resolved from the token only (no bank id in path, §2.3).
 */
const getProfile = catchAsync(async (req, res) => {
  const RealEstateBank = require('../models/realestate.bank.model');
  const RealEstateBankMember = require('../models/realestate.bank.member.model');
  const bank = await RealEstateBank.findById(req.bankId).lean();
  const member = await RealEstateBankMember.findById(req.bankMemberId)
    .populate('user', 'firstName lastName mobile email')
    .lean();
  if (!bank) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Bank not found' });
  }
  res.status(httpStatus.OK).send({ bank, member });
});

module.exports = {
  listApplications,
  getApplication,
  getApplicationStatusHistory,
  listApplicationDocumentRequests,
  createApplicationDocumentRequest,
  reviewDocumentRequest,
  listOffers,
  createOffer,
  setApplicationStatus,
  updatePassword,
  listBankDocuments,
  listCustomers,
  listCommissions,
  getProfile,
};
