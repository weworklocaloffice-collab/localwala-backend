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

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstateInvoice — one issued tax invoice or credit note (Phase C).
 *
 * Issued ONLY under an approved written determination for the supply
 * (OD-04): the service refuses when the supply's tax is inactive, so
 * production invoicing stays disabled until finance + legal approve.
 * Every money figure is paise integers frozen at issue; later config
 * edits never restate a row. Cancellations are compensating credit
 * notes, never edits (BR-17 discipline applied to invoices).
 */
const realEstateInvoiceSchema = mongoose.Schema(
  {
    invoiceNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    /** CREDIT_NOTE rows negate an issued invoice; else INVOICE. */
    kind: {
      type: String,
      required: true,
      default: 'INVOICE',
      enum: ['INVOICE', 'CREDIT_NOTE'],
    },

    supply: {
      type: String,
      required: true,
      enum: [
        'HOLD_SERVICE_FEE',
        'PROPERTY_SALE_COMMISSION',
        'HOLD_PRINCIPAL',
        'LISTING_PACKAGE_FEE',
      ],
    },

    status: {
      type: String,
      required: true,
      default: 'ISSUED',
      enum: ['ISSUED', 'CANCELLED'],
    },

    buyerType: {
      type: String,
      required: true,
      enum: ['CUSTOMER', 'VENDOR', 'BANK', 'LOCALWALA'],
    },
    buyer: { type: mongoose.SchemaTypes.ObjectId, required: false },
    buyerGstin: { type: String, required: false, trim: true, uppercase: true },

    /** Paise integers. */
    taxablePaise: { type: Number, required: true, min: 0 },
    /** Approved rate in percent points, e.g. 18 for 18%. */
    ratePercent: { type: Number, required: true, min: 0, max: 100 },
    taxPaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    inclusivePricing: { type: Boolean, default: false },

    hsnSac: { type: String, required: false, trim: true },
    taxClassification: { type: String, required: false, trim: true },
    taxComponents: { type: String, required: false, trim: true },
    orgGstin: { type: String, required: false, trim: true, uppercase: true },
    placeOfSupply: { type: String, required: false, trim: true },

    sourceModel: { type: String, required: true, trim: true },
    sourceId: { type: mongoose.SchemaTypes.ObjectId, required: true },

    ledgerEntry: { type: mongoose.SchemaTypes.ObjectId, ref: 'RealEstateLedgerEntry', required: false },

    /** Frozen approved-tax snapshot at issue (BR-15 for invoices). */
    taxSnapshot: { type: mongoose.SchemaTypes.Mixed, required: false, default: {} },

    /** For CREDIT_NOTE rows: the cancelled invoice. */
    creditNoteOf: { type: mongoose.SchemaTypes.ObjectId, ref: 'RealEstateInvoice', required: false },
    cancelReason: { type: String, required: false, trim: true },

    issuedAt: { type: Date, required: true, default: Date.now },
    cancelledAt: { type: Date, required: false },

    // E-invoice stubs (Phase C later): populated by the ASP integration,
    // never hand-edited. Null until then.
    irn: { type: String, required: false, trim: true },
    qrCode: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateInvoiceSchema.plugin(toJSON);
realEstateInvoiceSchema.plugin(paginate);

realEstateInvoiceSchema.index({ invoiceNo: 1 }, { unique: true });
realEstateInvoiceSchema.index({ supply: 1, status: 1, issuedAt: -1 });
realEstateInvoiceSchema.index({ sourceModel: 1, sourceId: 1 });
realEstateInvoiceSchema.index({ status: 1, issuedAt: -1 });

/**
 * @typedef RealEstateInvoice
 */
const RealEstateInvoice = mongoose.model('RealEstateInvoice', realEstateInvoiceSchema);

module.exports = RealEstateInvoice;
