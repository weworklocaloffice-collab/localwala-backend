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
const moneyField = require('../../../utils/money.field');

/**
 * JhatkaPartner — a commission partner's relationship with LocalWala.
 *
 * ## The partner is an OPERATOR, not a seller
 *
 * BR-05: LocalWala is Merchant of Record for all three business models. The
 * partner supplies goods to LocalWala and operates a counter. They are paid an
 * accounts-payable against a statement, and they never touch customer money.
 *
 * That is the whole reason §4 of the plan resolves J2 and J7 together. It means:
 *
 *   - one GST invoice surface, because there is only one seller
 *   - refunds move from one entity to one customer, with no partner cooperation
 *   - a partner leaving strands nothing; the statement closes and that is the end
 *
 * ## `creditTermDays` is the cost of BR-05, stated plainly
 *
 * LocalWala carries the working capital for every partner's inventory. This is
 * the real cost of the MoR decision, and a partner with 7-day terms is holding
 * LocalWala's stock for a week. §4.3 says this out loud rather than burying it.
 */
const PARTNER_STATUSES = ['pending', 'active', 'suspended', 'terminated'];

const jhatkaPartnerSchema = mongoose.Schema(
  {
    partnerCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** The partner entity. Kernel `Business` with `vertical: 'jhatka'`. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /** The human who owns it. */
    owner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    ownerName: { type: String, required: false, trim: true },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    contact: {
      name: { type: String, required: false, trim: true },
      mobile: { type: Number, required: false },
      countryCode: { type: String, required: false },
      email: { type: String, required: false, trim: true, lowercase: true },
    },
    address: {
      line1: { type: String, required: false, trim: true },
      line2: { type: String, required: false, trim: true },
      city: { type: mongoose.SchemaTypes.ObjectId, ref: 'City', required: false },
      locality: { type: mongoose.SchemaTypes.ObjectId, ref: 'Locality', required: false },
      pincode: { type: String, required: false, trim: true },
    },
    /**
     * BR-04: one partner may operate MANY outlets. This is a list, not a single
     * ref, and the tenancy middleware must not assume 1:1.
     */
    outlets: [
      {
        _id: false,
        outlet: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaOutlet',
          required: true,
        },
        isPrimary: { type: Boolean, required: false, default: false },
        addedAt: { type: Date, required: true },
      },
    ],

    /**
     * §4.3. The cost of BR-05 made explicit: how many days of OUR stock this
     * partner holds. Zero for most, longer for a franchise that takes a
     * substantial delivery.
     */
    creditTermDays: {
      type: Number,
      required: false,
      min: 0,
      default: 0,
    },
    /** The `JhatkaCommissionRule` in force. A ref for lookup; the payout freezes a copy. */
    commissionRule: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaCommissionRule',
      required: false,
      default: undefined,
    },
    settlementCycle: {
      type: String,
      required: false,
      enum: ['weekly', 'monthly'],
      default: 'weekly',
    },

    payoutMethod: {
      type: String,
      required: false,
      enum: ['bank', 'wallet'],
      default: 'bank',
    },
    /**
     * Frozen onto each payout at payment time. Deliberately a copy of the
     * partner's own record: a partner changing their bank account after a
     * statement is approved must not silently redirect an approved payout.
     */
    bank: {
      accountName: { type: String, required: false, trim: true },
      accountNumber: { type: String, required: false, trim: true },
      ifsc: { type: String, required: false, trim: true, uppercase: true },
      upiId: { type: String, required: false, trim: true },
    },

    /**
     * §4.3. Retrofitting TDS after payouts have been made means restating
     * statements. Finance turns this on BEFORE the first partner is paid.
     */
    tdsApplicable: { type: Boolean, required: false, default: false },
    tdsRatePercent: { type: Number, required: false, min: 0, max: 100, default: 0 },

    /**
     * §6. Supplier documents supplied by the partner (their own FSSAI for their
     * premises, GST registration, premises lease). Distinct from
     * `JhatkaCompliance`, which is LocalWala's record for the outlet.
     */
    complianceDocuments: [
      {
        _id: false,
        type: {
          type: String,
          required: true,
          enum: ['fssai', 'gst_registration', 'trade_licence', 'premises_lease'],
        },
        reference: { type: String, required: false, trim: true },
        issuedAt: { type: Date, required: false },
        expiresAt: { type: Date, required: false, default: undefined },
        fileUrl: { type: String, required: false },
        status: {
          type: String,
          required: false,
          enum: ['pending', 'valid', 'expiring', 'expired', 'rejected'],
          default: 'pending',
        },
      },
    ],

    /**
     * Lifetime totals. Read-only, maintained by the payout service. Present so a
     * partner's own dashboard does not have to aggregate the payout collection on
     * every page load.
     */
    stats: {
      totalPayouts: { type: Number, required: false, default: 0, min: 0 },
      totalCommissionEarned: moneyField(0),
      totalPaid: moneyField(0),
      totalTdsDeducted: moneyField(0),
      lastPayoutAt: { type: Date, required: false },
    },

    status: {
      type: String,
      required: false,
      enum: PARTNER_STATUSES,
      default: 'pending',
    },
    statusReason: { type: String, required: false, trim: true },
    activatedAt: { type: Date, required: false },
    terminatedAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaPartnerSchema.plugin(toJSON);
