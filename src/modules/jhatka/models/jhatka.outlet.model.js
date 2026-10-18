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
const moneyField = require('../../../utils/money.field');

/**
 * JhatkaOutlet — the operational root of a Jhatka business. BR-04.
 *
 * ## Why `JhatkaPartner` is NOT the root
 *
 * The source blueprint's own §7 warns against making the partner the operational
 * root, and it is right. One partner may operate many outlets (J4, resolved as
 * 1:N), and "the outlet" is the thing a customer is served from, the thing that
 * holds stock, and the thing a driver reports to. `Business` is the partner;
 * this model is the counter.
 *
 * ## Why `businessModel` is denormalised onto the outlet
 *
 * It exists on `Business` and is copied here. Not duplication for its own sake:
 * the order list, the payout generator, the commission rule lookup and the
 * catalogue filter all branch on it in a hot query, and joining to `Business` to
 * read a string that cannot change without an admin action is a wasted round trip
 * on every order in the system. It is written by `jhatka.lifecycle.service` and
 * never by a request handler — enforced in the service, not here.
 *
 * ## Quality policy lives HERE, not on `Business.qualityConfig` (defect D-1)
 *
 * `Business.qualityConfig` is 100% dairy: `minFatPercentage`, `minSnfPercentage`,
 * `rejectBelowFat`, `maxIntakeTemperature`. Extending it with meat fields would
 * produce an outlet record carrying SNF thresholds it cannot evaluate. So meat
 * thresholds live on `qualityPolicy` below and `Business.qualityConfig` is left
 * untouched.
 */
