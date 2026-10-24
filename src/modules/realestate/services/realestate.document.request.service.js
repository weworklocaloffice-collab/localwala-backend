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

const RealEstateDocumentRequest = require('../models/realestate.document.request.model');
const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
const fcmNotificationService = require('../../../services/fcm.notification.service');
const ApiError = require('../../../utils/ApiError');
const { status: httpStatus } = require('http-status');

/**
 * Document requests — a bank asks the customer for a document, the
 * customer answers, the bank reviews the answer.
 *
 * ## The three rules this service enforces
 *
 * 1. **Only the owning bank may ask.** The bank id comes from the bank
 *    session, never from the body, and the application must belong to
 *    that bank. A bank that guesses another bank's application id gets a
 *    404, not a 403 — a 403 would confirm the id exists.
 *
 * 2. **Only the customer may answer, and only their own request.** The
 *    answer is matched on `customer`, so one customer cannot answer
 *    another's request.
 *
 * 3. **One open request per category.** A second ask for a category
 *    that is already open is a 409, not a second row.
 */

/**
 * The states a bank may ask in.
 *
 * A bank asks for documents while it is underwriting: after the
 * customer chose it (DOCUMENTS_PENDING) and while it reviews the file
 * (UNDER_BANK_REVIEW). Asking before the customer has chosen a bank
 * would be a bank pinging every applicant about paperwork it may never
 * get, and asking after the file is closed is meaningless.
 */
const REQUESTABLE_STATUSES = ['DOCUMENTS_PENDING', 'UNDER_BANK_REVIEW'];

/**
 * Create a document request for one of the bank's own applications.
 *
 * @param {object} args
 * @param {string} args.applicationId
 * @param {string} args.bankId
 * @param {string} [args.requestedBy] the bank member's User id
 * @param {string} args.category
 * @param {string} args.title
 * @param {string} [args.notes]
 * @param {Date} [args.dueDate]
 * @returns {Promise<object>} the created request
 */
