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
 * StoreAttributeTemplate — the dynamic attribute definition (BR-11).
 *
 * ## Why nothing is hardcoded
 *
 * A T-shirt needs Size and Colour. Electronics needs Storage, RAM and Warranty.
 * Grocery needs Pack Size and Weight. If those were columns on the product, adding a
 * twenty-first category would be a migration. As templates, it is a seed row — which
 * is the whole content of BR-26.
 *
 * ## `variantAxis` is the load-bearing flag
 *
 * true  -> this attribute GENERATES variants. Size x Colour is a cartesian product of
 *          the selected values, and each combination becomes one ChainProductVariant.
 * false -> this attribute is descriptive only. Brand, RAM and Warranty are values on a
 *          variant; they do not multiply the variant count.
 *
 * ## Dependent options
 *
 * `options` may carry `dependsOn`, so Vehicle Fitment can present
 * Make -> Model -> Year with only valid models at each step. That is how Auto Parts
 * needs no module (see §4.7.5).
 */
const storeAttributeTemplateSchema = mongoose.Schema(
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
    displayName: {
      type: {
        en: String,
        hi: String,
        ar: String,
        es: String,
      },
      required: false,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'text',
        'number',
        'select',
        'multi_select',
        'boolean',
        'color',
        'size',
        'date',
        'file',
      ],
    },
    options: [
      {
        _id: false,
        value: {
          type: String,
          required: true,
        },
        label: {
          type: String,
          required: false,
        },
        // hex for color and size templates
        swatch: {
          type: String,
          required: false,
        },
        // dependent filtering. Each entry is { template: '<slug>', values: [...] }
        dependsOn: {
          type: [Object],
          default: [],
        },
        sortOrder: {
          type: Number,
          required: false,
          default: 0,
        },
      },
    ],
    // for type 'number', e.g. cm / kg / ml / gb
    unit: {
      type: String,
      required: false,
      trim: true,
    },
    min: {
      type: Number,
      required: false,
    },
    max: {
      type: Number,
      required: false,
    },
    // show as a filter chip on the browse screen
    filterable: {
      type: Boolean,
      required: false,
      default: false,
    },
    searchable: {
      type: Boolean,
      required: false,
      default: false,
    },
    required: {
      type: Boolean,
      required: false,
      default: false,
    },
    // TRUE => this attribute generates variants rather than describing one
    variantAxis: {
      type: Boolean,
      required: false,
      default: false,
    },
    // surfaces the organic attestation prompt on the product
    isOrganicRelevant: {
      type: Boolean,
      required: false,
      default: false,
    },
    // accepting one of these requires the chain to hold an approved brand
    // certification for that brand (Electronics, Mobile, Pharmacy)
    requiresBrandCertification: {
      type: Boolean,
      required: false,
      default: false,
    },
    displayOrder: {
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

storeAttributeTemplateSchema.plugin(toJSON);
storeAttributeTemplateSchema.plugin(paginate);
storeAttributeTemplateSchema.plugin(slugGenerator);

storeAttributeTemplateSchema.index({ status: 1, variantAxis: 1, displayOrder: 1 });

const StoreAttributeTemplate = mongoose.model(
  'StoreAttributeTemplate',
  storeAttributeTemplateSchema
);

module.exports = StoreAttributeTemplate;