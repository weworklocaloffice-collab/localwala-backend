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
 * StoreBrand — chain-level, Admin-governed. NOT an attribute template.
 *
 * ## Why this is a collection rather than a select option
 *
 * A brand needs a logo, a landing page, search aliases, moderation, and an
 * authorisation letter. An attribute template's `options[]` can hold none of those. A
 * brand also spans categories — Nike is Clothing, Footwear and Sports — so nesting it
 * under one category would give the platform two Apple records with two logos, and
 * brand search would die.
 *
 * ## Who may edit what
 *
 * A chain REQUESTS a brand; Admin decides. If a chain could edit brand names, you would
 * get "Samsng", "Samsung India" and "SAMSUNG" as three brands.
 *
 * ## Anti-counterfeit
 *
 * `certifications` is the mechanism that stops a marketplace becoming a flea market. To
 * list a brand, a chain uploads an authorisation letter; Admin approves it; without
 * approval the customer sees "unverified seller for this brand". Expiry is swept
 * nightly, so a lapsed authorisation loses the badge with no manual step.
 *
 * ## `productCount` is deliberately absent
 *
 * It would drift, and a global count across three categories tells a customer nothing.
 * Aggregate on read.
 *
 * @typedef StoreBrand
 */
const storeBrandSchema = mongoose.Schema(
  {
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
    banner: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    // "Samsung" / "SAMSUNG" / "सैमसंग" — customers do not type the canonical form
    aliases: {
      type: [String],
      default: [],
    },
    // MANY-TO-MANY with the taxonomy. Never nested.
    categories: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreCategory',
        required: false,
      },
    ],
    subcategories: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreSubcategory',
        required: false,
      },
    ],
    originCountry: {
      type: String,
      required: false,
      trim: true,
    },
    website: {
      type: String,
      required: false,
      trim: true,
    },
    supportContact: {
      type: String,
      required: false,
      trim: true,
    },
    supportPhone: {
      type: String,
      required: false,
      trim: true,
    },
    certifications: [
      {
        _id: false,
        type: {
          type: String,
          required: false,
          enum: ['authorization_letter', 'dealership', 'distributorship', 'registration'],
        },
        number: {
          type: String,
          required: false,
          trim: true,
        },
        validFrom: {
          type: Date,
          required: false,
        },
        validTo: {
          type: Date,
          required: false,
        },
        document: {
          type: String,
          required: false,
        },
        status: {
          type: String,
          required: false,
          default: 'pending',
          enum: ['pending', 'approved', 'rejected', 'expired'],
        },
        verifiedBy: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'User',
          required: false,
        },
        verifiedAt: {
          type: Date,
          required: false,
        },
      },
    ],
    // set by the nightly expiry sweep
    isVerified: {
      type: Boolean,
      required: false,
      default: false,
    },
    status: {
      type: String,
      required: false,
      default: 'pending',
      enum: ['pending', 'approved', 'rejected', 'archived'],
    },
    // who asked for this brand to exist
    requester: {
      chain: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreChain',
        required: false,
      },
      by: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
      at: {
        type: Date,
        required: false,
      },
    },
    approval: {
      by: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
      at: {
        type: Date,
        required: false,
      },
      note: {
        type: String,
        required: false,
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
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

storeBrandSchema.plugin(toJSON);
storeBrandSchema.plugin(paginate);
storeBrandSchema.plugin(slugGenerator);

// Alias search. Without this index, "SAMSUNG" silently misses the brand.
storeBrandSchema.index({ aliases: 1 });
storeBrandSchema.index({ name: 1 });
storeBrandSchema.index({ status: 1, categories: 1 });
storeBrandSchema.index({ 'certifications.validTo': 1 });

/** A certification is valid only while approved and unexpired. */
storeBrandSchema.statics.isCertified = function isCertified(brand) {
  if (!brand || !Array.isArray(brand.certifications)) return false;
  const now = new Date();
  return brand.certifications.some(
    (c) => c.status === 'approved' && (!c.validTo || c.validTo > now)
  );
};

const StoreBrand = mongoose.model('StoreBrand', storeBrandSchema);

module.exports = StoreBrand;