async function createRequest({
  applicationId,
  bankId,
  requestedBy = null,
  category,
  title,
  notes = '',
  dueDate = null,
}) {
  const application = await RealEstateLoanApplication.findOne({
    _id: applicationId,
    bank: bankId,
  });
  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Loan application not found');
  }
  if (!REQUESTABLE_STATUSES.includes(application.status)) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `Documents can only be requested while the application is ${REQUESTABLE_STATUSES.join(' or ')}.`
    );
  }
  if (!application.customer) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'This application has no customer.');
  }

  const existing = await RealEstateDocumentRequest.findOne({
    loanApplication: application._id,
    category,
    status: { $in: ['REQUESTED', 'SUBMITTED'] },
  });
  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${String(category).toLowerCase()} request is already open on this application.`
    );
  }

  let created;
  try {
    created = await RealEstateDocumentRequest.create({
      loanApplication: application._id,
      loanRequest: application.loanRequest,
      customer: application.customer,
      bank: application.bank,
      property: application.property,
      category,
      title,
      notes,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      requestedBy: requestedBy || undefined,
      status: 'REQUESTED',
    });
  } catch (e) {
    // The partial unique index is the last line of defence for a race
    // between two bankers pressing "Request" at the same moment.
    if (e && e.code === 11000) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `A ${String(category).toLowerCase()} request is already open on this application.`
      );
    }
    throw e;
  }

  try {
    await fcmNotificationService.realEstateDocumentRequested({
      userId: application.customer,
      recipientType: 'CUSTOMER',
      title: 'Documents requested',
      body: `${title} is needed for your loan application.`,
      data: {
        requestId: String(created._id),
        applicationId: String(application._id),
      },
    });
  } catch {
    /* notify-only */
  }

  return created;
}

/**
 * The requests on one application, newest first.
 *
 * @param {string} applicationId
 * @param {string} bankId
 * @returns {Promise<Array<object>>}
 */
async function listForApplication(applicationId, bankId) {
  const application = await RealEstateLoanApplication.findOne({
    _id: applicationId,
    bank: bankId,
  }).select('_id');
  if (!application) return null;
  const docs = await RealEstateDocumentRequest.find({ loanApplication: application._id })
    .sort({ createdAt: -1 })
    .lean();
  return docs;
}

/**
 * The customer's own document requests, newest first.
 *
 * @param {string} customerId
 * @param {{ applicationId?: string }} [opts]
 * @returns {Promise<Array<object>>}
 */
async function listForCustomer(customerId, { applicationId = null } = {}) {
  if (!customerId) return [];
  const filter = { customer: customerId };
  if (applicationId) filter.loanApplication = applicationId;
  const docs = await RealEstateDocumentRequest.find(filter)
    .sort({ createdAt: -1 })
    .populate('loanApplication', 'status property')
    .populate('property', 'title propertyCode')
    .lean();
  return docs;
}

/**
 * The customer answers a request with a file.
 *
 * @param {object} args
 * @param {string} args.requestId
 * @param {string} args.customerId
 * @param {string} args.fileUrl
 * @param {string} [args.fileName]
 * @param {string} [args.mimeType]
 * @param {number} [args.sizeBytes]
 * @returns {Promise<object>}
 */
async function submitByCustomer({
  requestId,
  customerId,
  fileUrl,
  fileName = '',
  mimeType = '',
  sizeBytes = undefined,
}) {
  const request = await RealEstateDocumentRequest.findOne({
    _id: requestId,
    customer: customerId,
  });
  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document request not found');
  }
  if (['ACCEPTED', 'CANCELLED'].includes(request.status)) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `This request is ${request.status} and can no longer be answered.`
    );
  }

  request.fileUrl = fileUrl;
  request.fileName = fileName || request.fileName;
  request.mimeType = mimeType || request.mimeType;
  request.sizeBytes = sizeBytes;
  request.uploadedAt = new Date();
  request.status = 'SUBMITTED';
  request.reviewNote = undefined;
  await request.save();

  try {
    await fcmNotificationService.realEstateDocumentSubmitted({
      userId: request.bank,
      recipientType: 'BANK',
      title: 'Document uploaded',
      body: `The customer uploaded ${request.title}.`,
      data: {
        requestId: String(request._id),
        applicationId: String(request.loanApplication),
      },
    });
  } catch {
    /* notify-only */
  }

  return request;
}

/**
 * The bank reviews the customer's answer.
 *
 * @param {object} args
 * @param {string} args.requestId
 * @param {string} args.bankId
 * @param {string} args.decision ACCEPTED | REJECTED
 * @param {string} [args.note]
 * @param {string} [args.reviewedBy]
 * @returns {Promise<object>}
 */
async function reviewByBank({ requestId, bankId, decision, note = '', reviewedBy = null }) {
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Decision must be ACCEPTED or REJECTED.');
  }
  const request = await RealEstateDocumentRequest.findOne({ _id: requestId, bank: bankId });
  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document request not found');
  }
  if (request.status === 'CANCELLED') {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'This request was cancelled.');
  }

  request.status = decision;
  request.reviewNote = note || undefined;
  request.reviewedAt = new Date();
  request.reviewedBy = reviewedBy || undefined;
  await request.save();

  try {
    await fcmNotificationService.realEstateDocumentReviewed({
      userId: request.customer,
      recipientType: 'CUSTOMER',
      title: decision === 'ACCEPTED' ? 'Document accepted' : 'Document rejected',
      body:
        decision === 'ACCEPTED'
          ? `${request.title} was accepted.`
          : `${request.title} was rejected. ${note || ''}`.trim(),
      data: { requestId: String(request._id) },
    });
  } catch {
    /* notify-only */
  }

  return request;
}

const realEstateDocumentRequestService = {
  REQUESTABLE_STATUSES,
  createRequest,
  listForApplication,
  listForCustomer,
  submitByCustomer,
  reviewByBank,
};

module.exports = realEstateDocumentRequestService;
