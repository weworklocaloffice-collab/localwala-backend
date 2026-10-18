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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate, slugGenerator } = require('../../../models/plugins');

const chainProductSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      source: 'name',
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreCategory',
      required: true,
    },
    subcategory: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreSubcategory',
    },
    brand: {
      type: String,
      trim: true,
    },
    defaultGstRate: {
      type: Number,
      min: 0,
      max: 28,
      default: 18,
    },
    /**
     * HSN code + tax treatment (BR-41, OD-03).
     *
     * `hsn` selects the rate row from TaxConfiguration by (code, order date);
     * without one the rate falls back to `defaultGstRate`, so products created
     * before the taxonomy work carry the old behaviour instead of blocking
     * checkout. `taxType` decides whether the shelf price already contains the
     * tax (`inclusive`, the Indian MRP norm) or has it added on (`exclusive`).
     */
    hsn: {
      type: String,
      trim: true,
      uppercase: true,
    },
    taxType: {
      type: String,
      enum: ['inclusive', 'exclusive', 'none'],
      default: 'inclusive',
    },
    attributes: {
      type: Map,
      of: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    variantsEnabled: {
      type: Boolean,
      default: false,
    },
    catalogueScope: {
      type: String,
      enum: ['shared', 'per_outlet'],
      default: 'shared',
      required: true,
    },
    /**
     * Catalogue lifecycle — a STRING enum, not a boolean.
     *
     * A boolean conflates two different questions. "Is this enabled in the catalogue?"
     * and "has this been archived?" are not the same question: an archived product is
     * still `inactive`, and an `inactive` product is still a real product a partner can
     * find, re-enable and reorder. Collapsing them to one boolean means archiving a
     * product destroys the fact that it existed, which BR-25 forbids and which makes an
     * order line pointing at an archived product indistinguishable from one pointing at a
     * deleted product.
     */
    status: {
      type: String,
      required: true,
      default: 'active',
      enum: ['active', 'inactive', 'archived'],
    },

    /**
     * Soft-archive audit (BR-25). Never physically deleted: historical orders reference
     * this document and must keep resolving.
     */
    archivedAt: {
      type: Date,
    },
    archivedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    archivedReason: {
      type: String,
    },

    /**
     * Product approval — BR-09 and §5.6.
     *
     * The catalogue is PARTNER-managed, so approval is OFF by default: `not_required`.
     * An Admin turns on `Vertical.settings.productApprovalRequired` when a category is
     * suspected of fraud, and only then does this block mean anything.
     *
     * Omitting it entirely is the tempting shortcut and it is wrong twice over — the
     * approval gate has nowhere to record its decision, and a product from a chain that
     * is not yet `active` has no way to be held back from customers.
     */
    approval: {
      status: {
        type: String,
        default: 'not_required',
        enum: ['not_required', 'pending', 'approved', 'rejected'],
      },
      by: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
      },
      at: {
        type: Date,
      },
      note: {
        type: String,
      },
    },
  },
  {
    timestamps: true,
  }
);

// add plugins that converts mongoose to json, convert to unique slug and pagination
chainProductSchema.plugin(toJSON);
chainProductSchema.plugin(slugGenerator);
chainProductSchema.plugin(paginate);

chainProductSchema.index({ chain: 1, category: 1, subcategory: 1, status: 1 });
chainProductSchema.index({ chain: 1, slug: 1 }, { unique: true });
chainProductSchema.index({ name: 'text', description: 'text', searchTerms: 'text' });

/**
 * Live catalogue rows for a category.
 *
 * `status: 'active'` rather than a truthiness check, because `'inactive'` is a truthy
 * string — a `find({ status: true })` written against the old boolean would have matched
 * every archived product too.
 */
chainProductSchema.statics.findByCategory = async function (categoryId) {
  return this.find({ category: categoryId, status: 'active' }).sort({ name: 1 });
};

/**
 * Archive, never delete (BR-25).
 */
chainProductSchema.statics.archive = async function (productId, { by, reason } = {}) {
  const product = await this.findById(productId);
  if (!product) return null;
  product.status = 'archived';
  product.archivedAt = new Date();
  product.archivedBy = by;
  product.archivedReason = reason;
  await product.save();
  return product;
};

module.exports = mongoose.model('ChainProduct', chainProductSchema);