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

const round2 = (value) => Number(Number(value || 0).toFixed(2));

function financialYear(at = new Date()) {
  const year = at.getUTCMonth() >= 3 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  const next = String((year + 1) % 100).padStart(2, '0');
  return `${year}-${next}`;
}

function stateCodeOf(value) {
  const match = String(value || '').trim().match(/^(\d{2})/);
  return match ? match[1] : '';
}

async function nextInvoiceNo(at = new Date(), { CounterModel } = {}) {
  const Counter = CounterModel || require('../models/localservice.fulfilment.model').LocalServiceInvoiceCounter;
  const fy = financialYear(at);
  const row = await Counter.findOneAndUpdate(
    { fy },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `LS/${fy}/${String(row.seq).padStart(6, '0')}`;
}

function invoiceLines(booking) {
  if ((booking.items || []).length) {
    return booking.items.map((item) => ({ label: item.label, amount: round2(item.lineTotal) }));
  }
  return [
    { label: 'Labour', amount: round2(booking.labourAmount) },
    { label: 'Parts', amount: round2(booking.partsAmount) },
  ];
}

function buildInvoicePayload({ booking, provider, invoiceNo, at = new Date() }) {
  const lines = invoiceLines(booking);
  const linesTotal = round2(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0));
  const taxTotal = round2(
    booking.taxAmount ||
      (booking.items || [])
        .filter((item) => item.kind === 'tax')
        .reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)
  );
  const taxableValue = round2(linesTotal - taxTotal);
  const taxPercent = taxableValue > 0 ? round2((taxTotal * 100) / taxableValue) : 0;

  const sellerState = stateCodeOf(provider && (provider.stateCode || provider.gstin));
  const buyer = booking.addressSnapshot || {};
  const placeOfSupply = stateCodeOf(buyer.stateCode || buyer.state) || sellerState;
  const isInterState = Boolean(sellerState && placeOfSupply && sellerState !== placeOfSupply);
  const cgst = isInterState ? 0 : round2(taxTotal / 2);
  const sgst = isInterState ? 0 : round2(taxTotal - cgst);
  const igst = isInterState ? taxTotal : 0;

  return {
    booking: booking._id || booking.id,
    invoiceNo,
    issuedAt: at,
    lines,
    sacCode: (provider && provider.sacCode) || '9987',
    seller: {
      name: (provider && provider.businessName) || '',
      gstin: (provider && provider.gstin) || '',
      address: (provider && provider.businessAddress) || '',
      stateCode: sellerState,
    },
    buyer: {
      name: buyer.name || buyer.fullName || '',
      gstin: buyer.gstin || '',
      address: buyer.address || buyer.line1 || '',
      stateCode: stateCodeOf(buyer.stateCode || buyer.state),
    },
    placeOfSupply,
    isInterState,
    taxableValue,
    taxPercent,
    cgst,
    sgst,
    igst,
    taxTotal,
    total: linesTotal,
    currency: 'INR',
    status: 'issued',
  };
}

async function issueInvoiceForBooking({ bookingId, at = new Date(), BookingModel, ProviderModel, InvoiceModel, CounterModel } = {}) {
  const fulfilment = require('../models/localservice.fulfilment.model');
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const Provider = ProviderModel || require('../models/localservice.provider.model');
  const Invoice = InvoiceModel || fulfilment.LocalServiceInvoice;
  const Counter = CounterModel || fulfilment.LocalServiceInvoiceCounter;

  const existing = await Invoice.findOne({ booking: bookingId });
  if (existing) return { invoice: existing, deduped: true };

  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('Booking not found');
  const provider = booking.provider ? await Provider.findById(booking.provider) : null;
  const invoiceNo = await nextInvoiceNo(at, { CounterModel: Counter });
  const payload = buildInvoicePayload({ booking, provider, invoiceNo, at });

  try {
    const invoice = await Invoice.create(payload);
    return { invoice, deduped: false };
  } catch (error) {
    if (error && error.code === 11000) {
      const raced = await Invoice.findOne({ booking: bookingId });
      if (raced) return { invoice: raced, deduped: true };
    }
    throw error;
  }
}

async function voidInvoiceForBooking({ bookingId, at = new Date(), InvoiceModel } = {}) {
  const Invoice = InvoiceModel || require('../models/localservice.fulfilment.model').LocalServiceInvoice;
  const invoice = await Invoice.findOne({ booking: bookingId });
  if (!invoice) return null;
  if (invoice.status !== 'void') {
    invoice.status = 'void';
    invoice.voidedAt = at;
    await invoice.save();
  }
  return invoice;
}

module.exports = {
  financialYear,
  stateCodeOf,
  nextInvoiceNo,
  buildInvoicePayload,
  issueInvoiceForBooking,
  voidInvoiceForBooking,
};
