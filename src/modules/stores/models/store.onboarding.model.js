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
const moneyField = require('../utils/money.field');
const { LAST_STEP_INDEX } = require('../constants/onboarding.steps');

/**
 * StoreOnboarding — the nine-step application draft (specification section 3).
 *
 * Covers the whole join-up: business information, store information, category,
 * owner information, location, documents, delivery configuration, submit.
 *
 * WHY ONE DOCUMENT AND NOT A STATE FIELD ON StoreOutlet
 *
 * An application is read with its answers, its documents and its review notes, always
 * together. Splitting the draft across the outlet and a separate table means every
 * read is a join, and the "what did they submit, what did we ask for, what did they
 * fix" story is spread across three places. A draft has a handful of transitions and
 * is always read whole, so it is one embedded document.
 *
 * THE CRITICAL PROPERTY
 *
 * `commit()` promotes this into `Business -> StoreChain -> StoreOutlet` in ONE
 * transaction. A partner who completes step nine and gets a half-built store is a
 * support call and a lost partner. The happy path must be all-or-nothing.
 *
 * `currentStep` is a cursor, not a validator. The server recomputes completeness on
 * every save, so a client cannot jump to the final step by writing the number.
 *
 * @typedef StoreOnboarding
 */
const storeOnboardingSchema = mongoose.Schema(
  {
    // The account that is applying. A User, not a Business — the business does not
    // exist yet. This is the only document in the vertical where owner comes first.
    owner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: false,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: false,
    },
    // Populated by commit(). The FIRST outlet of what may later become many.
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: false,
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
        'rejected',
        'withdrawn',
      ],
    },

    // A CURSOR, not a validator. Completeness is recomputed server-side on every save.
    currentStep: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
      // DERIVED from STEPS, never hand-written.
      //
      // This used to read `max: 8` while STEPS held six entries, so a client could park
      // the cursor on step 7 or 8 and the server accepted it. The app then had nothing
      // to render. Importing the constant means adding a seventh screen widens this
      // automatically, and forgetting to cannot silently reject a valid step.
      max: LAST_STEP_INDEX,
    },
    completedSteps: {
      type: [Number],
      default: [],
    },
    // Which steps are still missing, recomputed server-side. Drives the wizard's
    // "what is left" list without trusting the client.
    incompleteSteps: {
      type: [Number],
      default: [],
    },

    // ---- step 1: business information ----
    businessInfo: {
      legalName: { type: String, required: false, trim: true },
      displayName: { type: String, required: false, trim: true },
      // proprietorship | partnership | private_limited | llp | other
      businessType: { type: String, required: false, trim: true },
      registrationNumber: { type: String, required: false, trim: true },
      gstin: { type: String, required: false, trim: true, uppercase: true },
      tradeLicenceNumber: { type: String, required: false, trim: true },
      contactNumber: { type: Number, required: false },
      countryCode: { type: String, required: false, default: '+91' },
      email: { type: String, required: false, trim: true, lowercase: true },
      address: { type: String, required: false, trim: true },
    },

    // ---- step 2: store information ----
    storeInfo: {
      name: { type: String, required: false, trim: true },
      description: { type: String, required: false, trim: true },
      // The 20 categories are Admin-managed taxonomy; a chain SELECTS from them (BR-10).
      categories: [
        { type: mongoose.SchemaTypes.ObjectId, ref: 'StoreCategory', required: false },
      ],
      subcategories: [
        { type: mongoose.SchemaTypes.ObjectId, ref: 'StoreSubcategory', required: false },
      ],
    },

    // ---- step 3: owner information ----
    ownerInfo: {
      name: { type: String, required: false, trim: true },
      mobile: { type: Number, required: false },
      email: { type: String, required: false, trim: true, lowercase: true },
      // Never store a full government identifier. Last four only.
      aadhaarLast4: { type: String, required: false, match: /^[0-9]{4}$/ },
      // owner | partner | director | proprietor
      relation: { type: String, required: false, trim: true },
    },

    // ---- step 4: location ----
    location: {
      line1: { type: String, required: false, trim: true },
      line2: { type: String, required: false, trim: true },
      area: { type: String, required: false, trim: true },
      city: { type: mongoose.SchemaTypes.ObjectId, ref: 'City', required: false },
      locality: { type: mongoose.SchemaTypes.ObjectId, ref: 'Locality', required: false },
      pincode: { type: String, required: false, trim: true },
      countryCode: { type: String, required: false, default: '+91' },
      // No nested default and NOT required — the same 2dsphere trap as StoreOutlet.
      // A draft must be saveable before the partner drops a pin.
      geo: {
        type: { type: String, enum: ['Point'] },
        coordinates: { type: [Number], required: false },
      },
    },

    // ---- step 5: documents ----
    // References StoreComplianceDocument once created. Kept as ids here so the draft
    // stays small and the documents are independently reviewable.
    documents: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreComplianceDocument',
        required: false,
      },
    ],

    // ---- step 6: delivery configuration ----
    deliveryConfig: {
      radiusKm: { type: Number, required: false, min: 0 },

      // Money, and it is money in the same sense as StoreOutlet.deliveryConfig:
      // the applicant types rupees, paise are stored.
      //
      // These were plain `Number` fields, which stored rupees verbatim while the
      // outlet they are copied into (`approveAndCommit`) applies a rupees-to-paise
      // setter. So the draft read back Rs 150 and the committed outlet read back
      // Rs 150 too — but only because the commit re-applied the conversion to an
      // already-correct value. Any read of the draft before commit, and any
      // comparison between the two, compared rupees to rupees by accident. Using
      // moneyField removes the coincidence.
      minimumOrder: moneyField(0),
      deliveryFee: moneyField(0),
      freeDeliveryAbove: moneyField(0),
      operatingHours: {
        type: Array,
        default: [],
      },
      holidays: {
        type: Array,
        default: [],
      },
    },

    // ---- step 7: how many outlets at once? ----
    // A partner applying with twenty branches says so up front rather than opening
    // them one at a time. Each extra outlet still needs its own location and docs.
    outletCount: {
      type: Number,
      required: false,
      default: 1,
      min: 1,
    },

    // ---- review trail ----
    submittedAt: { type: Date, required: false },
    reviewedAt: { type: Date, required: false },
    reviewedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    // Machine-readable, so the wizard can highlight the exact field.
    changesRequested: [
      {
        _id: false,
        step: { type: Number, required: false },
        field: { type: String, required: false },
        message: { type: String, required: false },
        resolvedAt: { type: Date, required: false },
      },
    ],
    rejectionReason: { type: String, required: false, trim: true },

    statusHistory: [
      {
        _id: false,
        from: { type: String, required: false },
        to: { type: String, required: false },
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        actorRole: { type: String, required: false },
        reason: { type: String, required: false },
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

storeOnboardingSchema.plugin(toJSON);
storeOnboardingSchema.plugin(paginate);

storeOnboardingSchema.index({ owner: 1, status: 1 });
// One live application per owner. A withdrawn or rejected application is history.
storeOnboardingSchema.index(
  { owner: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['draft', 'submitted', 'under_review', 'changes_required'] } },
  }
);
// The Admin work queue. Add a computed hasLocation so an operator can see at a
// glance that an application predates the location rules.
storeOnboardingSchema.index({ status: 1, submittedAt: 1 });
storeOnboardingSchema.index({ status: 1, 'location.city': 1, 'location.locality': 1 });

const StoreOnboarding = mongoose.model('StoreOnboarding', storeOnboardingSchema);

module.exports = StoreOnboarding;