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
 * LocalServiceCategory — Admin-managed taxonomy. Copy of StoreCategory pattern:
 * `key` stable immutable unique, `name` human + translatable, self-parent for
 * 3-level tree, sortOrder, status. New category = data row, zero code change.
 */
const localServiceCategorySchema = mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9_]+$/ },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true },
    icon: { type: String, required: false },
    image: { type: String, required: false },
    sortOrder: { type: Number, required: false, default: 0 },
    parent: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceCategory', required: false, default: null },
    allowedBookingModes: { type: [String], required: false, default: [] },
    status: { type: String, required: true, enum: ['draft', 'active', 'inactive'], default: 'draft' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceCategorySchema.plugin(toJSON);
localServiceCategorySchema.plugin(paginate);

localServiceCategorySchema.index({ key: 1 }, { unique: true });
localServiceCategorySchema.index({ status: 1, sortOrder: 1 });
localServiceCategorySchema.index({ parent: 1 });

localServiceCategorySchema.statics.isKeyTaken = async function (key, excludeId) {
  const found = await this.findOne({ key, _id: { $ne: excludeId } });
  return !!found;
};

const LocalServiceCategory = mongoose.model('LocalServiceCategory', localServiceCategorySchema);

module.exports = LocalServiceCategory;
