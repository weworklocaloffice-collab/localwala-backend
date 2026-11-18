const mongoose = require('mongoose');
require('../models/jhatka.credit.note.model');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const BILLABLE_LIFECYCLES = ['DELIVERED', 'COMPLETED', 'REFUND_PENDING', 'REFUNDED'];
const PAID_STATUSES = ['paid', 'partially_refunded', 'refunded'];

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const financialYear = (date) => {
  const d = new Date(new Date(date).getTime() + (5.5 * 60 * 60 * 1000));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return month >= 3 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
};

const splitTax = (taxAmount, isInterState) => {
  const tax = roundMoney(taxAmount);
  if (isInterState) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = roundMoney(tax / 2);
  return { cgst, sgst: roundMoney(tax - cgst), igst: 0 };
};

const getOrderModel = () => mongoose.model('JhatkaOrder');
const getOutletModel = () => mongoose.model('JhatkaOutlet');

const sellerGstinFor = (order, outlet) =>
  process.env.JHATKA_INVOICE_SELLER_GSTIN ||
  order.merchantOfRecord?.gstin ||
  outlet?.taxIdentity?.gstin ||
  null;

const sellerStateCodeFor = (order, outlet) => {
  const gstin = sellerGstinFor(order, outlet);
  if (gstin && /^\d{2}/.test(gstin)) return gstin.slice(0, 2);
  return outlet?.address?.stateCode || null;
};

const buyerFromOrder = (order) => {
  const address = order.addressSnapshot || order.deliveryAddressSnapshot || {};
  const parts = [address.flatHouse, address.locality, address.state, address.pincode].filter(Boolean);
  return {
    name: address.receiverName || null,
    gstin: address.gstin || null,
    address: parts.length ? parts.join(', ') : null,
    stateCode: address.stateCode || null,
  };
};

