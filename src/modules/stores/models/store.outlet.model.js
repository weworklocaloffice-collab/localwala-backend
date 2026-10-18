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
const moneyField = require('../utils/money.field');

/**
 * StoreOutlet — a physical location. This is the unit of fulfilment, stock and money.
 *
 * WHY THIS EXISTS SEPARATELY FROM StoreChain
 *
 * A chain shares a brand and a catalogue. An outlet owns what is physically its own:
 *
 *   chain  -> catalogue, brand, categories, promotions, subscription, analytics roll-up
 *   outlet -> stock, orders, drivers, staff, delivery config, tax identity, invoice series
 *
 * The same shirt can have ten units here and none at the sibling outlet. That is why
 * the customer picks an OUTLET and not a chain (BR-37), and why the cart is
 * one-outlet-per-cart. See StoreChain for the full hierarchy.
 *
 * A single-outlet business is a chain with one outlet. There is no separate
 * single-outlet model and no single-outlet code path.
 *
 * PER-OUTLET STATUS
 *
 * A chain with three outlets, one suspended: `chain.status === 'active'` while
 * `outlet.status === 'suspended'`. The chain appears in listings, the suspended
 * outlet does not, and orders to it are refused at checkout. Per-outlet operational
 * state always wins over chain state.
 *
 * `operational` is a CACHED boolean, not a computed-on-read value — eligibility runs
 * on every browse and every checkout. It is recomputed whenever `status` or the
 * subscription state changes. Never trust it for money: assert `status` in the
 * service.
 *
 * TWO LOCATIONS, TWO JOBS — do not conflate them
 *
 *   `location`          the shop's exact coordinates. Distance, ETA, driver routing.
 *   `serviceLocalities` the areas this outlet will deliver to. ELIGIBILITY.
 *
 * Radius alone is wrong: a customer 2 km away in an unserved locality is a false
 * positive, and a customer 6 km away in a served locality is a false negative.
 * Administrative boundaries are not circles. The rule is locality-first with the
 * radius as a fast pre-filter, and an empty `serviceLocalities` degrades to pure
 * radius so V1 needs no backfill.
 *
 * GEOGRAPHY — A TRAP WORTH NAMING
 *
 * `location` deliberately has NO default on the nested `type`, and is NOT required.
 * A nested default of 'Point' makes the 2dsphere index reject the document, and a
 * required location means a draft outlet cannot be saved before the partner has
 * dropped a pin. Both are documented at
 * kernel/delivery/models/delivery.stop.model.js:69-78.
 *
 * @typedef StoreOutlet
 */