const jhatkaOutletSchema = mongoose.Schema(
  {
    /** Human-facing code. Printed on invoices, pack labels and driver manifests. */
    outletCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** The partner. Kernel `Business` with `vertical: 'jhatka'`. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /**
     * Denormalised from `Business.businessModel`. Values mirror that field.
     * See the header note on why this is copied.
     */
    businessModel: {
      type: String,
      required: true,
      enum: ['direct', 'franchise', 'commission_partner'],
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
    contact: {
      name: { type: String, required: false, trim: true },
      mobile: { type: Number, required: false },
      countryCode: { type: String, required: false },
      email: { type: String, required: false, trim: true, lowercase: true },
    },
    address: {
      line1: { type: String, required: true, trim: true },
      line2: { type: String, required: false, trim: true },
      landmark: { type: String, required: false, trim: true },
      pincode: { type: String, required: false, trim: true },
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },
    locality: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
      required: false,
    },
    /**
     * No nested `default: 'Point'`. A default would create a malformed point for
     * an outlet without GPS and the 2dsphere index would then reject the document.
     * This is the platform-wide convention, recorded because it has been gotten
     * wrong before (see the Real Estate plan on `City` geometry).
     */
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
     * Franchise/partner territory. `localities` is the authoritative scope;
     * `polygon` is optional and only needed when territories must not overlap.
     * Mirrors `Business.territory` so a reader of either means the same thing.
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
          default: undefined,
        },
        coordinates: {
          type: [[[Number]]],
          required: false,
        },
      },
    },
    /**
     * Delivery ownership. Field names deliberately identical to
     * `Business.ownDeliveryPartner` / `Business.driverPayoutMode` so the kernel
     * comments and this model cannot drift apart in meaning.
     *
     * true  → riders come from `JhatkaDriver` rows scoped to this outlet
     * false → riders come from the platform pool
     *
     * OD-06 default: direct outlets use the platform pool, franchise and partner
     * outlets use their own fleet.
     */
    ownDeliveryPartner: {
      type: Boolean,
      required: false,
      default: false,
    },
    driverPayoutMode: {
      type: String,
      required: false,
      enum: ['business_pays', 'platform_pays'],
      default: 'platform_pays',
    },
    operatingHours: [
      {
        _id: false,
        day: {
          type: Number,
          required: true,
          min: 0,
          max: 6,
        },
        from: { type: String, required: false },
        to: { type: String, required: false },
        isClosed: { type: Boolean, required: false, default: false },
      },
    ],
    /**
     * Service area for blueprint §8 — "products available for their address", not
     * every outlet in the city. `radiusKm` is the fallback; the locality list is
     * authoritative where present.
     */
    serviceArea: {
      radiusKm: {
        type: Number,
        required: false,
        default: 5,
        min: 0,
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
          default: undefined,
        },
        coordinates: {
          type: [[[Number]]],
          required: false,
        },
      },
      maxActiveDeliveries: { type: Number, required: false, default: 10, min: 0 },
      dailyOrderCapacity: { type: Number, required: false, default: 0, min: 0 },
    },
    /**
     * D-1. Meat quality and cold-chain thresholds. NOT on `Business`.
     *
     * `shelfLifeHoursRaw` / `shelfLifeHoursPrepared` / `shelfLifeHoursFish` are
     * FALLBACKS used when a `JhatkaCategory` does not set its own. Category beats
     * outlet, because fish is 12h and mutton is 48h and one outlet sells both.
     *
     * `maxTransitMinutes` is a DISPATCH BLOCK, not documentation (§13.4). Fresh
     * meat above 4 °C is unsafe, and this is the number that stops a 70-minute
     * delivery from being assigned to a counter 12 km away.
     */
    qualityPolicy: {
      maxIntakeTemperatureC: { type: Number, required: false, default: 8 },
      maxStorageTemperatureC: { type: Number, required: false, default: 4 },
      minStorageTemperatureC: { type: Number, required: false, default: 0 },
      maxTransitMinutes: { type: Number, required: false, default: 45, min: 5 },
      shelfLifeHoursRaw: { type: Number, required: false, default: 48, min: 1 },
      shelfLifeHoursPrepared: { type: Number, required: false, default: 24, min: 1 },
      shelfLifeHoursFish: { type: Number, required: false, default: 12, min: 1 },
      /** Weight confirmations above this need a photo of the packed bag. §3.4 */
      evidencePhotoRequiredAbove: moneyField(500),
      /**
       * Reject automatically when intake temperature is out of band, or queue for
       * a human. Mirrors dairy's hard-fail-vs-borderline split (§5.3 Rule B).
       */
      autoRejectOnTemperature: { type: Boolean, required: false, default: true },
    },
    /**
     * §3.4 and §19 J1. The variable-weight money policy.
     *
     * Every field here may be TIGHTENED from the category default but not widened
     * past `maxAllowed*` — that ceiling is why it lives on the outlet as well as
     * the category. An operator widening the band to 15% to make a variance
     * report look better is a thing a schema should refuse.
     */
    orderConfig: {
      weightTolerancePct: { type: Number, required: false, default: 5, min: 0, max: 25 },
      weightHardOverchargePct: { type: Number, required: false, default: 10, min: 0, max: 100 },
      weightHardShortfallPct: { type: Number, required: false, default: 2, min: 0, max: 100 },
      /**
       * When false, an over-delivery is still NOT charged — it is recorded and
       * escalated for a policy decision. There is deliberately no code path that
       * turns this into a customer charge. BR-06.
       */
      absorbOvercharge: { type: Boolean, required: false, default: true },
      codEnabled: { type: Boolean, required: false, default: false },
      codTolerancePct: { type: Number, required: false, default: 10, min: 0, max: 50 },
      minCodValue: moneyField(1),
      maxCodValue: moneyField(500),
      onlinePaymentEnabled: { type: Boolean, required: false, default: true },
      /**
       * Minutes a gateway order may sit in `PAYMENT_PENDING` before the sweep closes
       * it as `PAYMENT_FAILED -> CANCELLED`.
       *
       * Unset means the service default (20). The floor is 5 because anything shorter
       * cancels orders whose payment page is still open on the customer's phone — the
       * worst failure this mechanism has, since the money then arrives for an order
       * that no longer exists.
       */
      paymentTimeoutMinutes: { type: Number, required: false, min: 5, max: 1440 },
      acceptOrdersManually: { type: Boolean, required: false, default: false },
      orderPrepMinutes: { type: Number, required: false, default: 15, min: 0 },
      minDeliveryMinutes: { type: Number, required: false, default: 25, min: 0 },
      maxDeliveryAttempts: { type: Number, required: false, default: 2, min: 1 },
      /** Weighted by the branch itself, never on an unresolved weight. §3.6 */
      requireWeightEvidencePhotoAbove: moneyField(500),
    },
    /**
     * BR-18. Configurable per outlet, not hard-coded — but the defaults encode the
     * rule that makes the policy defensible: no cancellation once `PREPARING`,
     * because the meat is cut.
     */
    cancellationConfig: {
      allowedUntil: {
        type: String,
        required: false,
        enum: ['CREATED', 'PAYMENT_PENDING', 'PAID', 'OUTLET_RECEIVED', 'ACCEPTED', 'PREPARING'],
        default: 'ACCEPTED',
      },
      requireOutletConfirmAfter: {
        type: String,
        required: false,
        enum: ['ACCEPTED', 'PREPARING', 'WEIGHING', 'WEIGHT_CONFIRMED', 'PACKING', 'READY'],
        default: 'PREPARING',
      },
      /** Minutes a weight variance dispute stays open. */
      disputeWindowHours: { type: Number, required: false, default: 2, min: 0 },
      shortfallWindowHours: { type: Number, required: false, default: 24, min: 0 },
    },
    /**
     * §9.6. `maxConsecutiveStockFailures` is the BR-17 auto-pause threshold — the
     * rule that converts a silent skip into a conversation. Without it a
     * subscription on a scarce SKU quietly skips eight times and the customer
     * finds out in month three.
     */
    subscriptionConfig: {
      enabled: { type: Boolean, required: false, default: false },
      maxPerCustomer: { type: Number, required: false, default: 5, min: 0 },
      minCommitmentDays: { type: Number, required: false, default: 7, min: 0 },
      maxConsecutiveStockFailures: { type: Number, required: false, default: 2, min: 1 },
    },
    /**
     * BR-20 and §18.4. `gstin` is required before activation (mirrors the stores
     * BR-42 lifecycle check) but is NOT required to save a draft.
     *
     * FSSAI class varies by state and by business model, so the category field is
     * open and validated in the compliance slice, not here. OD-08.
     */
    taxIdentity: {
      gstin: { type: String, required: false, trim: true, uppercase: true },
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
    },
    packaging: {
      types: { type: [String], default: [] },
      defaultType: { type: String, required: false },
      minPackagingFee: moneyField(0),
    },
    paymentConfig: {
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
      bank: {
        accountName: { type: String, required: false, trim: true },
        accountNumber: { type: String, required: false, trim: true },
        ifsc: { type: String, required: false, trim: true, uppercase: true },
        upiId: { type: String, required: false, trim: true },
      },
      /**
       * §4.3. Retrofitting this after payouts have been made means restating
       * historical payouts, so it exists on day one even though it defaults false.
       */
      tdsApplicable: { type: Boolean, required: false, default: false },
    },
    /**
     * §8.2. `holdTimeoutMinutes` is what the 10-minute `escalateStuckOnHold` cron
     * reads. `ON_HOLD` can be entered from four states, so without a timeout an
     * order in `ON_HOLD` is a paid order nobody is delivering — with no expiry
     * that never becomes someone else's problem.
     */
    holdPolicy: {
      holdTimeoutMinutes: { type: Number, required: false, default: 30, min: 5 },
      escalateAfterMinutes: { type: Number, required: false, default: 15, min: 5 },
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
    verified: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * Lifecycle. `suspended` is what a compliance expiry sets (§12.4) and it is
     * per-OUTLET — suspending the whole `jhatka` vertical because one outlet's
     * trade licence lapsed would take down every counter in the country.
     */
    status: {
      type: String,
      required: false,
      enum: ['draft', 'pending_approval', 'active', 'suspended', 'closed'],
      default: 'draft',
    },
    statusReason: {
      type: String,
      required: false,
      trim: true,
    },
    activatedAt: {
      type: Date,
      required: false,
    },
    suspendedAt: {
      type: Date,
      required: false,
    },
    suspensionReason: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaOutletSchema.plugin(toJSON);
jhatkaOutletSchema.plugin(paginate);
jhatkaOutletSchema.plugin(slugGenerator);
jhatkaOutletSchema.index({ outletCode: 1 }, { unique: true });
jhatkaOutletSchema.index({ location: '2dsphere' });
// The partner's outlet list. BR-04: one `Business`, many outlets.
jhatkaOutletSchema.index({ business: 1, status: 1 });
// `getNearbyOutlets` (blueprint §8) — status filter plus 2dsphere proximity.
jhatkaOutletSchema.index({ status: 1, businessModel: 1 });
jhatkaOutletSchema.index({ 'taxIdentity.gstin': 1 });
// The compliance expiry sweep.
jhatkaOutletSchema.index({ 'taxIdentity.fssai.expiresAt': 1 });

/**
 * Is this outlet allowed to take NEW orders?
 *
 * Read paths deliberately do NOT call this. A suspended outlet must still be
 * visible to a customer who is tracking an order already placed — see stores'
 * `fulfilExisting` which is hardcoded true in every branch of
 * `capabilitiesFor`. Blocking reads as well as writes would make an in-flight
 * order untrackable, which turns a compliance problem into a support problem.
 *
 * The stores module has a middleware called `storeAuthSuspendedOk` that is
 * byte-identical to `storeAuth` — the name promises a check the code does not
 * perform. There is deliberately no such middleware here. One `jhatkaAuth` plus an
 * explicit call to this function from mutating services is the honest shape.
 */
jhatkaOutletSchema.methods.canAcceptNewOrders = function () {
  return this.status === 'active';
};

/**
 * The capability set, copied in spirit from `stores.lifecycle.capabilitiesFor`.
 *
 * The important invariant is that `fulfilExisting` is TRUE for every non-draft
 * state. Preparation in progress is not stopped by a suspension; only new
 * commerce is. A shop whose FSSAI lapsed at noon still owes the customer the
 * chicken it already accepted.
 */
jhatkaOutletSchema.methods.capabilities = function () {
  const active = this.status === 'active';
  return {
    state: this.status,
    viewDashboard: this.status !== 'draft',
    viewOrders: this.status !== 'draft',
    manageCatalogue: active,
    manageInventory: active,
    acceptNewOrders: active,
    fulfilExisting: this.status !== 'draft',
    readSettlements: this.status !== 'draft',
    managePayments: active,
    readCompliance: this.status !== 'draft',
    manageCompliance: active,
  };
};

/**
 * @typedef JhatkaOutlet
 */
const JhatkaOutlet = mongoose.model('JhatkaOutlet', jhatkaOutletSchema);

module.exports = JhatkaOutlet;