const buildInvoice = (order, outlet, options = {}) => {
  const seller = {
    name: process.env.JHATKA_INVOICE_SELLER_NAME || order.merchantOfRecord?.name || 'LocalWala',
    gstin: sellerGstinFor(order, outlet),
    address: process.env.JHATKA_INVOICE_SELLER_ADDRESS || order.outletSnapshot?.address || null,
    stateCode: sellerStateCodeFor(order, outlet),
  };
  const buyer = buyerFromOrder(order);
  const taxSplit = order.taxSnapshot?.split || {};
  const isInterState = buyer.stateCode && seller.stateCode
    ? buyer.stateCode !== seller.stateCode
    : Boolean(taxSplit.isInterState);

  const lines = (order.items || []).map((item) => {
    const taxableValue = roundMoney(item.lineTotal);
    const taxAmount = roundMoney(item.taxAmount);
    const split = splitTax(taxAmount, isInterState);
    return {
      orderItem: item._id,
      hsn: item.hsnCode || null,
      description: [item.name, item.variantName].filter(Boolean).join(' - '),
      quantity: item.requestedQuantity || null,
      unit: item.unitLabel || null,
      unitPrice: roundMoney(item.unitPrice),
      taxableValue,
      taxRatePct: Number(item.taxRatePct || 0),
      ...split,
      total: roundMoney(taxableValue + taxAmount),
    };
  });

  const charges = [];
  const addCharge = (code, description, taxableValue, taxAmount) => {
    const taxable = roundMoney(taxableValue);
    const tax = roundMoney(taxAmount);
    if (taxable <= 0 && tax <= 0) return;
    const split = splitTax(tax, isInterState);
    charges.push({
      code,
      description,
      taxableValue: taxable,
      taxRatePct: taxable > 0 ? roundMoney((tax / taxable) * 100) : 0,
      ...split,
      total: roundMoney(taxable + tax),
    });
  };

  addCharge('DELIVERY', 'Delivery fee', order.deliveryFee, order.deliveryTax);
  addCharge('PACKAGING', 'Packaging fee', order.packagingFee, 0);
  addCharge('SERVICE', 'Service fee', order.serviceFee, 0);

  const sum = (rows, key) => roundMoney(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
  const itemsTotal = sum(lines, 'total');
  const chargesTotal = sum(charges, 'total');
  const discountTotal = roundMoney(order.discountTotal);
  const grandTotal = roundMoney(order.estimatedTotal || itemsTotal + chargesTotal - discountTotal);
  const amountPaid = roundMoney(order.paidAmount);
  const amountRefunded = roundMoney(order.refundedAmount);

  return {
    invoiceNo: options.invoiceNo || null,
    financialYear: options.financialYear || null,
    status: options.status || 'preview',
    issuedAt: options.issuedAt || null,
    isTaxInvoice: Boolean(seller.gstin) && options.status === 'issued',
    seller,
    buyer,
    placeOfSupply: buyer.stateCode || seller.stateCode || null,
    isInterState,
    taxMode: 'exclusive',
    lines,
    charges,
    totals: {
      itemsTotal,
      chargesTotal,
      taxableValue: roundMoney(sum(lines, 'taxableValue') + sum(charges, 'taxableValue')),
      cgst: roundMoney(sum(lines, 'cgst') + sum(charges, 'cgst')),
      sgst: roundMoney(sum(lines, 'sgst') + sum(charges, 'sgst')),
      igst: roundMoney(sum(lines, 'igst') + sum(charges, 'igst')),
      taxTotal: roundMoney(sum(lines, 'cgst') + sum(lines, 'sgst') + sum(lines, 'igst') + sum(charges, 'cgst') + sum(charges, 'sgst') + sum(charges, 'igst')),
      discountTotal,
      roundOff: roundMoney(grandTotal - (itemsTotal + chargesTotal - discountTotal)),
      grandTotal,
      amountPaid,
      amountRefunded,
      netAmount: roundMoney(grandTotal - amountRefunded),
    },
    notes: ['Computer generated invoice.'],
    isVoided: false,
  };
};

const eligibility = (order, outlet) => {
  if (['CANCELLED', 'REJECTED', 'PAYMENT_FAILED'].includes(order.lifecycle)) {
    return { eligible: false, reason: 'ORDER_NOT_BILLABLE' };
  }
  if (!BILLABLE_LIFECYCLES.includes(order.lifecycle)) {
    return { eligible: false, reason: 'ORDER_NOT_COMPLETED' };
  }
  if (!PAID_STATUSES.includes(order.paymentStatus)) {
    return { eligible: false, reason: 'PAYMENT_NOT_SETTLED' };
  }
  if (!sellerGstinFor(order, outlet)) {
    return { eligible: false, reason: 'SELLER_GSTIN_MISSING' };
  }
  return { eligible: true, reason: null };
};

const issueInvoiceNumber = async (outlet, atDate) => {
  const configuredPrefix = process.env.JHATKA_INVOICE_PREFIX;
  const prefix = String(
    configuredPrefix
      ? `${configuredPrefix}-${outlet.outletCode || String(outlet._id).slice(-6)}`
      : outlet.invoiceSeries?.prefix || outlet.outletCode || 'LW'
  ).toUpperCase();
  const fy = financialYear(atDate);
  const Outlet = getOutletModel();

  const updated = await Outlet.findOneAndUpdate(
    { _id: outlet._id },
    [
      {
        $set: {
          invoiceSeries: {
            prefix,
            financialYear: fy,
            lastSequence: {
              $cond: [
                { $eq: ['$invoiceSeries.financialYear', fy] },
                { $add: [{ $ifNull: ['$invoiceSeries.lastSequence', 0] }, 1] },
                1,
              ],
            },
          },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true, projection: { invoiceSeries: 1 } }
  );
  if (!updated?.invoiceSeries) {
    throw new ApiError(httpStatus.CONFLICT, 'INVOICE_SERIES_BLOCKED');
  }
  return {
    invoiceNo: `${prefix}/${fy}/${String(updated.invoiceSeries.lastSequence).padStart(6, '0')}`,
    financialYear: fy,
  };
};

const issueInvoice = async (order, outlet) => {
  const claimAt = new Date();
  const staleClaimAt = new Date(claimAt.getTime() - (5 * 60 * 1000));
  const Order = getOrderModel();
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      customer: order.customer,
      $or: [
        { 'invoice.invoiceNo': { $exists: false }, 'invoice.status': { $ne: 'issuing' } },
        { 'invoice.invoiceNo': null, 'invoice.status': { $ne: 'issuing' } },
        { 'invoice.status': 'issuing', 'invoice.issuingAt': { $lt: staleClaimAt } },
      ],
    },
    { $set: { 'invoice.status': 'issuing', 'invoice.issuingAt': claimAt } },
    { returnDocument: 'after' }
  );

  if (!claimed) {
    const current = await Order.findById(order._id);
    if (current?.invoice?.invoiceNo) {
      return { invoice: current.invoice, issued: true, preview: false, reason: null };
    }
    throw new ApiError(httpStatus.CONFLICT, 'INVOICE_ISSUE_CONFLICT');
  }

  const number = await issueInvoiceNumber(outlet, claimAt);
  const invoice = buildInvoice(claimed, outlet, {
    invoiceNo: number.invoiceNo,
    financialYear: number.financialYear,
    status: 'issued',
    issuedAt: claimAt,
  });

  const saved = await Order.findOneAndUpdate(
    { _id: order._id, 'invoice.status': 'issuing', 'invoice.issuingAt': claimAt },
    { $set: { invoice } },
    { returnDocument: 'after' }
  );
  if (!saved) throw new ApiError(httpStatus.CONFLICT, 'INVOICE_ISSUE_CONFLICT');
  return { invoice: saved.invoice, issued: true, preview: false, reason: null };
};

const getInvoice = async (orderId, customerId) => {
  const Order = getOrderModel();
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (String(order.customer) !== String(customerId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Order not found for this account');
  }

  if (order.invoice?.invoiceNo && order.invoice.status !== 'issuing') {
    return { invoice: order.invoice, issued: true, preview: false, reason: null };
  }

  const outlet = await getOutletModel().findById(order.outlet);
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

  const state = eligibility(order, outlet);
  if (!state.eligible) {
    return {
      invoice: buildInvoice(order, outlet),
      issued: false,
      preview: true,
      reason: state.reason,
    };
  }

  return issueInvoice(order, outlet);
};

const issueCreditNoteNumber = async (outlet, atDate) => {
  const configuredPrefix = process.env.JHATKA_CREDIT_NOTE_PREFIX;
  const prefix = String(
    configuredPrefix
      ? `${configuredPrefix}-${outlet.outletCode || String(outlet._id).slice(-6)}`
      : outlet.creditNoteSeries?.prefix || `CN-${outlet.outletCode || 'LW'}`
  ).toUpperCase();
  const fy = financialYear(atDate);
  const Outlet = getOutletModel();

  const updated = await Outlet.findOneAndUpdate(
    { _id: outlet._id },
    [
      {
        $set: {
          creditNoteSeries: {
            prefix,
            financialYear: fy,
            lastSequence: {
              $cond: [
                { $eq: ['$creditNoteSeries.financialYear', fy] },
                { $add: [{ $ifNull: ['$creditNoteSeries.lastSequence', 0] }, 1] },
                1,
              ],
            },
          },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true, projection: { creditNoteSeries: 1 } }
  );
  if (!updated?.creditNoteSeries) {
    throw new ApiError(httpStatus.CONFLICT, 'CREDIT_NOTE_SERIES_BLOCKED');
  }
  return {
    creditNoteNo: `${prefix}/${fy}/${String(updated.creditNoteSeries.lastSequence).padStart(6, '0')}`,
    financialYear: fy,
  };
};

const voidInvoice = async (orderId, reason, _actorId) => {
  if (!reason || !String(reason).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required');
  }
  const Order = getOrderModel();
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  if (!order.invoice?.invoiceNo) {
    throw new ApiError(httpStatus.CONFLICT, 'NO_ISSUED_INVOICE');
  }
  if (order.invoice.isVoided) {
    throw new ApiError(httpStatus.CONFLICT, 'INVOICE_ALREADY_VOIDED');
  }

  const outlet = await getOutletModel().findById(order.outlet);
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

  const claimAt = new Date();
  const number = await issueCreditNoteNumber(outlet, claimAt);

  const CreditNote = mongoose.model('JhatkaCreditNote');
  const creditNote = await CreditNote.create({
    creditNoteNo: number.creditNoteNo,
    financialYear: number.financialYear,
    invoiceNo: order.invoice.invoiceNo,
    order: order._id,
    outlet: order.outlet,
    business: order.business,
    reason: String(reason).trim(),
    amount: order.invoice.totals?.grandTotal || 0,
    taxTotal: order.invoice.totals?.taxTotal || 0,
    issuedAt: claimAt,
    status: 'issued',
  });

  order.invoice.isVoided = true;
  order.invoice.voidedAt = claimAt;
  order.invoice.status = 'void';
  if (!Array.isArray(order.invoice.notes)) order.invoice.notes = [];
  order.invoice.notes.push(`Voided: ${String(reason).trim()}`);
  await order.save();

  return { invoice: order.invoice, creditNote: creditNote.toObject(), voidedAt: claimAt };
};

module.exports = {
  BILLABLE_LIFECYCLES,
  financialYear,
  buildInvoice,
  issueInvoiceNumber,
  issueCreditNoteNumber,
  getInvoice,
  voidInvoice,
};