const storeOutletSchema = mongoose.Schema(
  {
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },

    /**
     * Human-facing identifier that prefixes every invoice number (BR-43):
     * ABC-HYD-01 -> ABC-HYD/26-27/000042. The platform owns the sequence.
     */
    outletCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
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
    photos: {
      type: [String],
      default: [],
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },

    address: {
      line1: { type: String, required: false, trim: true },
      line2: { type: String, required: false, trim: true },
      area: { type: String, required: false, trim: true },
      city: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'City',
        required: false,
      },
      locality: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Locality',
        required: false,
      },
      pincode: { type: String, required: false, trim: true },
      countryCode: { type: String, required: false, default: '+91' },
    },

    /**
     * GeoJSON Point. `[longitude, latitude]` — longitude FIRST.
     * No nested default. Not required. See the note above.
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

    // DELIVERY SERVICE AREA — the eligibility axis. Empty means "radius only".
    serviceLocalities: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Locality',
        required: false,
      },
    ],
    // Deferred. The field is harmless now and is the hook for pincode serviceability
    // when cross-city shipping or courier fallback arrives.
    servicePinCodes: {
      type: [String],
      default: [],
    },

    operatingHours: [
      {
        _id: false,
        day: { type: Number, required: false, min: 0, max: 6 }, // 0 = Sunday
        isOpen: { type: Boolean, required: false, default: true },
        opensAt: { type: String, required: false }, // 'HH:mm' 24-hour
        closesAt: { type: String, required: false },
      },
    ],
    holidays: [
      {
        _id: false,
        date: { type: String, required: false }, // 'YYYY-MM-DD'
        reason: { type: String, required: false },
        isRecurring: { type: Boolean, required: false, default: false },
        dayOfMonth: { type: Number, required: false, min: 1, max: 31 },
      },
    ],

    deliveryConfig: {
      radiusKm: { type: Number, required: false, default: 5, min: 0 },

      // --- money: rupees at the edges, paise inside. Never $inc these. ---
      // Defined via moneyField rather than an inline getter/setter pair: the pair must
      // divide and multiply by the same factor, and five hand-written copies of it in
      // one file is how a 100x drift gets introduced later. See utils/money.field.js.
      minimumOrder: moneyField(0),
      deliveryFee: moneyField(0),
      freeDeliveryAbove: moneyField(0),

      deliveryHours: [
        {
          _id: false,
          day: { type: Number, required: false, min: 0, max: 6 },
          from: { type: String, required: false },
          to: { type: String, required: false },
        },
      ],
      maxActiveDeliveries: { type: Number, required: false, default: 10, min: 0 },
      dailyOrderCapacity: { type: Number, required: false, default: 0, min: 0 }, // 0 = unlimited

      // Manual accept/reject instead of auto-accept on payment
      acceptOrdersManually: { type: Boolean, required: false, default: false },

      // Feed the customer-facing delivery estimate
      orderPrepMinutes: { type: Number, required: false, default: 15, min: 0 },
      minDeliveryMinutes: { type: Number, required: false, default: 25, min: 0 },

      packagingTypes: { type: [String], default: [] },

      maxDeliveryAttempts: { type: Number, required: false, default: 2, min: 1 },

      /**
       * When no driver is active, do we still take orders?
       *
       * Default TRUE. A small outlet's owner frequently delivers personally, and a
       * rigid block makes them invisible on a busy evening. The warning is unmissable
       * (persistent dashboard banner plus a prompt on the Ready screen) because a
       * failed delivery becomes a refund, a bad review and a cancellation argument.
       */
      acceptOrdersWithoutDriver: { type: Boolean, required: false, default: true },

      // --- COD (BR-39) ---
      // Also gated platform-wide by Vertical.settings.enabledFeatures.codEnabled.
      onlinePaymentEnabled: { type: Boolean, required: false, default: true },
      codEnabled: { type: Boolean, required: false, default: false },
      codMinOrder: moneyField(0),
      codMaxOrder: moneyField(0),
      /**
       * Inventory reservation lifetime for a COD order.
       * CONFIGURATION, NEVER A LITERAL — an Admin change must not need a code change.
       */
      codAcceptanceTimeoutMinutes: { type: Number, required: false, default: 60, min: 1 },
    },

    /**
     * BR-42 — this outlet is the Merchant of Record. LocalWala is the marketplace and
     * the technology platform. Chargebacks are the outlet's; refunds are recovered
     * from the outlet.
     *
     * `stateCode` decides intra-state (CGST + SGST) vs inter-state (IGST). It is the
     * seller's state, compared against the delivery address state at order creation.
     */
    taxIdentity: {
      gstin: { type: String, required: false, trim: true, uppercase: true },
      pan: { type: String, required: false, trim: true, uppercase: true },
      legalName: { type: String, required: false, trim: true },
      stateCode: { type: String, required: false, trim: true }, // e.g. '29' for Karnataka
      registeredAddress: { type: String, required: false, trim: true },
    },

    /**
     * BR-43 — server-controlled, per outlet, per financial year. Sequential and
     * GAPLESS: a cancelled order voids its number and records the reason, it never
     * skips one. The platform owns the sequence — not the outlet, not the client.
     *
     * Format: { outletCode }/{ financialYear }/{ zero-padded sequence }
     */
    invoiceSeries: {
      prefix: { type: String, required: false, trim: true },
      financialYear: { type: String, required: false }, // '2026-27'
      lastSequence: { type: Number, required: false, default: 0, min: 0 },
    },

    contact: {
      mobile: { type: Number, required: false },
      countryCode: { type: String, required: false, default: '+91' },
      email: { type: String, required: false, trim: true, lowercase: true },
      whatsapp: { type: String, required: false },
    },

    rating: { type: Number, required: false, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, required: false, default: 0, min: 0 },

    isOrganicCertified: { type: Boolean, required: false, default: false },
    featured: { type: Boolean, required: false, default: false },
    verified: { type: Boolean, required: false, default: false },

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
    statusChangedAt: { type: Date, required: false },

    /**
     * Cached: `status === 'active'` AND the chain's subscription allows operation.
     * Drives customer-facing visibility. Recomputed on status or subscription change.
     * Assert `status` in the service for anything money-bearing.
     */
    operational: { type: Boolean, required: false, default: false },

    suspension: {
      reasonCode: {
        type: String,
        required: false,
        enum: [
          'expired_subscription',
          'compliance_issue',
          'repeated_complaints',
          'fraud',
          'payment_issue',
          'operational_violation',
          'admin_action',
        ],
      },
      reason: { type: String, required: false },
      suspendedAt: { type: Date, required: false },
      suspendedBy: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
      reactivatedAt: { type: Date, required: false },
    },

    statusHistory: [
      {
        _id: false,
        from: { type: String, required: false },
        to: { type: String, required: false },
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        actorRole: { type: String, required: false },
        reason: { type: String, required: false },
        at: { type: Date, required: false, default: Date.now },
      },
    ],
    reviewNotes: [
      {
        _id: false,
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        note: { type: String, required: false },
        at: { type: Date, required: false, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

storeOutletSchema.plugin(toJSON);
storeOutletSchema.plugin(paginate);
storeOutletSchema.plugin(slugGenerator);

// Spherical index for the nearby-outlet query ($geoNear on `location`).
// Only meaningful once an outlet has coordinates, which is why location is optional.
storeOutletSchema.index({ location: '2dsphere' });

// outletCode is the invoice prefix, so it must be globally unique, not per-chain.
storeOutletSchema.index({ outletCode: 1 }, { unique: true });
storeOutletSchema.index({ chain: 1 });
storeOutletSchema.index({ status: 1, operational: 1 });
storeOutletSchema.index({ 'address.locality': 1, 'address.city': 1, status: 1 });
storeOutletSchema.index({ rating: -1, status: 1 });
storeOutletSchema.index({ featured: -1, status: 1, operational: 1 });
storeOutletSchema.index({ serviceLocalities: 1 });

const StoreOutlet = mongoose.model('StoreOutlet', storeOutletSchema);

module.exports = StoreOutlet;