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
 * StoreChain — the brand and the legal boundary for a group of local outlets.
 *
 * A Local Stores partner is modelled as four levels, not one:
 *
 *     User -> Business -> StoreChain -> StoreOutlet
 *
 * `Business` stays the shared kernel tenant (dairy already depends on it, and its
 * field set is dairy-shaped — `qualityConfig.minFatPercentage`, `shelfLifeHours`).
 * `StoreChain` is stores-module-owned, exactly as `DairyPartner` is an agreement
 * layer over `Business`. Bolting chain fields onto `Business` would make the
 * kernel vertical-specific again, which is the mistake the kernel exists to avoid.
 *
 * WHAT THE CHAIN OWNS vs WHAT THE OUTLET OWNS
 *
 *   chain  -> the catalogue (ChainProduct / ChainProductVariant), the brand, the
 *             categories, the promotions, the subscription, and the analytics roll-up
 *   outlet -> stock, orders, drivers, staff, delivery config, the tax identity and
 *             the invoice series
 *
 * That split is deliberate. A four-outlet brand must not hold four copies of the
 * same catalogue, and the same shirt legitimately has ten units in one outlet and
 * none in another. See BR-35 and BR-36.
 *
 * A single-outlet business is a chain with one outlet. Onboarding creates
 * `Business -> StoreChain -> StoreOutlet` unconditionally, so there is no
 * single-outlet code path to maintain and no migration when a second outlet opens.
 *
 * `catalogueScope` covers the one case this split does not handle by itself: banner
 * chains that run a different product range per outlet ("ABC Fresh" here, "ABC Mart"
 * there). `shared` is the default and covers the common case. `per_outlet` keeps the
 * same StoreOutletProduct row but with no shared ChainProduct — one model, two
 * behaviours, never two product pipelines.
 *
 * `status` mirrors the lifecycle in the specification:
 *
 *     draft -> submitted -> under_review -> changes_required -> under_review
 *                                     -> approved -> subscription_payment -> active
 *     active <-> suspended -> reactivated
 *     any -> archived            (soft. never deletes)
 *
 * A chain and its outlets each carry their own status, so one suspended outlet does
 * not take the chain down. Per-outlet operational state wins.
 *
 * @typedef StoreChain
 */
const storeChainSchema = mongoose.Schema(
  {
    // The kernel tenant that owns this chain. Filtered on Business.vertical === 'stores'
    // by the tenancy middleware — see modules/stores/middlewares/stores.tenant.js
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
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
    logo: {
      type: String,
      required: false,
    },
    cover: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * 'shared'     -> one ChainProduct set for the whole chain (default)
     * 'per_outlet' -> each outlet owns its product set (banner chains)
     *
     * A flag, not two code paths. The service layer branches; the models do not.
     */
    catalogueScope: {
      type: String,
      required: false,
      default: 'shared',
      enum: ['shared', 'per_outlet'],
    },

    // Brand identity, shared by every outlet
    brand: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreBrand',
      required: false,
    },

    // Taxonomy. Admin owns the taxonomy; a chain selects from it (BR-10).
    categories: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreCategory',
        required: true,
      },
    ],
    subcategories: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreSubcategory',
        required: false,
      },
    ],
    // Which attribute templates the product form is generated from
    defaultAttributeTemplates: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreAttributeTemplate',
        required: false,
      },
    ],

    outlets: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreOutlet',
        required: false,
      },
    ],
    // Denormalised for the outlet picker and the admin list. Recomputed on outlet
    // create/deactivate — never trusted for eligibility.
    outletCount: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },

    contact: {
      mobile: {
        type: Number,
        required: false,
      },
      countryCode: {
        type: String,
        required: false,
        default: '+91',
      },
      email: {
        type: String,
        required: false,
        trim: true,
        lowercase: true,
      },
    },

    /**
     * Chain-level commercial settings. Outlet-level values override these.
     */
    settings: {
      // BR-22 — which promotion types this chain may create (Admin-gated)
      allowedPromotionTypes: {
        type: [String],
        default: [],
      },
      productApprovalRequired: {
        type: Boolean,
        required: false,
        default: false,
      },
      settlementConfig: {
        cadence: {
          type: String,
          required: false,
          default: 'daily',
          enum: ['daily', 'weekly', 'monthly'],
        },
        tPlusDays: {
          type: Number,
          required: false,
          default: 2,
        },
      },
      // Platform guard rail. An outlet's own radius may not exceed it.
      maxRadiusKm: {
        type: Number,
        required: false,
        default: 25,
      },
    },

    rating: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },

    isOrganicCertified: {
      type: Boolean,
      required: false,
      default: false,
    },
    featured: {
      type: Boolean,
      required: false,
      default: false,
    },
    verified: {
      type: Boolean,
      required: false,
      default: false,
    },

    status: {
      type: String,
      required: false,
      default: 'draft',
      enum: [
        'draft',
        'submitted',
        'under_review',
        'changes_required',
        'approved',
        'subscription_payment',
        'active',
        'suspended',
        'reactivated',
        'rejected',
        'archived',
      ],
    },
    statusChangedAt: {
      type: Date,
      required: false,
    },
    // Embedded rather than a separate collection: an application has a handful of
    // transitions and they are always read with the chain.
    statusHistory: [
      {
        _id: false,
        from: {
          type: String,
          required: false,
        },
        to: {
          type: String,
          required: false,
        },
        by: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'User',
          required: false,
        },
        actorRole: {
          type: String,
          required: false,
        },
        reason: {
          type: String,
          required: false,
        },
        at: {
          type: Date,
          required: false,
          default: Date.now,
        },
      },
    ],

    reviewNotes: [
      {
        _id: false,
        by: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'User',
          required: false,
        },
        note: {
          type: String,
          required: false,
        },
        at: {
          type: Date,
          required: false,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugins that convert to json, paginate, and generate a unique slug
storeChainSchema.plugin(toJSON);
storeChainSchema.plugin(paginate);
storeChainSchema.plugin(slugGenerator);

// One chain per business. Enforced here rather than only in the service, because a
// duplicate would silently orphan an outlet's tenancy path.
storeChainSchema.index({ business: 1 }, { unique: true });
storeChainSchema.index({ status: 1, featured: -1 });
storeChainSchema.index({ categories: 1, status: 1 });
storeChainSchema.index({ outlets: 1 });

const StoreChain = mongoose.model('StoreChain', storeChainSchema);

module.exports = StoreChain;