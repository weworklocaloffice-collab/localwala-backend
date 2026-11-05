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
 * stores.invoice.service.js — server-controlled invoice numbers + legal tax
 * invoice document (BR-43, §6.19).
 *
 * Numbering: one gapless series per outlet: `{prefix}/{financialYear}/{sequence}`.
 * The sequence is a single atomic `$inc` on the outlet document, so two concurrent
 * orders can never share a number. Numbers are issued when an order becomes
 * billable (the `paid` transition), not at creation — an unpaid order never
 * consumes a number. Numbers are never reused; a cancelled paid order keeps its
 * number with `isVoided = true`.
 *
 * The invoice document (§6.19.1) is populated at the same moment: lines with
 * HSN/SAC, taxable value, CGST/SGST/IGST, place of supply, tax mode. Tax is
 * allocated per line at order time, so component refunds stay correct.
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

const issueInvoice = async (orderOrId) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = (typeof orderOrId === 'object' && orderOrId._id)
    ? orderOrId
    : await StoreOrder.findById(orderOrId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'ORDER_NOT_FOUND: cannot issue invoice');

  const { invoiceNo, financialYear } = await issueInvoiceNumber(order.outlet, { atDate: order.createdAt || new Date() });

  const StoreOutlet = mongoose.model('StoreOutlet');
  const outlet = await StoreOutlet.findById(order.outlet).select('taxIdentity').lean();
  const sellerGstin = (outlet && outlet.taxIdentity && outlet.taxIdentity.gstin) || null;

  // Buyer GSTIN: from the delivery address if the customer supplied one (B2B).
  let buyerGstin = null;
  if (order.address) {
    const UserAddress = mongoose.model('UserAddress');
    const addr = await UserAddress.findById(order.address).select('gstin').lean();
    if (addr && addr.gstin) buyerGstin = addr.gstin;
  }
  if (!buyerGstin && order.addressSnapshot && order.addressSnapshot.gstin) {
    buyerGstin = order.addressSnapshot.gstin;
  }

  const lines = (order.items || []).map((line) => ({
    hsn: line.hsn,
    description: line.name || 'Item',
    taxableValue: Math.round(((line.lineTotal || 0) - (line.cgstAmount || 0) - (line.sgstAmount || 0) - (line.igstAmount || 0)) * 100) / 100,
    cgst: line.cgstAmount || 0,
    sgst: line.sgstAmount || 0,
    igst: line.igstAmount || 0,
    total: line.lineTotal || 0,
  }));

  order.invoiceNo = invoiceNo;
  order.invoice = {
    invoiceNo,
    financialYear,
    issuedAt: new Date(),
    sellerGstin,
    buyerGstin,
    placeOfSupply: (order.placeOfSupply && (order.placeOfSupply.customerStateCode || order.placeOfSupply.outletStateCode)) || null,
    taxMode: 'inclusive',
    format: 'tax_invoice',
    isVoided: false,
    lines,
  };
  await order.save();
  return order.invoice;
};

const voidInvoice = async (orderId) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = await StoreOrder.findById(orderId);
  if (!order || !order.invoice || !order.invoice.invoiceNo) return null;
  order.invoice.isVoided = true;
  order.invoice.voidedAt = new Date();
  await order.save();
  return order.invoice;
};

const getFinancialYear = (date) => {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (m >= 3) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
};

module.exports = {
  issueInvoiceNumber,
  issueInvoice,
  voidInvoice,
  getFinancialYear,
};
