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

const RealEstateInvoice = require('../models/realestate.invoice.model');
const RealEstateSetting = require('../models/realestate.setting.model');
const sequence = require('../models/realestate.sequence.model');
const policyService = require('./realestate.hold.policy.service');
const auditService = require('./realestate.audit.service');

/**
 * Invoice service (Phase C) — issue under approved determinations only.
 *
 * OD-04 gate: `issueInvoice` resolves the supply's active tax via
 * `getActiveTaxForSupply` and REFUSES when inactive (no approved
 * written determination). There is no fallback rate, no default 18% —
 * unapproved revenue simply stays uninvoiced until finance + legal
 * approve. Callers (hold activation, commission computation, package
 * payment) stay untouched until that day; wiring them is the next step.
 *
 * Money: paise integers throughout. `amountPaise` is the exclusive
 * base unless `amountIsTotal` (inclusive pricing), in which case the
 * base is backed out: taxable = round(total*100/(100+rate)).
 */

// Hold-policy tax node key per invoice supply.
const SUPPLY_TAX_KEY = {
  HOLD_SERVICE_FEE: 'holdServiceFee',
  PROPERTY_SALE_COMMISSION: 'propertySaleCommission',
  HOLD_PRINCIPAL: 'holdPrincipal',
  LISTING_PACKAGE_FEE: 'listingPackageFee',
};

// Setting invoice-series key per invoice supply.
const SUPPLY_SERIES_KEY = {
  HOLD_SERVICE_FEE: 'holdServiceFee',
  PROPERTY_SALE_COMMISSION: 'propertySaleCommission',
  HOLD_PRINCIPAL: 'holdPrincipal',
  LISTING_PACKAGE_FEE: 'listingPackageFee',
};

function splitTax(taxablePaise, ratePercent, amountIsTotal) {
  let taxable;
  let tax;
  if (amountIsTotal) {
    taxable = Math.round((taxablePaise * 100) / (100 + ratePercent));
    tax = taxablePaise - taxable;
  } else {
    taxable = taxablePaise;
    tax = Math.round((taxablePaise * ratePercent) / 100);
  }
  return { taxablePaise: taxable, taxPaise: tax, totalPaise: taxable + tax };
}

async function nextInvoiceNo(seriesPrefix) {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seq = await sequence.next(`invoice:${seriesPrefix}:${period}`);
  return `${seriesPrefix}/${period}/${String(seq).padStart(4, '0')}`;
}

async function issueInvoice(
  {
    supply,
    buyerType,
    buyer = null,
    buyerGstin = null,
    amountPaise,
    amountIsTotal = false,
    sourceModel,
    sourceId,
    placeOfSupply = null,
    ledgerEntry = null,
  },
  session = null
) {
  if (!SUPPLY_TAX_KEY[supply]) throw new Error(`Unknown invoice supply: ${supply}`);
  if (!(amountPaise > 0)) throw new Error('Invoice amount must be positive (paise).');
  const policy = await policyService.getActive();
  const tax = policyService.getActiveTaxForSupply(policy, SUPPLY_TAX_KEY[supply]);
  if (!tax) {
    throw new Error(
      `Invoicing disabled for ${supply} — no approved written determination. ` +
        'Record and approve the tax configuration first (OD-04).'
    );
  }
  const settings = await RealEstateSetting.findOne().lean();
  const seriesMap = (settings && settings.taxInvoicing && settings.taxInvoicing.invoiceSeries) || {};
  const prefix = seriesMap[SUPPLY_SERIES_KEY[supply]] || `RE-${supply}`;
  const { taxablePaise, taxPaise, totalPaise } = splitTax(amountPaise, tax.applicableRate, amountIsTotal);
  const hsnNode = policy.taxConfiguration[SUPPLY_TAX_KEY[supply]];
  const doc = {
    invoiceNo: await nextInvoiceNo(prefix),
    kind: 'INVOICE',
    supply,
    status: 'ISSUED',
    buyerType,
    taxablePaise,
    ratePercent: tax.applicableRate,
    taxPaise,
    totalPaise,
    inclusivePricing: !!tax.inclusivePricing,
    hsnSac: (hsnNode && hsnNode.hsnSac) || null,
    taxClassification: tax.taxClassification,
    taxComponents: tax.taxComponents,
    orgGstin: (settings && settings.taxInvoicing && settings.taxInvoicing.orgGstin) || null,
    placeOfSupply:
      placeOfSupply ||
      (settings && settings.taxInvoicing && settings.taxInvoicing.defaultPlaceOfSupply) ||
      null,
    sourceModel,
    sourceId,
    taxSnapshot: tax,
  };
  if (buyer) doc.buyer = buyer;
  if (buyerGstin) doc.buyerGstin = buyerGstin;
  if (ledgerEntry) doc.ledgerEntry = ledgerEntry;
  const created = session
    ? (await RealEstateInvoice.create([doc], { session }))[0]
    : await RealEstateInvoice.create(doc);
  await auditService.record({
    eventType: 'REALESTATE_INVOICE_ISSUED',
    targetType: 'RealEstateInvoice',
    targetId: created._id,
    actorType: 'SYSTEM',
    metadata: { invoiceNo: created.invoiceNo, supply, totalPaise },
  });
  return created.toObject({ getters: true });
}

