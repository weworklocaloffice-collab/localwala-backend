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
 * DairyPartner — a commission-based partner relationship.
 *
 *   LocalWala → Approved Dairy Partner → Customer
 *
 * The partner operates an outlet and earns a commission on sales routed through
 * it. The commercial terms live here rather than on `Business` because a partner
 * agreement is a *contract*: it has a term, a commission rate that can be
 * renegotiated, and a document trail. `Business.businessModel` only records which
 * model an outlet runs under.
 */
const dairyPartnerSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    partnerCode: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * Commission as a percentage. Stored via the platform's percent convention
     * (value/100 in, value*100 out), so `12` means 12%.
     */
    commissionPercentage: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * What the commission is charged on.
     *
     * `product_only` (default) — commission on goods revenue. This is the safer
     * default because commission on a delivery fee the partner's own rider
     * collected would double-count: the platform pays the rider, then takes a
     * cut of what the rider earned.
     *
     * `product_and_delivery` — commission on goods plus delivery charges, for
     * outlets that bill delivery separately.
     */
    commissionBasis: {
      type: String,
      required: false,
      default: 'product_only', // product_only, product_and_delivery
    },
    /**
     * Agreement window. A settlement cannot be raised outside it.
     */
    agreement: {
      startDate: {
        type: Date,
        required: true,
      },
      endDate: {
        type: Date,
        required: false,
      },
      /**
       * Minimum monthly volume guaranteed to the partner, in rupees. Recorded
       * for reporting; not enforced by the settlement engine.
       */
      minimumGuarantee: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
      documentUrl: {
        type: String,
        required: false,
      },
      notes: {
        type: String,
        required: false,
      },
    },
    payoutMethod: {
      type: String,
      required: false,
      default: 'wallet', // wallet, bank
    },
    payoutDetails: {
      accountName: {
        type: String,
        required: false,
      },
      accountNumber: {
        type: String,
        required: false,
      },
      ifsc: {
        type: String,
        required: false,
      },
      upiId: {
        type: String,
        required: false,
      },
    },
      /**
       * Whether the partner's riders are paid by the partner or by the platform.
       * Mirrors `Business.driverPayoutMode` but lives here because it is a
       * commercial term of the agreement.
       *
       * Always `business_pays` in practice: the platform has no dairy riders to
       * pay, so the outlet employs and pays its own. The field is kept because it
       * is a commercial term of the agreement and historical rows may hold
       * `platform_pays`; the write path no longer offers it.
       */
      driverPayoutMode: {
        type: String,
        required: false,
        default: 'business_pays', // business_pays, platform_pays (legacy only)
      },
    status: {
      type: String,
      required: false,
      default: 'pending', // pending, active, suspended, terminated
    },
    terminatedAt: {
      type: Date,
      required: false,
    },
    /** Why the agreement ended or was paused. Disputed relationships come back here. */
    terminationReason: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyPartnerSchema.plugin(toJSON);
dairyPartnerSchema.plugin(paginate);
dairyPartnerSchema.index({ business: 1 }, { unique: true });
dairyPartnerSchema.index({ partnerCode: 1 }, { unique: true });
dairyPartnerSchema.index({ user: 1, status: 1 });

/**
 * @typedef DairyPartner
 */
const DairyPartner = mongoose.model('DairyPartner', dairyPartnerSchema);

module.exports = DairyPartner;