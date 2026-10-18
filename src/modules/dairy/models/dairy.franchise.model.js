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
 * DairyFranchise — a franchise territory agreement.
 *
 *   LocalWala → Franchise Territory → Franchise Operator → Dairy Operations → Customer
 *
 * The operator runs an outlet inside an assigned territory and remits a revenue
 * share. Separate from `DairyPartner` because the commercial shape differs: a
 * franchisee *pays* the platform a share of revenue, where a commission partner
 * *earns* a cut of it. Modelling them as one document with a sign flip is how
 * settlement bugs happen.
 *
 * There is no separate franchise app — operators use the `dairyPartner` role in
 * `DairyPartner_app`.
 */
const dairyFranchiseSchema = mongoose.Schema(
  {
    franchiseCode: {
      type: String,
      required: true,
      trim: true,
    },
    /** The outlet the franchisee operates. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /** The person running it. Holds the `dairyPartner` role. */
    operator: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * Territory scope. `localities` is authoritative; `polygon` is optional and
     * only needed where territories must not overlap.
     */
    territory: {
      city: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'City',
        required: false,
      },
      localities: [
        {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'Locality',
          required: false,
        },
      ],
      polygon: {
        type: {
          type: String,
          enum: ['Polygon'],
        },
        coordinates: {
          type: [[[Number]]],
          required: false,
        },
      },
    },
    /**
     * Revenue share the franchisee remits to the platform, as a percentage.
     * Persisted via the platform percent convention, so `8` means 8%.
     */
    revenueSharePercentage: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * What the share is charged on. Kept symmetric with
     * `DairyPartner.commissionBasis` so both settlement paths agree on scope.
     */
    revenueShareBasis: {
      type: String,
      required: false,
      default: 'product_only',
    },
    /** One-off fee payable by the franchisee on joining. */
    joiningFee: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * Royalty charged on gross sales. Separate from revenue share: a royalty is
     * usually a flat monthly amount, a share is proportional.
     */
    royalty: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
      frequency: {
        type: String,
        required: false,
        default: 'monthly', // monthly, quarterly, annual
      },
    },
    agreement: {
      startDate: {
        type: Date,
        required: true,
      },
      endDate: {
        type: Date,
        required: false,
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
    /**
     * Stock and supplies supplied by the platform rather than procured locally.
     * A franchisee usually does not run its own procurement.
     */
    supplyModel: {
      type: String,
      required: false,
      default: 'platform_supplied', // platform_supplied, local_procurement, mixed
    },
    /**
     * The franchisee does not run its own procurement when supply is
     * platform-supplied, so the procurement screens must stay hidden.
     */
    procurementEnabled: {
      type: Boolean,
      required: false,
      default: false,
    },
    status: {
      type: String,
      required: false,
      default: 'pending', // pending, active, suspended, expired, terminated
    },
    /** Why the agreement was suspended or terminated. */
    statusReason: {
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
dairyFranchiseSchema.plugin(toJSON);
dairyFranchiseSchema.plugin(paginate);
dairyFranchiseSchema.index({ franchiseCode: 1 }, { unique: true });
dairyFranchiseSchema.index({ business: 1 }, { unique: true });
dairyFranchiseSchema.index({ 'territory.city': 1, status: 1 });

/**
 * @typedef DairyFranchise
 */
const DairyFranchise = mongoose.model('DairyFranchise', dairyFranchiseSchema);

module.exports = DairyFranchise;