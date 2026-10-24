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

const RealEstateSale = require('../models/realestate.sale.model');
const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
const RealEstateLead = require('../models/realestate.lead.model');
const commissionService = require('./realestate.commission.service');
const fcmNotificationService = require('../../../services/fcm.notification.service');

let saleSequence = 0;

function nextSaleCode() {
  saleSequence += 1;
  const ts = Date.now().toString().slice(-6);
  return `RE-SALE-${ts}-${String(saleSequence).padStart(4, '0')}`;
}

/**
 * Record a sale. If `holdId` is given, the hold's principal is
 * applied against `saleValue` (plan §6.2: never revenue, never a
 * refund) and the hold moves to CONVERTED_TO_SALE.
 *
 * Commissions are computed from frozen rules in the same call so a
 * sale never exists without its payout rows.
 */
async function recordSale(
  { property, customer, vendor = null, lead = null, holdId = null, saleValue, transactionType = 'BUY', referralRate = 0, executiveRate = 0, referrer = null, executive = null },
  session = null
) {
  if (!(saleValue > 0)) throw new Error('saleValue must be positive');

  let hold = null;
  let holdPrincipalApplied = 0;
  if (holdId) {
    hold = await RealEstatePropertyHold.findById(holdId);
    if (!hold) throw new Error('Hold not found');
    if (hold.status !== 'ACTIVE') throw new Error(`Only an ACTIVE hold converts (now ${hold.status}).`);
    holdPrincipalApplied = hold.principal;
  }

  const doc = {
    saleCode: nextSaleCode(),
    property,
    customer,
    saleValue,
    transactionType,
    status: 'COMPLETED',
    holdPrincipalApplied,
  };
  if (vendor) doc.vendor = vendor;
  if (lead) doc.lead = lead;
  if (hold) doc.hold = hold._id;

  const sale = session ? (await RealEstateSale.create([doc], { session }))[0] : await RealEstateSale.create(doc);

  if (hold) {
    hold.status = 'CONVERTED_TO_SALE';
    hold.convertedSale = sale._id;
    await hold.save(session ? { session } : {});
  }

  const commissions = await commissionService.computeSaleCommissions(
    { saleId: sale._id, saleValue, referralRate, executiveRate, referrer, executive },
    session
  );

  // Phase 10: customer + vendor confirmation. Never throws into recording.
  try {
    await fcmNotificationService.realEstateSaleRecorded({
      userId: customer,
      recipientType: 'CUSTOMER',
      title: 'Sale recorded',
      body: `Sale ${sale.saleCode} recorded for ₹${saleValue.toLocaleString('en-IN')}.`,
      data: { saleId: String(sale._id), propertyId: String(property) },
    });
    if (vendor) {
      await fcmNotificationService.realEstateSaleRecorded({
        userId: vendor,
        recipientType: 'VENDOR',
        title: 'Sale recorded',
        body: `Sale ${sale.saleCode} recorded for ₹${saleValue.toLocaleString('en-IN')}.`,
        data: { saleId: String(sale._id), propertyId: String(property) },
      });
    }
  } catch {
    /* notify-only */
  }

  return { sale, commissions };
}

/**
 * Vendor's own sales, paginated.
 *
 * The sale carries a denormalised `vendor` field, so this is a direct
 * filter — no property chain, no $lookup.
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {{ page?: number, limit?: number }} opts
 */
async function listForVendor(vendorId, { page = 1, limit = 20 } = {}) {
  if (!vendorId) return { results: [], total: 0, page, limit };
  const filter = { vendor: vendorId };
  const [docs, total] = await Promise.all([
    RealEstateSale.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customer', 'firstName lastName mobile')
      .populate('property', 'title propertyCode'),
    RealEstateSale.countDocuments(filter),
  ]);
  // Hydrated — `saleValue` / `holdPrincipalApplied` are moneyFields.
  // See the money-edges gate: lean reads ship paise.
  const results = docs.map((d) => d.toObject({ getters: true }));
  return { results, total, page, limit };
}

/**
 * One sale, scoped to the owning vendor. Returns null when the sale
 * does not exist OR belongs to another vendor.
 */
async function findByIdForVendor(saleId, vendorId) {
  const doc = await RealEstateSale.findOne({ _id: saleId, vendor: vendorId })
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title propertyCode');
  return doc ? doc.toObject({ getters: true }) : null;
}

/**
 * Customer's own purchases, newest first.
 *
 * The customer id comes from the access token, never the query, so this
 * endpoint cannot enumerate another customer's sale history. Hydrated
 * reads keep `saleValue` / `holdPrincipalApplied` in rupees at the edge.
 *
 * @param {mongoose.Types.ObjectId} customerId
 * @param {{ page?: number, limit?: number }} opts
 */
async function listForCustomer(customerId, { page = 1, limit = 20 } = {}) {
  if (!customerId) return { results: [], total: 0, page, limit };
  const filter = { customer: customerId };
  const [docs, total] = await Promise.all([
    RealEstateSale.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('property', 'title propertyCode addressLine')
      .populate('hold', 'holdCode status'),
    RealEstateSale.countDocuments(filter),
  ]);
  const results = docs.map((d) => d.toObject({ getters: true }));
  return { results, total, page, limit };
}

/**
 * One sale, scoped to the customer who bought it. A sale belonging to
 * someone else is indistinguishable from a missing sale.
 */
async function findByIdForCustomer(saleId, customerId) {
  const doc = await RealEstateSale.findOne({ _id: saleId, customer: customerId })
    .populate('property', 'title propertyCode addressLine transactionType')
    .populate('hold', 'holdCode status principal');
  return doc ? doc.toObject({ getters: true }) : null;
}

async function listForExecutive(executiveId, { page = 1, limit = 20 } = {}) {
  const leads = await RealEstateLead.find({ executive: executiveId }).select('_id').lean();
  if (!leads.length) return { results: [], total: 0, page, limit };
  const filter = { lead: { $in: leads.map((l) => l._id) } };
  const [docs, total] = await Promise.all([
    RealEstateSale.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customer', 'firstName lastName mobile')
      .populate('property', 'title propertyCode'),
    RealEstateSale.countDocuments(filter),
  ]);
  const results = docs.map((d) => d.toObject({ getters: true }));
  return { results, total, page, limit };
}

async function findByIdForExecutive(saleId, executiveId) {
  const leads = await RealEstateLead.find({ executive: executiveId }).select('_id').lean();
  if (!leads.length) return null;
  const doc = await RealEstateSale.findOne({
    _id: saleId,
    lead: { $in: leads.map((l) => l._id) },
  })
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title propertyCode');
  return doc ? doc.toObject({ getters: true }) : null;
}

const realEstateSaleService = {
  recordSale,
  listForVendor,
  findByIdForVendor,
  listForCustomer,
  findByIdForCustomer,
  listForExecutive,
  findByIdForExecutive,
};

module.exports = realEstateSaleService;
