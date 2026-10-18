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

/**
 * stores.invoice.service.js — server-controlled invoice numbers (BR-43).
 *
 * One series per outlet: `{prefix}/{financialYear}/{sequence}`, e.g.
 * `ABC-HYD-01/2026-27/000123`. The sequence is a single atomic `$inc` on the
 * outlet document, so two concurrent orders can never share a number — the
 * counter IS the lock, and there is no read-then-write anywhere in this file.
 *
 * The sequence runs continuously across financial years (it is not reset on
 * April 1st): resetting would need a compare-and-set against concurrent
 * issuers and buys nothing, because the financial year is part of the number
 * and uniqueness holds either way.
 *
 * Numbers are issued when an order becomes billable — the `paid` transition —
 * not at creation. An order cancelled before payment never consumes a number,
 * and an order cancelled after payment keeps its number with status `void`.
 * Numbers are never reused.
 *
 * Honest limits (T4 — standalone mongod, no transactions): the `$inc` and the
 * order write are two separate writes. A crash between them can skip a
 * number. Skips are therefore possible; duplicates are not (plus a sparse
 * unique index on `invoiceNo` as a backstop). Every issued number lives on
 * its order, so a skip is auditable rather than silent.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { currentFinancialYear } = require('./stores.onboarding.service');

const issueInvoiceNumber = async (outletId, { atDate = new Date() } = {}) => {
  const StoreOutlet = mongoose.model('StoreOutlet');

  const probe = await StoreOutlet.findById(outletId).select('invoiceSeries outletCode').lean();
  if (!probe) throw new ApiError(httpStatus.NOT_FOUND, 'OUTLET_NOT_FOUND: cannot issue an invoice number');
  const prefix = (probe.invoiceSeries && probe.invoiceSeries.prefix) || probe.outletCode || 'STORE';
  const financialYear = currentFinancialYear(atDate);

  const updated = await StoreOutlet.findOneAndUpdate(
    { _id: outletId },
    {
      $set: { 'invoiceSeries.prefix': prefix, 'invoiceSeries.financialYear': financialYear },
      $inc: { 'invoiceSeries.lastSequence': 1 },
    },
    { new: true, projection: { invoiceSeries: 1 } }
  );
  if (!updated || !updated.invoiceSeries) throw new ApiError(httpStatus.CONFLICT, 'INVOICE_SERIES_BLOCKED: concurrent update, retry');

  const sequence = updated.invoiceSeries.lastSequence;
  return {
    invoiceNo: `${prefix}/${financialYear}/${String(sequence).padStart(6, '0')}`,
    sequence,
    financialYear,
    prefix,
  };
};

module.exports = {
  issueInvoiceNumber,
};
