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

/**
 * Admin list controller — read-only paginated lists for the
 * `real-estate-management` panel.
 *
 * One factory, no per-entity logic: every list takes an optional
 * `status` filter and paginates. Writes live in
 * `realestate.admin.controller.js`, never here, so a list screen
 * cannot drift into a mutation path.
 */

const listFor = (modelName, allowedStatuses) =>
  catchAsync(async (req, res) => {
    const Model = require(`../models/${modelName}.model`);
    const filter = {};
    if (req.query.status) {
      if (allowedStatuses && !allowedStatuses.includes(req.query.status)) {
        return res.status(httpStatus.BAD_REQUEST).send({ message: `Unknown status: ${req.query.status}` });
      }
      filter.status = req.query.status;
    }
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
    const result = await Model.paginate(filter, { page, limit, sort: { createdAt: -1 } });
    res.status(httpStatus.OK).send(result);
  });

module.exports = {
  listProperties: listFor('realestate.property.model', [
    'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED',
    'CHANGES_REQUIRED', 'REJECTED', 'SUSPENDED', 'EXPIRED', 'SOLD', 'RENTED', 'ARCHIVED',
  ]),
  listHolds: listFor('realestate.property.hold.model', [
    'PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED',
    'CONVERTED_TO_SALE', 'REFUND_PENDING', 'REFUNDED', 'ADJUSTED',
  ]),
  listRefunds: listFor('realestate.hold.refund.model', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  listCommissionRules: listFor('realestate.commission.rule.model', ['DRAFT', 'ACTIVE', 'RETIRED']),
  listSettlements: listFor('realestate.settlement.model', [
    'PENDING', 'VERIFIED', 'EARNED', 'SETTLEMENT_CREATED', 'PAID',
  ]),
  listLedger: listFor('realestate.ledger.entry.model', null),
  listLoans: listFor('realestate.loan.application.model', null),
  listLeads: listFor('realestate.lead.model', null),
  listVisits: listFor('realestate.visit.model', null),
  listVendors: listFor('realestate.vendor.model', null),
  listDocuments: listFor('realestate.property.document.model', ['PENDING', 'ACCEPTED', 'REJECTED', 'REPLACED']),
  listAuditLogs: listFor('realestate.audit.log.model', null),
  listPromotions: listFor('realestate.property.promotion.model', ['PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED']),
  listReferrals: listFor('realestate.referral.model', [
    'PENDING', 'QUALIFIED', 'COMMISSION_EARNED', 'COMMISSION_PAID', 'EXPIRED',
  ]),
  listBankOffers: listFor('realestate.bank.offer.model', ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN']),
  listBankAgreements: listFor('realestate.bank.agreement.model', ['DRAFT', 'ACTIVE', 'EXPIRED']),
  listSales: listFor('realestate.sale.model', ['COMPLETED', 'CANCELLED']),
  listHoldPayments: listFor('realestate.hold.payment.model', ['PENDING', 'SUCCESS', 'FAILED']),
};

const COMMISSION_STATUSES = ['PENDING', 'VERIFIED', 'EARNED', 'SETTLEMENT_CREATED', 'PAID', 'REVERSED'];
const COMMISSION_BENEFICIARIES = ['LOCALWALA', 'VENDOR', 'EXECUTIVE', 'REFERRER', 'BANK'];

/**
 * Commission list with beneficiary filter (plan §10.2 rows 25, 28–30).
 * The earnings screens (sale-commissions, referral/executive/bank)
 * share this endpoint with `?beneficiaryType=` — one endpoint, four
 * screens, no duplicated query logic. BR-16 amounts computed API-side.
 */
module.exports.listCommissions = catchAsync(async (req, res) => {
  const Model = require('../models/realestate.commission.model');
  const filter = {};
  if (req.query.status) {
    if (!COMMISSION_STATUSES.includes(req.query.status)) {
      return res.status(httpStatus.BAD_REQUEST).send({ message: `Unknown status: ${req.query.status}` });
    }
    filter.status = req.query.status;
  }
  if (req.query.beneficiaryType) {
    if (!COMMISSION_BENEFICIARIES.includes(req.query.beneficiaryType)) {
      return res.status(httpStatus.BAD_REQUEST).send({ message: `Unknown beneficiaryType: ${req.query.beneficiaryType}` });
    }
    filter.beneficiaryType = req.query.beneficiaryType;
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
  const result = await Model.paginate(filter, { page, limit, sort: { createdAt: -1 } });
  res.status(httpStatus.OK).send(result);
});
