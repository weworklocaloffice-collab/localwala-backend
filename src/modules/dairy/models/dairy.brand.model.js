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
 * DairyBrand — a flat lookup table, NOT a level in the catalogue hierarchy.
 *
 * Amul, Mother Dairy, Nandini, LocalWala and so on. A product carries exactly one
 * brand, but the catalogue is *filtered by* brand across any subtree, so this is
 * a lateral dimension rather than a tree node.
 *
 * `manufacturer` and `fssaiLicence` are kept here because FSSAI registration is a
 * property of the manufacturer, not of a product — the compliance slice reads
 * from this document.
 */
const dairyBrandSchema = mongoose.Schema(
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
    description: {
      type: String,
      required: false,
      trim: true,
    },
    country: {
      type: String,
      required: false,
      trim: true,
      default: 'India',
    },
    manufacturer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: false,
    },
    fssaiLicence: {
      type: String,
      required: false,
      trim: true,
    },
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyBrandSchema.plugin(toJSON);
dairyBrandSchema.plugin(paginate);
dairyBrandSchema.plugin(slugGenerator);
dairyBrandSchema.index({ name: 1 });
dairyBrandSchema.index({ status: 1, sortOrder: 1 });

/**
 * @typedef DairyBrand
 */
const DairyBrand = mongoose.model('DairyBrand', dairyBrandSchema);

module.exports = DairyBrand;