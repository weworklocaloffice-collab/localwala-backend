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
const { toJSON, paginate, slugGenerator } = require('../../../models/plugins');

/**
 * JhatkaSupplier — a business that sells us raw meat.
 *
 * ## Documents are a SEPARATE model, deliberately
 *
 * The source blueprint's §25 asks for "supplier documents" alongside the supplier.
 * Keeping them in one document makes an FSSAI expiry sweep load every bank account
 * and address for every supplier in the city to check one date.
 *
 * `DairyCompliance` already proves the separate-index approach works — it declares
 * `{ 'fssai.expiresAt': 1 }` precisely so expiry sweeps are cheap. Same reasoning,
 * same shape.
 *
 * ## Suspending a supplier has a deliberately small blast radius
 *
 * `status: 'suspended'` blocks NEW receipts from that supplier. It does not block
 * orders, does not suspend the outlet, and does not touch stock already received.
 * One supplier's licence lapsing at 8am must not take down a butcher shop that has
 * two other suppliers and 40 orders booked.
 */
const SUPPLIER_STATUSES = ['active', 'suspended', 'terminated'];

const jhatkaSupplierSchema = mongoose.Schema(
  {
    /** Human-facing code. Appears on purchase orders and payables. */
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
    },
    legalName: {
      type: String,
      required: false,
      trim: true,
    },
    /** Categories this supplier is APPROVED to deliver. §5.2 */
    categories: {
      type: [String],
      required: false,
      default: [],
      validate: {
        validator: (v) =>
          Array.isArray(v) && v.every((c) => ['chicken', 'mutton', 'fish_seafood', 'eggs'].includes(c)),
        message: 'categories must be drawn from the four launch category keys',
      },
    },
    contact: {
      name: { type: String, required: false, trim: true },
      mobile: { type: Number, required: false },
      countryCode: { type: String, required: false },
      email: { type: String, required: false, trim: true, lowercase: true },
      altMobile: { type: Number, required: false },
    },
    address: {
      line1: { type: String, required: false, trim: true },
      line2: { type: String, required: false, trim: true },
      city: { type: mongoose.SchemaTypes.ObjectId, ref: 'City', required: false },
      locality: { type: mongoose.SchemaTypes.ObjectId, ref: 'Locality', required: false },
      pincode: { type: String, required: false, trim: true },
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: false,
      },
    },
    /**
     * FSSAI. A supplier of fresh meat without one is not a supplier we can trade
     * with, and this is the single most compliance-critical field on the model.
     *
     * Mirrors `DairySupplier`/`DairyCompliance.fssai` shape so the expiry sweep is
     * the same query across both verticals.
     */
    fssai: {
      licenceNumber: { type: String, required: false, trim: true },
      category: {
        type: String,
        required: false,
        enum: ['registration', 'state_licence', 'central_licence'],
      },
      issuedAt: { type: Date, required: false },
      expiresAt: { type: Date, required: false },
      documentUrl: { type: String, required: false },
    },
    gstin: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },
    /**
     * §10.2. Days between an accepted receipt and its payment. Direct outlets pay
     * same-day because there is no counterparty to finance; franchisees get credit
     * because they hold our stock (BR-05).
     */
    creditTermDays: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    bank: {
      accountName: { type: String, required: false, trim: true },
      accountNumber: { type: String, required: false, trim: true },
      ifsc: { type: String, required: false, trim: true, uppercase: true },
      upiId: { type: String, required: false, trim: true },
    },
    /**
     * Rolling quality score, 0-100. Maintained by the receipt quality gate, not
     * set by hand — a number a person types is a number nobody trusts.
     */
    qualityRating: {
      type: Number,
      required: false,
      default: 100,
      min: 0,
      max: 100,
    },
    /** Lifetime tallies. Read-only, maintained by the procurement service. */
    stats: {
      totalReceipts: { type: Number, required: false, default: 0, min: 0 },
      totalAcceptedQty: { type: Number, required: false, default: 0 },
      totalRejectedQty: { type: Number, required: false, default: 0 },
      totalPayable: { type: Number, required: false, default: 0 },
      lastDeliveryAt: { type: Date, required: false },
    },
    status: {
      type: String,
      required: false,
      enum: SUPPLIER_STATUSES,
      default: 'active',
    },
    /** Why it was suspended/terminated. Mandatory for terminated. */
    statusReason: {
      type: String,
      required: false,
      trim: true,
    },
    suspendedAt: { type: Date, required: false },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaSupplierSchema.plugin(toJSON);
jhatkaSupplierSchema.plugin(paginate);
jhatkaSupplierSchema.plugin(slugGenerator);
jhatkaSupplierSchema.index({ code: 1 }, { unique: true });
jhatkaSupplierSchema.index({ status: 1, name: 1 });
// The order form's supplier picker.
jhatkaSupplierSchema.index({ categories: 1, status: 1 });
// The expiry sweep. Mirrors `DairyCompliance`'s dedicated index.
jhatkaSupplierSchema.index({ 'fssai.expiresAt': 1 });
jhatkaSupplierSchema.index({ gstin: 1 });
jhatkaSupplierSchema.index({ location: '2dsphere' });

jhatkaSupplierSchema.statics.STATUSES = SUPPLIER_STATUSES;

/**
 * Is this supplier's FSSAI lapsed? Blocks NEW receipts. §12.2.
 *
 * "New" is doing real work in that sentence: stock already received is unaffected,
 * and a supplier whose licence expired yesterday may not deliver today.
 */
jhatkaSupplierSchema.methods.canDeliver = function (now = new Date()) {
  if (this.status !== 'active') return false;
  if (this.fssai?.expiresAt && this.fssai.expiresAt <= now) return false;
  return true;
};

/**
 * @typedef JhatkaSupplier
 */
const JhatkaSupplier = mongoose.model('JhatkaSupplier', jhatkaSupplierSchema);

module.exports = JhatkaSupplier;