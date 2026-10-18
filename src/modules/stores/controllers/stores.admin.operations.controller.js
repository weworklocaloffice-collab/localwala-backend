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
const operationsService = require('../services/stores.admin.operations.service');

/**
 * The operational consoles.
 *
 * ## Read-only by design
 *
 * Every handler here is a GET. These surfaces exist to answer "what needs a human and how
 * urgently" — they are not an editing surface, and adding a mutation to them would make
 * the console a second place to perform the same action with different guardrails than
 * the record's own screen. The operator taps through to the record from here.
 */

const summary = catchAsync(async (req, res) => {
  const counts = await operationsService.consoleSummary();
  res.status(httpStatus.OK).send(counts);
});

const subscriptionHealth = catchAsync(async (req, res) => {
  const rows = await operationsService.subscriptionHealth();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

const settlementExceptions = catchAsync(async (req, res) => {
  const rows = await operationsService.settlementExceptions();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

const refundFailures = catchAsync(async (req, res) => {
  const rows = await operationsService.refundFailures();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

const inventoryDrift = catchAsync(async (req, res) => {
  const rows = await operationsService.inventoryDrift();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

const complianceExpiry = catchAsync(async (req, res) => {
  const rows = await operationsService.complianceExpiry();
  res.status(httpStatus.OK).send({
    results: [...rows.documents, ...rows.subscriptions],
    documents: rows.documents,
    subscriptions: rows.subscriptions,
    totalResults: rows.documents.length + rows.subscriptions.length,
  });
});

const organicVerificationQueue = catchAsync(async (req, res) => {
  const rows = await operationsService.organicVerificationQueue();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

const abuseQueue = catchAsync(async (req, res) => {
  const rows = await operationsService.abuseQueue();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

const applicationAgeing = catchAsync(async (req, res) => {
  const rows = await operationsService.applicationAgeing();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

const codRemittance = catchAsync(async (req, res) => {
  const rows = await operationsService.codRemittance();
  res.status(httpStatus.OK).send({ results: rows, totalResults: rows.length });
});

module.exports = {
  summary,
  subscriptionHealth,
  settlementExceptions,
  refundFailures,
  inventoryDrift,
  complianceExpiry,
  organicVerificationQueue,
  abuseQueue,
  applicationAgeing,
  codRemittance,
};