/**
 * Cancel via compensating credit note (BR-17 discipline). The original
 * row flips to CANCELLED but is never edited otherwise; the credit
 * note negates it and links back. Both rows stay in GSTR-1 scope.
 */
async function cancelInvoice(invoiceId, { reason = '', actorId = null } = {}, session = null) {
  const original = await RealEstateInvoice.findById(invoiceId);
  if (!original) throw new Error('Invoice not found.');
  if (original.status === 'CANCELLED') throw new Error('Invoice is already cancelled.');
  if (!reason || !String(reason).trim()) throw new Error('A cancellation reason is required.');
  const prefix = String(original.invoiceNo).split('/')[0] || 'RE-CN';
  const note = {
    invoiceNo: await nextInvoiceNo(`CN-${prefix}`),
    kind: 'CREDIT_NOTE',
    supply: original.supply,
    status: 'ISSUED',
    buyerType: original.buyerType,
    buyer: original.buyer,
    buyerGstin: original.buyerGstin,
    taxablePaise: -original.taxablePaise,
    ratePercent: original.ratePercent,
    taxPaise: -original.taxPaise,
    totalPaise: -original.totalPaise,
    inclusivePricing: original.inclusivePricing,
    hsnSac: original.hsnSac,
    taxClassification: original.taxClassification,
    taxComponents: original.taxComponents,
    orgGstin: original.orgGstin,
    placeOfSupply: original.placeOfSupply,
    sourceModel: original.sourceModel,
    sourceId: original.sourceId,
    taxSnapshot: original.taxSnapshot,
    creditNoteOf: original._id,
    cancelReason: String(reason).trim(),
  };
  original.status = 'CANCELLED';
  original.cancelledAt = new Date();
  original.cancelReason = String(reason).trim();
  await original.save(session ? { session } : {});
  const created = session
    ? (await RealEstateInvoice.create([note], { session }))[0]
    : await RealEstateInvoice.create(note);
  await auditService.record({
    eventType: 'REALESTATE_INVOICE_CANCELLED',
    targetType: 'RealEstateInvoice',
    targetId: original._id,
    actor: actorId,
    actorType: actorId ? 'ADMIN' : 'SYSTEM',
    reason: String(reason).trim(),
    metadata: { invoiceNo: original.invoiceNo, creditNoteNo: created.invoiceNo },
  });
  return created.toObject({ getters: true });
}

async function listInvoices({ supply, status, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (supply) filter.supply = supply;
  if (status) filter.status = status;
  const [docs, total] = await Promise.all([
    RealEstateInvoice.find(filter)
      .sort({ issuedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RealEstateInvoice.countDocuments(filter),
  ]);
  return { results: docs, total, page, limit };
}

/**
 * GSTR-1 scope rows: ISSUED invoices + ISSUED credit notes (negatives),
 * within [from, to]. Rendered from frozen rows only — never live config.
 * Tax split (CGST/SGST/IGST) is the CA's mapping over `taxComponents`;
 * this export carries the frozen total + components label.
 */
async function gstr1Scope({ from, to }) {
  return RealEstateInvoice.find({
    status: 'ISSUED',
    issuedAt: { $gte: new Date(from), $lte: new Date(to) },
  })
    .sort({ issuedAt: 1 })
    .lean();
}

function gstr1Csv(rows) {
  const header = [
    'gstin',
    'invoice_no',
    'invoice_date',
    'kind',
    'supply',
    'hsn_sac',
    'taxable_value_paise',
    'tax_rate_percent',
    'tax_amount_paise',
    'total_paise',
    'place_of_supply',
    'buyer_gstin',
    'credit_note_of',
  ].join(',');
  const lines = rows.map((r) =>
    [
      r.orgGstin || '',
      r.invoiceNo,
      new Date(r.issuedAt).toISOString().slice(0, 10),
      r.kind,
      r.supply,
      r.hsnSac || '',
      r.taxablePaise,
      r.ratePercent,
      r.taxPaise,
      r.totalPaise,
      r.placeOfSupply || '',
      r.buyerGstin || '',
      r.creditNoteOf || '',
    ].join(',')
  );
  return [header, ...lines].join('\n');
}

const realEstateInvoiceService = {
  SUPPLY_TAX_KEY,
  splitTax,
  nextInvoiceNo,
  issueInvoice,
  cancelInvoice,
  listInvoices,
  gstr1Scope,
  gstr1Csv,
};

module.exports = realEstateInvoiceService;
