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
const { toJSON, paginate } = require('../../../models/plugins');

const storeComplaintSchema = mongoose.Schema(
  {
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
    },
    category: {
      type: String,
      required: true,
      enum: ['quality', 'delivery', 'staff_behaviour', 'billing', 'wrong_item', 'missing_item', 'other'],
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    priority: {
      type: String,
      default: 'medium',
      enum: ['low', 'medium', 'high', 'urgent'],
    },
    status: {
      type: String,
      default: 'open',
      enum: ['open', 'in_progress', 'resolved', 'closed', 'escalated'],
    },
    resolution: {
      type: String,
      enum: ['refunded', 'replaced', 'apology', 'no_action', 'pending'],
    },
    resolutionNotes: {
      type: String,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    escalatedTo: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    escalatedAt: {
      type: Date,
    },
    images: {
      type: [String],
      default: [],
    },
    attachments: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

storeComplaintSchema.plugin(toJSON);
storeComplaintSchema.plugin(paginate);

storeComplaintSchema.index({ outlet: 1, status: 1, createdAt: -1 });
storeComplaintSchema.index({ chain: 1, status: 1 });
storeComplaintSchema.index({ customer: 1, createdAt: -1 });
storeComplaintSchema.index({ order: 1 }, { sparse: true });
storeComplaintSchema.index({ priority: 1, status: 1 });

storeComplaintSchema.statics.findByOutlet = async function (outletId, { status } = {}) {
  const filter = { outlet: outletId };
  if (status) filter.status = status;
  return this.find(filter).sort({ createdAt: -1 });
};

storeComplaintSchema.statics.findOpen = async function (outletId) {
  return this.find({ outlet: outletId, status: { $in: ['open', 'in_progress', 'escalated'] } });
};

storeComplaintSchema.statics.findByCustomer = async function (customerId) {
  return this.find({ customer: customerId }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('StoreComplaint', storeComplaintSchema);