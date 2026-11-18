const mongoose = require('mongoose');

const invoicePartySchema = new mongoose.Schema(
  {
    name: { type: String, required: false, trim: true },
    gstin: { type: String, required: false, trim: true, uppercase: true },
    address: { type: String, required: false, trim: true },
    stateCode: { type: String, required: false, trim: true },
  },
  { _id: false }
);

const invoiceLineSchema = new mongoose.Schema(
  {
    orderItem: { type: mongoose.SchemaTypes.ObjectId, required: false },
    hsn: { type: String, required: false, trim: true, uppercase: true },
    description: { type: String, required: true, trim: true },
    quantity: { type: mongoose.SchemaTypes.Mixed, required: false },
    unit: { type: String, required: false, trim: true },
    unitPrice: { type: Number, required: false, default: 0 },
    taxableValue: { type: Number, required: true, default: 0 },
    taxRatePct: { type: Number, required: false, default: 0 },
    cgst: { type: Number, required: false, default: 0 },
    sgst: { type: Number, required: false, default: 0 },
    igst: { type: Number, required: false, default: 0 },
    total: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const invoiceChargeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    taxableValue: { type: Number, required: true, default: 0 },
    taxRatePct: { type: Number, required: false, default: 0 },
    cgst: { type: Number, required: false, default: 0 },
    sgst: { type: Number, required: false, default: 0 },
    igst: { type: Number, required: false, default: 0 },
    total: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const invoiceTotalsSchema = new mongoose.Schema(
  {
    itemsTotal: { type: Number, required: false, default: 0 },
    chargesTotal: { type: Number, required: false, default: 0 },
    taxableValue: { type: Number, required: false, default: 0 },
    cgst: { type: Number, required: false, default: 0 },
    sgst: { type: Number, required: false, default: 0 },
    igst: { type: Number, required: false, default: 0 },
    taxTotal: { type: Number, required: false, default: 0 },
    discountTotal: { type: Number, required: false, default: 0 },
    roundOff: { type: Number, required: false, default: 0 },
    grandTotal: { type: Number, required: false, default: 0 },
    amountPaid: { type: Number, required: false, default: 0 },
    amountRefunded: { type: Number, required: false, default: 0 },
    netAmount: { type: Number, required: false, default: 0 },
  },
  { _id: false }
);

const jhatkaInvoiceSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, required: false, trim: true },
    financialYear: { type: String, required: false, trim: true },
    status: {
      type: String,
      required: false,
      enum: ['issuing', 'issued', 'void'],
      default: 'issued',
    },
    issuedAt: { type: Date, required: false },
    issuingAt: { type: Date, required: false },
    isTaxInvoice: { type: Boolean, required: false, default: false },
    seller: { type: invoicePartySchema, required: false },
    buyer: { type: invoicePartySchema, required: false },
    placeOfSupply: { type: String, required: false, trim: true },
    isInterState: { type: Boolean, required: false, default: false },
    taxMode: { type: String, required: false, default: 'exclusive' },
    lines: { type: [invoiceLineSchema], required: false, default: [] },
    charges: { type: [invoiceChargeSchema], required: false, default: [] },
    totals: { type: invoiceTotalsSchema, required: false },
    notes: { type: [String], required: false, default: [] },
    isVoided: { type: Boolean, required: false, default: false },
    voidedAt: { type: Date, required: false },
  },
  { _id: false }
);

module.exports = jhatkaInvoiceSchema;
