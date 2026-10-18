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

const FACET_TYPES = Object.freeze([
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'ENUM',
  'MULTI_ENUM',
  'RANGE',
  'DATE',
  'DATE_RANGE',
  'LOCATION',
  'DURATION',
]);

/**
 * LocalServiceFacet — dynamic filter/attribute definition (stable ID = key).
 * Typed values validated in service; app renders filters from metadata.
 * ENUM options embedded (no second collection for Phase 1).
 */
const localServiceFacetSchema = mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9_]+$/ },
    label: { type: String, required: true, trim: true },
    dataType: { type: String, required: true, enum: FACET_TYPES },
    filterType: { type: String, required: false, default: 'SINGLE_SELECT', trim: true },
    appliesToCategories: { type: [String], required: false, default: [] },
    options: { type: [String], required: false, default: [] },
    required: { type: Boolean, required: false, default: false },
    searchable: { type: Boolean, required: false, default: true },
    filterable: { type: Boolean, required: false, default: true },
    unit: { type: String, required: false, trim: true },
    status: { type: String, required: true, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceFacetSchema.plugin(toJSON);
localServiceFacetSchema.plugin(paginate);

localServiceFacetSchema.index({ key: 1 }, { unique: true });
localServiceFacetSchema.index({ status: 1 });

localServiceFacetSchema.statics.FACET_TYPES = FACET_TYPES;

/**
 * Pure typed validation — no DB. Returns { valid, error }.
 */
function validateFacetValue(facet, value) {
  if (value === undefined || value === null || value === '') {
    return facet.required ? { valid: false, error: `${facet.key} required` } : { valid: true };
  }
  switch (facet.dataType) {
    case 'TEXT':
      return typeof value === 'string' ? { valid: true } : { valid: false, error: `${facet.key} must be text` };
    case 'NUMBER':
    case 'RANGE':
    case 'DURATION':
      return typeof value === 'number' && Number.isFinite(value) ? { valid: true } : { valid: false, error: `${facet.key} must be a number` };
    case 'BOOLEAN':
      return typeof value === 'boolean' ? { valid: true } : { valid: false, error: `${facet.key} must be boolean` };
    case 'ENUM':
      return facet.options.includes(value) ? { valid: true } : { valid: false, error: `${facet.key} must be one of ${facet.options.join(',')}` };
    case 'MULTI_ENUM':
      return Array.isArray(value) && value.every((v) => facet.options.includes(v))
        ? { valid: true }
        : { valid: false, error: `${facet.key} values must be within ${facet.options.join(',')}` };
    case 'DATE':
      return Number.isNaN(new Date(value).getTime()) ? { valid: false, error: `${facet.key} must be a date` } : { valid: true };
    default:
      return { valid: true };
  }
}

const LocalServiceFacet = mongoose.model('LocalServiceFacet', localServiceFacetSchema);

module.exports = LocalServiceFacet;
module.exports.validateFacetValue = validateFacetValue;
module.exports.FACET_TYPES = FACET_TYPES;