jhatkaPartnerSchema.plugin(paginate);
jhatkaPartnerSchema.index({ partnerCode: 1 }, { unique: true });
// One partner record per business. BR-04 allows many outlets, not many partners.
jhatkaPartnerSchema.index({ business: 1 }, { unique: true });
// "Which partner runs this outlet?" — the tenancy middleware's hot query.
jhatkaPartnerSchema.index({ 'outlets.outlet': 1, status: 1 });
// The payout generator.
jhatkaPartnerSchema.index({ status: 1, settlementCycle: 1 });
// Compliance expiry sweep over partner-supplied documents.
jhatkaPartnerSchema.index({ 'complianceDocuments.expiresAt': 1 });
jhatkaPartnerSchema.index({ owner: 1, status: 1 });

jhatkaPartnerSchema.statics.STATUSES = PARTNER_STATUSES;

/**
 * The primary outlet, or the first. BR-04.
 *
 * A partner with several outlets still needs ONE default for surfaces that cannot
 * scope to an outlet. Deterministic rather than `outlets[0]` — which is what
 * `stores/cron.js:74` does and is a bug (F-4), because a partner's flagship
 * outlet may not be first in the array after any reorder.
 */
jhatkaPartnerSchema.methods.primaryOutletId = function () {
  const list = this.outlets || [];
  const primary = list.find((o) => o.isPrimary);
  const outlet = (primary || list[0])?.outlet;

  // `.toString()` is REQUIRED, not cosmetic. Mongoose casts `outlets[].outlet` to an
  // ObjectId instance, so returning it raw hands the caller an OBJECT where every
  // other outlet id in this codebase is a STRING. The tenant middleware compares
  // this against `req.outletId`, which is a string, and `ObjectId === string` is
  // false — so an unconverted return makes the comparison fail silently and the
  // middleware falls through to resolving the wrong outlet.
  return outlet ? outlet.toString() : null;
};

/**
 * Is this partner trading?
 *
 * Mirrors `JhatkaOutlet.canAcceptNewOrders`. A suspended partner stops new
 * commerce but is not retroactively voided, and their payout history is a
 * settlement input (BR-23).
 */
jhatkaPartnerSchema.methods.canOperate = function () {
  return this.status === 'active';
};

/**
 * @typedef JhatkaPartner
 */
const JhatkaPartner = mongoose.model('JhatkaPartner', jhatkaPartnerSchema);

module.exports = JhatkaPartner;